use crate::{StorageError, review_evidence, review_read};
use mlearn_core::*;
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

fn last(db: &Connection, session: &ReviewSession) -> Result<ReviewAttemptId, StorageError> {
    let id: Option<String> = db.query_row(
        "SELECT last_attempt FROM review_sessions WHERE id=?1",
        [&session.id.0],
        |r| r.get(0),
    )?;
    id.map(ReviewAttemptId)
        .ok_or_else(|| StorageError::Invalid("No recent Review response to correct".into()))
}

pub(crate) fn submit(
    db: &Connection,
    session: &mut ReviewSession,
    response: &ReviewResponse,
    now: i64,
) -> Result<(), StorageError> {
    let encounter = session
        .encounter
        .as_ref()
        .ok_or_else(|| StorageError::Invalid("No admitted Review encounter".into()))?;
    if encounter.correction {
        return Err(StorageError::Invalid(
            "Replace the undone response with Correct".into(),
        ));
    }
    review_evidence::validate(response, encounter)?;
    let admission = review_read::admission(db, &encounter.id)?;
    let previous = review_read::schedule(db, &admission)?;
    let attempt = ReviewAttemptId(format!(
        "attempt-{:x}",
        Sha256::digest(serde_json::to_vec(&(&session.id, &encounter.id))?,)
    ));
    db.execute("INSERT INTO review_attempts(id,session_id,encounter_id,active,response,conditions,previous_schedule,created_at) VALUES(?1,?2,?3,1,?4,?5,?6,?7)",
        params![attempt.0, session.id.0, encounter.id.0, serde_json::to_string(response)?,
            serde_json::to_string(&encounter.conditions)?, previous.as_ref().map(serde_json::to_string).transpose()?, now])?;
    if let Some((quality, easy)) = review_evidence::quality(response) {
        review_evidence::write_schedule(
            db,
            &admission,
            Some(&review_schedule(
                previous.as_ref(),
                quality,
                easy,
                now,
                &attempt,
            )),
        )?;
    }
    review_evidence::observe(db, &attempt, encounter, response)?;
    db.execute(
        "UPDATE review_sessions SET last_attempt=?2 WHERE id=?1",
        params![session.id.0, attempt.0],
    )?;
    session.completed = session
        .completed
        .checked_add(1)
        .ok_or_else(|| StorageError::Invalid("Review progress exhausted".into()))?;
    session.can_undo = true;
    session.encounter = None;
    if session.total == Some(session.completed) {
        session.state = ReviewSessionState::Complete;
    }
    Ok(())
}

pub(crate) fn undo(db: &Connection, session: &mut ReviewSession) -> Result<(), StorageError> {
    if !session.can_undo {
        return Err(StorageError::Invalid(
            "No recent Review response to undo".into(),
        ));
    }
    let attempt = last(db, session)?;
    let (id, previous, response): (String, Option<String>, String) = db.query_row(
        "SELECT encounter_id,previous_schedule,response FROM review_attempts WHERE id=?1 AND active=1",
        [&attempt.0],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let encounter_json: String = db.query_row(
        "SELECT projection FROM review_encounters WHERE id=?1",
        [&id],
        |r| r.get(0),
    )?;
    let mut encounter: ReviewEncounter = serde_json::from_str(&encounter_json)?;
    let admission = review_read::admission(db, &encounter.id)?;
    let current = review_read::schedule(db, &admission)?;
    let previous: Option<ReviewSchedule> =
        previous.map(|v| serde_json::from_str(&v)).transpose()?;
    let response: ReviewResponse = serde_json::from_str(&response)?;
    let restored = current
        .as_ref()
        .is_some_and(|s| s.owner_attempt.as_ref() == Some(&attempt))
        || (review_evidence::quality(&response).is_none() && current == previous);
    if restored {
        review_evidence::write_schedule(db, &admission, previous.as_ref())?;
    }
    db.execute(
        "UPDATE review_attempts SET active=0,restored=?2 WHERE id=?1",
        params![attempt.0, restored],
    )?;
    db.execute(
        "UPDATE knowledge_revision SET revision=revision+1 WHERE id=1",
        [],
    )?;
    db.execute(
        "UPDATE review_sessions SET suspended=?2 WHERE id=?1",
        params![
            session.id.0,
            session
                .encounter
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?
        ],
    )?;
    encounter.correction = true;
    // The answer and original exposure remain visible; Undo never manufactures
    // another cold retrieval attempt.
    encounter.answer = Some(admission.probe.answer);
    encounter.conditions.revealed = true;
    session.encounter = Some(encounter);
    session.can_undo = false;
    session.completed = session
        .completed
        .checked_sub(1)
        .ok_or_else(|| StorageError::Invalid("Review progress is inconsistent".into()))?;
    session.state = ReviewSessionState::Active;
    session.message = None;
    Ok(())
}

pub(crate) fn correct(
    db: &Connection,
    session: &mut ReviewSession,
    response: &ReviewResponse,
    _now: i64,
) -> Result<(), StorageError> {
    let encounter = session
        .encounter
        .as_ref()
        .ok_or_else(|| StorageError::Invalid("No Review response under correction".into()))?;
    if !encounter.correction {
        return Err(StorageError::Invalid(
            "Undo a recent response before correcting it".into(),
        ));
    }
    review_evidence::validate(response, encounter)?;
    let attempt = last(db, session)?;
    let (conditions, previous, restored, created): (String, Option<String>, bool, i64) = db.query_row(
        "SELECT conditions,previous_schedule,restored,created_at FROM review_attempts WHERE id=?1 AND active=0 AND encounter_id=?2",
        params![attempt.0, encounter.id.0], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let previous: Option<ReviewSchedule> =
        previous.map(|v| serde_json::from_str(&v)).transpose()?;
    let admission = review_read::admission(db, &encounter.id)?;
    let current = review_read::schedule(db, &admission)?;
    // A peer session may have advanced this scheduler after Undo. Replace only
    // our own restored preimage, never that newer peer's work.
    if restored && current == previous {
        match review_evidence::quality(response) {
            Some((quality, easy)) => review_evidence::write_schedule(
                db,
                &admission,
                Some(&review_schedule(
                    previous.as_ref(),
                    quality,
                    easy,
                    created,
                    &attempt,
                )),
            )?,
            None => review_evidence::write_schedule(db, &admission, previous.as_ref())?,
        }
    }
    db.execute(
        "DELETE FROM review_observations WHERE attempt_id=?1",
        [&attempt.0],
    )?;
    let mut original = encounter.clone();
    original.conditions = serde_json::from_str(&conditions)?;
    review_evidence::observe(db, &attempt, &original, response)?;
    db.execute(
        "UPDATE review_attempts SET active=1,response=?2 WHERE id=?1",
        params![attempt.0, serde_json::to_string(response)?],
    )?;
    let suspended: Option<String> = db.query_row(
        "SELECT suspended FROM review_sessions WHERE id=?1",
        [&session.id.0],
        |r| r.get(0),
    )?;
    db.execute(
        "UPDATE review_sessions SET suspended=NULL WHERE id=?1",
        [&session.id.0],
    )?;
    // Keep the corrected encounter's original retrieval conditions in history.
    original.correction = false;
    db.execute(
        "UPDATE review_encounters SET projection=?2 WHERE id=?1",
        params![original.id.0, serde_json::to_string(&original)?],
    )?;
    session.encounter = suspended.map(|v| serde_json::from_str(&v)).transpose()?;
    session.completed = session
        .completed
        .checked_add(1)
        .ok_or_else(|| StorageError::Invalid("Review progress exhausted".into()))?;
    session.can_undo = true;
    session.state = if session.total == Some(session.completed) && session.encounter.is_none() {
        ReviewSessionState::Complete
    } else {
        ReviewSessionState::Active
    };
    Ok(())
}
