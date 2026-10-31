use crate::{ProfileStore, StorageError};
use mlearn_core::{ClaimChange, KnowledgeKey, KnowledgeProjection};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) fn claim_sql(package: &str, target: &str, capability: &str) -> String {
    format!(
        "(SELECT c.claim FROM claims c WHERE c.package_id={package} AND c.target_id={target} AND c.capability={capability})"
    )
}

pub(crate) fn assessed_sql(package: &str, target: &str, capability: &str) -> String {
    assessment_sql("o.assessed", package, target, capability)
}

fn assessment_sql(field: &str, package: &str, target: &str, capability: &str) -> String {
    format!(
        "(SELECT {field} FROM review_observations o JOIN review_attempts a ON a.id=o.attempt_id WHERE o.package_id={package} AND o.target_id={target} AND o.capability={capability} AND a.active=1 AND o.assessed IS NOT NULL ORDER BY a.sequence DESC LIMIT 1)"
    )
}

/// Shared by point projections and collection membership. Expressions are
/// native SQL identifiers/placeholders, never interpolated request text.
pub(crate) fn state_sql(package: &str, target: &str, capability: &str) -> String {
    let claim = claim_sql(package, target, capability);
    let assessed = assessed_sql(package, target, capability);
    format!(
        "CASE {claim} WHEN 1 THEN 'claimed_known' WHEN 0 THEN 'claimed_unknown' ELSE CASE {assessed} WHEN 1 THEN 'assessed_known' WHEN 0 THEN 'assessed_unknown' ELSE 'untracked' END END"
    )
}

impl ProfileStore {
    /// Bounded current evidence under the same snapshot as the shared status.
    /// No cue, answer, whole session or parallel learner model is transported.
    pub fn knowledge_evidence(
        &self,
        query: &mlearn_core::KnowledgeEvidenceQuery,
    ) -> Result<mlearn_core::KnowledgeEvidencePage, StorageError> {
        use mlearn_core::*;
        if [
            &query.key.package_id,
            &query.key.target_id,
            &query.key.capability,
        ]
        .iter()
        .any(|value| value.is_empty() || value.len() > 512 || value.contains('\0'))
        {
            return Err(StorageError::Invalid(
                "Invalid Knowledge evidence key".into(),
            ));
        }
        let tx = self.connection.unchecked_transaction()?;
        let projection = crate::review_read::projection(&tx, &query.key)?;
        let identity = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(&query.key, projection.revision))?)
        );
        if query.after.as_ref().is_some_and(|cursor| {
            cursor.before == 0
                || cursor.revision != projection.revision
                || cursor.identity != identity
        }) {
            return Err(StorageError::Invalid(
                "Knowledge changed; refresh its evidence".into(),
            ));
        }
        let key = &query.key;
        let claim_revision = tx
            .query_row(
                "SELECT revision FROM claims WHERE package_id=?1 AND target_id=?2 AND capability=?3",
                params![key.package_id, key.target_id, key.capability],
                |row| row.get(0),
            )
            .optional()?;
        let assessed_attempt: Option<String> = tx.query_row(
            &format!("SELECT {}", assessment_sql("a.id", "?1", "?2", "?3")),
            params![key.package_id, key.target_id, key.capability],
            |row| row.get(0),
        )?;
        let (observations, more) = {
            let mut statement = tx.prepare(
                "SELECT a.sequence,a.id,a.session_id,a.encounter_id,a.active,a.created_at,
                        o.grade,o.assessed,a.conditions,w.admission,
                        json_extract(s.projection,'$.mode.kind')='practice'
                 FROM review_observations o
                 JOIN review_attempts a ON a.id=o.attempt_id
                 JOIN review_encounters e ON e.id=a.encounter_id
                 JOIN review_work w ON w.session_id=e.session_id AND w.work_id=e.work_id
                 JOIN review_sessions s ON s.id=a.session_id
                 WHERE o.package_id=?1 AND o.target_id=?2 AND o.capability=?3
                   AND (?4 IS NULL OR a.sequence<?4)
                 ORDER BY a.sequence DESC LIMIT 17",
            )?;
            let mut rows = statement.query(params![
                key.package_id,
                key.target_id,
                key.capability,
                query.after.as_ref().map(|cursor| cursor.before),
            ])?;
            let mut observations = Vec::new();
            let mut bytes = 0;
            let mut more = false;
            while let Some(row) = rows.next()? {
                let admission: ReviewAdmission = serde_json::from_str(&row.get::<_, String>(9)?)?;
                let observation = KnowledgeObservation {
                    sequence: row.get(0)?,
                    attempt_id: ReviewAttemptId(row.get(1)?),
                    session_id: ReviewSessionId(row.get(2)?),
                    encounter_id: ReviewEncounterId(row.get(3)?),
                    active: row.get(4)?,
                    created_at: row.get(5)?,
                    material_id: admission.material_id,
                    material_revision: admission.material_revision,
                    package_version: admission.package_version,
                    package_revision: admission.package_revision,
                    probe_id: admission.probe.id,
                    probe_contract_version: admission.probe.contract_version,
                    direction: admission.probe.direction,
                    conditions: serde_json::from_str(&row.get::<_, String>(8)?)?,
                    grade: serde_json::from_str(&row.get::<_, String>(6)?)?,
                    assessed: row.get(7)?,
                    practice: row.get(10)?,
                    source: admission.source,
                };
                let size = serde_json::to_vec(&observation)?.len();
                if size > 128 * 1024 {
                    return Err(StorageError::Invalid(
                        "Knowledge observation exceeds the read bound".into(),
                    ));
                }
                if observations.len() == 16 || bytes + size > 128 * 1024 {
                    more = true;
                    break;
                }
                bytes += size;
                observations.push(observation);
            }
            (observations, more)
        };
        let next = observations
            .last()
            .filter(|_| more)
            .map(|last| KnowledgeEvidenceCursor {
                identity,
                before: last.sequence,
                revision: projection.revision,
            });
        tx.commit()?;
        Ok(KnowledgeEvidencePage {
            projection,
            claim_revision,
            assessed_attempt: assessed_attempt.map(ReviewAttemptId),
            observations,
            next,
        })
    }

    pub fn knowledge(
        &self,
        keys: &[KnowledgeKey],
    ) -> Result<Vec<KnowledgeProjection>, StorageError> {
        if keys.len() > 256 {
            return Err(StorageError::Invalid(
                "Knowledge batch exceeds 256 targets".into(),
            ));
        }
        keys.iter()
            .map(|key| crate::review_read::projection(&self.connection, key))
            .collect()
    }
    pub fn change_claim(
        &mut self,
        change: &ClaimChange,
    ) -> Result<KnowledgeProjection, StorageError> {
        if change.command_id.is_empty()
            || change.command_id.len() > 128
            || [
                &change.key.package_id,
                &change.key.target_id,
                &change.key.capability,
            ]
            .iter()
            .any(|v| v.is_empty() || v.len() > 512)
        {
            return Err(StorageError::Invalid("Invalid claim identity".into()));
        }
        let digest = Sha256::digest(serde_json::to_vec(change)?).to_vec();
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let previous: Option<(Vec<u8>, String)> = tx
            .query_row(
                "SELECT digest,projection FROM claim_receipts WHERE command_id=?1",
                [&change.command_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old, result)) = previous {
            if old != digest {
                return Err(StorageError::Invalid(
                    "Command identity reused for different claim".into(),
                ));
            }
            return Ok(serde_json::from_str(&result)?);
        }
        tx.execute(
            "UPDATE knowledge_revision SET revision=revision+1 WHERE id=1",
            [],
        )?;
        let revision: u32 = tx.query_row(
            "SELECT revision FROM knowledge_revision WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        tx.execute("INSERT INTO claims(package_id,target_id,capability,claim,revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(package_id,target_id,capability) DO UPDATE SET claim=excluded.claim,revision=excluded.revision",params![change.key.package_id,change.key.target_id,change.key.capability,change.claim,revision])?;
        let projection = crate::review_read::projection(&tx, &change.key)?;
        tx.execute(
            "INSERT INTO claim_receipts(command_id,digest,projection) VALUES(?1,?2,?3)",
            params![
                change.command_id,
                digest,
                serde_json::to_string(&projection)?
            ],
        )?;
        // Receipts live with durable commands: retry identity must survive restart.
        tx.commit()?;
        Ok(projection)
    }
}
