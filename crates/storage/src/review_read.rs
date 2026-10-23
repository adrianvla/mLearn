use crate::{material_read::read_material, ProfileStore, StorageError};
use mlearn_core::*;
use rusqlite::{params, Connection, OptionalExtension};

pub(crate) fn session(
    db: &Connection,
    id: &ReviewSessionId,
) -> Result<ReviewSession, StorageError> {
    let json: String = db.query_row(
        "SELECT projection FROM review_sessions WHERE id=?1",
        [&id.0],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&json)?)
}

pub(crate) fn schedule(
    db: &Connection,
    admission: &ReviewAdmission,
) -> Result<Option<ReviewSchedule>, StorageError> {
    let json: Option<String> = db
        .query_row(
            "SELECT document FROM review_schedules WHERE material_id=?1 AND probe_id=?2",
            params![admission.material_id.0, admission.probe.id],
            |r| r.get(0),
        )
        .optional()?;
    json.map(|v| Ok(serde_json::from_str(&v)?)).transpose()
}

pub(crate) fn admission(
    db: &Connection,
    encounter: &ReviewEncounterId,
) -> Result<ReviewAdmission, StorageError> {
    let json: String = db.query_row(
        "SELECT w.admission FROM review_encounters e JOIN review_work w ON w.session_id=e.session_id AND w.work_id=e.work_id WHERE e.id=?1",
        [&encounter.0], |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&json)?)
}

pub(crate) fn work_untested(
    db: &Connection,
    session: &ReviewSessionId,
    work: &ReviewWorkId,
) -> Result<bool, StorageError> {
    let json: Option<String> = db.query_row(
        "SELECT a.response FROM review_attempts a JOIN review_encounters e ON e.id=a.encounter_id WHERE a.session_id=?1 AND e.work_id=?2 AND a.active=1 ORDER BY a.sequence DESC LIMIT 1",
        params![session.0, work.0], |r| r.get(0),
    ).optional()?;
    json.map(|json| {
        let response: ReviewResponse = serde_json::from_str(&json)?;
        Ok(crate::review_evidence::quality(&response).is_none())
    })
    .transpose()
    .map(|value| value.unwrap_or(false))
}

pub(crate) fn projection(
    db: &Connection,
    key: &KnowledgeKey,
) -> Result<KnowledgeProjection, StorageError> {
    let claim: Option<Option<bool>> = db
        .query_row(
            "SELECT claim FROM claims WHERE package_id=?1 AND target_id=?2 AND capability=?3",
            params![key.package_id, key.target_id, key.capability],
            |r| r.get(0),
        )
        .optional()?;
    let assessed: Option<bool> = db.query_row(
        "SELECT o.assessed FROM review_observations o JOIN review_attempts a ON a.id=o.attempt_id WHERE o.package_id=?1 AND o.target_id=?2 AND o.capability=?3 AND a.active=1 AND o.assessed IS NOT NULL ORDER BY a.sequence DESC LIMIT 1",
        params![key.package_id, key.target_id, key.capability], |r| r.get(0),
    ).optional()?;
    let revision = db.query_row(
        "SELECT revision FROM knowledge_revision WHERE id=1",
        [],
        |r| r.get(0),
    )?;
    let claim = claim.flatten();
    let status = match (claim, assessed) {
        (Some(true), _) => "claimed_known",
        (Some(false), _) => "claimed_unknown",
        (None, Some(true)) => "assessed_known",
        (None, Some(false)) => "assessed_unknown",
        (None, None) => "untracked",
    };
    Ok(KnowledgeProjection {
        key: key.clone(),
        claim,
        assessed,
        prediction: None,
        revision,
        status: status.into(),
    })
}

impl ProfileStore {
    pub fn review_practice_materials(
        &self,
        items: &[PracticeItem],
    ) -> Result<Vec<Material>, StorageError> {
        crate::review_admission::practice_items(items)?;
        items
            .iter()
            .map(|item| {
                crate::review_admission::practice_material(&self.connection, &item.material_id)
            })
            .collect()
    }

    pub fn review_work_untested(
        &self,
        session: &ReviewSessionId,
        work: &ReviewWorkId,
    ) -> Result<bool, StorageError> {
        work_untested(&self.connection, session, work)
    }

    pub fn review_session(&self, id: &ReviewSessionId) -> Result<ReviewSession, StorageError> {
        session(&self.connection, id)
    }

    pub fn review_sessions(&self) -> Result<Vec<ReviewSession>, StorageError> {
        let mut stmt = self
            .connection
            .prepare("SELECT projection FROM review_sessions ORDER BY touched DESC,id LIMIT 32")?;
        stmt.query_map([], |r| r.get::<_, String>(0))?
            .map(|v| Ok(serde_json::from_str(&v?)?))
            .collect()
    }

    pub fn review_due_materials(
        &self,
        after: Option<&MaterialId>,
        _now: i64,
        limit: u32,
    ) -> Result<Vec<ReviewDueMaterial>, StorageError> {
        if !(1..=128).contains(&limit) {
            return Err(StorageError::Invalid(
                "Review page limit must be 1..128".into(),
            ));
        }
        let mut stmt = self
            .connection
            .prepare("SELECT id FROM materials WHERE excluded=0 AND id>?1 ORDER BY id LIMIT ?2")?;
        let ids = stmt
            .query_map(
                params![after.map(|id| id.0.as_str()).unwrap_or(""), limit],
                |r| r.get::<_, String>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let mut schedules = self.connection.prepare(
            "SELECT probe_id,document FROM review_schedules WHERE material_id=?1 ORDER BY probe_id",
        )?;
        ids.into_iter()
            .map(|id| {
                let rows = schedules
                    .query_map([&id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })?
                    .map(|r| {
                        let (probe, json) = r?;
                        Ok((probe, serde_json::from_str(&json)?))
                    })
                    .collect::<Result<Vec<_>, StorageError>>()?;
                Ok(ReviewDueMaterial {
                    material: read_material(&self.connection, &MaterialId(id))?,
                    schedules: rows,
                })
            })
            .collect()
    }

    pub fn review_source(
        &self,
        id: &ReviewSessionId,
        encounter: &ReviewEncounterId,
    ) -> Result<Option<SourceAnchor>, StorageError> {
        let belongs: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM review_encounters WHERE id=?1 AND session_id=?2)",
            params![encounter.0, id.0],
            |r| r.get(0),
        )?;
        if !belongs {
            return Err(StorageError::Invalid(
                "Encounter does not belong to session".into(),
            ));
        }
        Ok(admission(&self.connection, encounter)?.source)
    }
}
