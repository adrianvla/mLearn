//! Immutable raw responses and package results, committed under the Review receipt.
use crate::{ProfileStore, StorageError};
use crate::{review, review_read, review_receipts};
use mlearn_core::*;
use rusqlite::params;
use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS review_captures(
            encounter_id TEXT PRIMARY KEY REFERENCES review_encounters(id),
            id TEXT NOT NULL UNIQUE,command_id TEXT NOT NULL UNIQUE,
            response TEXT NOT NULL,outcome TEXT NOT NULL,conditions TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS review_disclosures(
            encounter_id TEXT NOT NULL REFERENCES review_encounters(id),
            package_id TEXT NOT NULL,target_id TEXT NOT NULL,capability TEXT NOT NULL,
            kind TEXT NOT NULL,
            PRIMARY KEY(encounter_id,package_id,target_id,capability,kind));
         CREATE INDEX IF NOT EXISTS review_disclosure_key
            ON review_disclosures(package_id,target_id,capability,encounter_id);
         INSERT OR IGNORE INTO review_disclosures
            SELECT e.id,json_extract(k.value,'$.packageId'),json_extract(k.value,'$.targetId'),
                json_extract(k.value,'$.capability'),'cue'
            FROM review_encounters e,json_each(e.projection,'$.supplied') k;
         INSERT OR IGNORE INTO review_disclosures
            SELECT e.id,json_extract(t.value,'$.key.packageId'),json_extract(t.value,'$.key.targetId'),
                json_extract(t.value,'$.key.capability'),'answer'
            FROM review_encounters e,json_each(e.projection,'$.targets') t
            WHERE json_extract(e.projection,'$.conditions.revealed')=1
                AND json_type(t.value,'$.key')='object';
         PRAGMA user_version=20;",
    )?;
    Ok(())
}

pub(crate) fn disclose(
    db: &Connection,
    encounter: &ReviewEncounterId,
    keys: &[KnowledgeKey],
    kind: &str,
) -> Result<(), StorageError> {
    let mut statement =
        db.prepare_cached("INSERT OR IGNORE INTO review_disclosures VALUES(?1,?2,?3,?4,?5)")?;
    for key in keys {
        statement.execute(params![
            encounter.0,
            key.package_id,
            key.target_id,
            key.capability,
            kind
        ])?;
    }
    Ok(())
}

pub(crate) fn read(
    db: &Connection,
    encounter: &ReviewEncounterId,
    revealed: bool,
) -> Result<Option<ReviewCapture>, StorageError> {
    let row: Option<(String, String, String, String)> = db
        .query_row(
            "SELECT id,response,conditions,outcome FROM review_captures WHERE encounter_id=?1",
            [&encounter.0],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    row.map(|(id, response, conditions, outcome)| {
        Ok(ReviewCapture {
            id: ReviewCaptureId(id),
            response: serde_json::from_str(&response)?,
            conditions: serde_json::from_str(&conditions)?,
            feedback: if revealed {
                Some(serde_json::from_str(&outcome)?)
            } else {
                None
            },
        })
    })
    .transpose()
}

fn snapshot(
    db: &Connection,
    command: &ReviewCommand,
) -> Result<(ReviewSession, ReviewAdmission), StorageError> {
    let ReviewCommand::CaptureResponse {
        mutation,
        encounter_id,
        response,
    } = command
    else {
        return Err(StorageError::Invalid(
            "Expected a Review response capture".into(),
        ));
    };
    let session = review_read::session(db, &mutation.session_id)?;
    if session.revision != mutation.expected_revision {
        return Err(StorageError::Conflict);
    }
    let encounter = session
        .encounter
        .as_ref()
        .filter(|value| value.id == *encounter_id && !value.correction && value.capture.is_none())
        .ok_or_else(|| {
            StorageError::Invalid("Response is already captured or encounter changed".into())
        })?;
    if session.state != ReviewSessionState::Active {
        return Err(StorageError::Invalid(
            "Resume Review before responding".into(),
        ));
    }
    let admission = review_read::admission(db, &encounter.id)?;
    let task = admission.task.as_ref().ok_or_else(|| {
        StorageError::Invalid("This Review task supports retrospective self-report only".into())
    })?;
    task.validate()
        .map_err(|error| StorageError::Invalid(error.to_string()))?;
    response
        .validate(&task.response_spec)
        .map_err(|error| StorageError::Invalid(error.to_string()))?;
    Ok((session, admission))
}

impl ProfileStore {
    pub fn review_capture_admission(
        &self,
        command: &ReviewCommand,
    ) -> Result<ReviewAdmission, StorageError> {
        Ok(snapshot(&self.connection, command)?.1)
    }

    /// Only the runtime supplies a result executed by the admitted package.
    pub fn review_capture(
        &mut self,
        command: &ReviewCommand,
        output: &ValidationOutput,
        now: i64,
    ) -> Result<ReviewCommit, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(receipt) = review_receipts::receipt(&tx, command)? {
            return Ok(receipt);
        }
        let (mut session, admission) = snapshot(&tx, command)?;
        let ReviewCommand::CaptureResponse {
            mutation,
            encounter_id,
            response,
        } = command
        else {
            return Err(StorageError::Invalid(
                "Expected a Review response capture".into(),
            ));
        };
        let task = admission
            .task
            .as_ref()
            .ok_or_else(|| StorageError::Invalid("Missing admitted task contract".into()))?;
        let input = ValidationInput {
            contract_version: 1,
            package_id: admission.package_id,
            package_revision: admission.package_revision,
            task_id: admission.probe.id,
            task_revision: task.revision,
            validator_id: task.validator_id.clone().ok_or_else(|| {
                StorageError::Invalid("Self-report has no executed validator".into())
            })?,
            response: response.clone(),
        };
        let rows: Vec<_> = admission
            .probe
            .targets
            .iter()
            .map(|row| row.id.as_str())
            .collect();
        output
            .validate(&input, &rows)
            .map_err(|error| StorageError::Invalid(error.to_string()))?;
        let encounter = session
            .encounter
            .as_mut()
            .ok_or_else(|| StorageError::Invalid("Missing admitted encounter".into()))?;
        let id = ReviewCaptureId(format!(
            "capture-{:x}",
            Sha256::digest(serde_json::to_vec(command)?)
        ));
        tx.execute(
            "INSERT INTO review_captures VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                encounter_id.0,
                id.0,
                mutation.command_id,
                serde_json::to_string(response)?,
                serde_json::to_string(output)?,
                serde_json::to_string(&encounter.conditions)?
            ],
        )?;
        encounter.capture = Some(ReviewCapture {
            id,
            response: response.clone(),
            conditions: encounter.conditions.clone(),
            feedback: encounter.conditions.revealed.then(|| output.clone()),
        });
        review::advance_revision(&mut session)?;
        let result = review_receipts::commit(&tx, command, &session, now)?;
        tx.commit()?;
        Ok(result)
    }
}
