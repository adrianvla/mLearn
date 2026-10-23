use crate::{
    ProfileStore, StorageError, review_admission, review_read,
    review_receipts::{commit, identity, receipt},
    review_state,
};
use mlearn_core::*;
use rusqlite::{Connection, params};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch("
        CREATE TABLE IF NOT EXISTS review_sessions(
            id TEXT PRIMARY KEY,projection TEXT NOT NULL,touched INTEGER NOT NULL,
            last_attempt TEXT,suspended TEXT);
        CREATE TABLE IF NOT EXISTS review_work(
            session_id TEXT NOT NULL REFERENCES review_sessions(id),work_id TEXT NOT NULL,
            position INTEGER NOT NULL,admission TEXT NOT NULL,admitted INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(session_id,work_id),UNIQUE(session_id,position));
        CREATE TABLE IF NOT EXISTS review_encounters(
            id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES review_sessions(id),
            work_id TEXT NOT NULL,projection TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS review_receipts(
            command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,session_id TEXT NOT NULL,
            revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS review_schedules(
            material_id TEXT NOT NULL,probe_id TEXT NOT NULL,document TEXT NOT NULL,
            PRIMARY KEY(material_id,probe_id));
        CREATE TABLE IF NOT EXISTS review_attempts(
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,
            session_id TEXT NOT NULL,encounter_id TEXT NOT NULL,active INTEGER NOT NULL,
            response TEXT NOT NULL,conditions TEXT NOT NULL,previous_schedule TEXT,
            restored INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS review_active_encounter ON review_attempts(encounter_id) WHERE active=1;
        CREATE INDEX IF NOT EXISTS review_attempt_session ON review_attempts(session_id,sequence);
        CREATE INDEX IF NOT EXISTS review_encounter_work ON review_encounters(session_id,work_id);
        CREATE INDEX IF NOT EXISTS review_work_material ON review_work(json_extract(admission,'$.materialId'),session_id);
        CREATE TABLE IF NOT EXISTS review_observations(
            attempt_id TEXT NOT NULL REFERENCES review_attempts(id),row_id TEXT NOT NULL,
            package_id TEXT NOT NULL,target_id TEXT NOT NULL,capability TEXT NOT NULL,
            grade TEXT NOT NULL,assessed INTEGER,
            PRIMARY KEY(attempt_id,row_id));
        CREATE INDEX IF NOT EXISTS review_observation_target ON review_observations(package_id,target_id,capability,attempt_id);
        PRAGMA user_version=5;
    ")?;
    Ok(())
}

fn advance_revision(session: &mut ReviewSession) -> Result<(), StorageError> {
    session.revision = session
        .revision
        .checked_add(1)
        .ok_or_else(|| StorageError::Invalid("Review revision exhausted".into()))?;
    Ok(())
}

impl ProfileStore {
    pub fn review_receipt(
        &self,
        command: &ReviewCommand,
    ) -> Result<Option<ReviewCommit>, StorageError> {
        receipt(&self.connection, command)
    }

    pub fn review_start(
        &mut self,
        start: &ReviewStart,
        admissions: &[ReviewAdmission],
        now: i64,
    ) -> Result<ReviewCommit, StorageError> {
        let command = ReviewCommand::Start {
            start: start.clone(),
        };
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(value) = receipt(&tx, &command)? {
            return Ok(value);
        }
        let maximum = match &start.mode {
            ReviewMode::Continuous => 1,
            ReviewMode::Finite { limit } if (1..=128).contains(limit) => *limit,
            ReviewMode::Finite { .. } => {
                return Err(StorageError::Invalid(
                    "Finite Review limit must be 1..128".into(),
                ));
            }
            ReviewMode::Practice { items } => {
                review_admission::practice_items(items)?;
                // Package admission supplies at most eight compatible probes per Material.
                if admissions.len() > items.len() * 8 {
                    return Err(StorageError::Invalid("Word Practice probe bound exceeded".into()));
                }
                for item in items {
                    let material = review_admission::practice_material(&tx, &item.material_id)?;
                    if !admissions.iter().any(|value| value.material_id == item.material_id)
                        || admissions.iter().any(|value| {
                            value.material_id == item.material_id
                                && (value.material_revision != material.revision
                                    || value.package_id != material.content.package_id
                                    || value.source != item.source.clone().or_else(|| material.content.source.clone()))
                        })
                    {
                        return Err(StorageError::Invalid("Selected Word Practice membership changed or is unavailable".into()));
                    }
                }
                if admissions.iter().any(|value| !items.iter().any(|item| item.material_id == value.material_id)) {
                    return Err(StorageError::Invalid("Word Practice cannot broaden selected membership".into()));
                }
                u32::try_from(admissions.len()).map_err(|error| StorageError::Invalid(error.to_string()))?
            }
        };
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM review_sessions WHERE id=?1)",
            [&start.session_id.0],
            |r| r.get(0),
        )?;
        if exists {
            return Err(StorageError::Invalid(
                "Review session already exists".into(),
            ));
        }
        let mut session = ReviewSession {
            id: start.session_id.clone(),
            revision: 1,
            mode: start.mode.clone(),
            state: ReviewSessionState::Active,
            completed: 0,
            total: None,
            encounter: None,
            can_undo: false,
            message: None,
        };
        tx.execute(
            "INSERT INTO review_sessions(id,projection,touched) VALUES(?1,?2,?3)",
            params![session.id.0, serde_json::to_string(&session)?, now],
        )?;
        let mut count = 0_u32;
        for admission in admissions {
            if count == maximum {
                break;
            }
            review_admission::validate_admission(admission)?;
            if !matches!(&start.mode, ReviewMode::Practice { .. }) {
                review_admission::due(&tx, admission, now)?;
            }
            let inserted = tx.execute("INSERT OR IGNORE INTO review_work(session_id,work_id,position,admission) VALUES(?1,?2,?3,?4)",
                params![session.id.0, admission.work_id.0, count, serde_json::to_string(admission)?])?;
            if inserted > 0 {
                count += 1;
            }
        }
        if matches!(&start.mode, ReviewMode::Practice { .. }) && count != maximum {
            return Err(StorageError::Invalid("Duplicate Word Practice work".into()));
        }
        session.total = match &start.mode {
            ReviewMode::Finite { .. } | ReviewMode::Practice { .. } => Some(count),
            ReviewMode::Continuous => None,
        };
        review_admission::next(&tx, &mut session, None)?;
        let result = commit(&tx, &command, &session, now)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn review_next(
        &mut self,
        mutation: &ReviewMutation,
        admission: Option<&ReviewAdmission>,
        now: i64,
    ) -> Result<ReviewCommit, StorageError> {
        self.review_mutate(
            &ReviewCommand::Next {
                mutation: mutation.clone(),
            },
            admission,
            now,
        )
    }

    pub fn review_apply(
        &mut self,
        command: &ReviewCommand,
        now: i64,
    ) -> Result<ReviewCommit, StorageError> {
        match command {
            ReviewCommand::Start { .. } | ReviewCommand::Next { .. } => Err(StorageError::Invalid(
                "Review admission requires its storage entry point".into(),
            )),
            ReviewCommand::Reveal { .. }
            | ReviewCommand::Delivery { .. }
            | ReviewCommand::Assistance { .. }
            | ReviewCommand::Submit { .. }
            | ReviewCommand::Undo { .. }
            | ReviewCommand::Correct { .. }
            | ReviewCommand::Pause { .. }
            | ReviewCommand::Resume { .. } => self.review_mutate(command, None, now),
        }
    }

    fn review_mutate(
        &mut self,
        command: &ReviewCommand,
        admission: Option<&ReviewAdmission>,
        now: i64,
    ) -> Result<ReviewCommit, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(value) = receipt(&tx, command)? {
            return Ok(value);
        }
        let (_, id) = identity(command);
        let mut session = review_read::session(&tx, id)?;
        let mutation = match command {
            ReviewCommand::Start { .. } => {
                return Err(StorageError::Invalid("Use Review start".into()));
            }
            ReviewCommand::Next { mutation }
            | ReviewCommand::Reveal { mutation, .. }
            | ReviewCommand::Delivery { mutation, .. }
            | ReviewCommand::Assistance { mutation, .. }
            | ReviewCommand::Submit { mutation, .. }
            | ReviewCommand::Undo { mutation }
            | ReviewCommand::Correct { mutation, .. }
            | ReviewCommand::Pause { mutation }
            | ReviewCommand::Resume { mutation } => mutation,
        };
        if session.revision != mutation.expected_revision {
            return Err(StorageError::Conflict);
        }
        if matches!(session.mode, ReviewMode::Continuous)
            && let Some(value) = admission
        {
            review_admission::due(&tx, value, now)?;
            if review_read::work_untested(&tx, id, &value.work_id)? {
                return Err(StorageError::Invalid(
                    "Choose another due probe after an untested response".into(),
                ));
            }
        }
        advance_revision(&mut session)?;
        review_state::apply(&tx, &mut session, command, admission, now)?;
        let result = commit(&tx, command, &session, now)?;
        tx.commit()?;
        Ok(result)
    }
}
