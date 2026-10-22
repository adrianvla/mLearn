use crate::{StorageError, material_validation::bounded, review_read};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

pub(crate) fn identity(command: &ReviewCommand) -> (&str, &ReviewSessionId) {
    match command {
        ReviewCommand::Start { start } => (&start.command_id, &start.session_id),
        ReviewCommand::Next { mutation }
        | ReviewCommand::Reveal { mutation, .. }
        | ReviewCommand::Delivery { mutation, .. }
        | ReviewCommand::Assistance { mutation, .. }
        | ReviewCommand::Submit { mutation, .. }
        | ReviewCommand::Undo { mutation }
        | ReviewCommand::Correct { mutation, .. }
        | ReviewCommand::Pause { mutation }
        | ReviewCommand::Resume { mutation } => (&mutation.command_id, &mutation.session_id),
    }
}

pub(crate) fn receipt(
    db: &Connection,
    command: &ReviewCommand,
) -> Result<Option<ReviewCommit>, StorageError> {
    let (id, session_id) = identity(command);
    bounded(id, 128)?;
    bounded(&session_id.0, 512)?;
    let row: Option<(Vec<u8>, u32)> = db
        .query_row(
            "SELECT digest,revision FROM review_receipts WHERE command_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    row.map(|(digest, committed_revision)| {
        if digest != Sha256::digest(serde_json::to_vec(command)?).to_vec() {
            return Err(StorageError::Invalid(
                "Review command identity reused with different contents".into(),
            ));
        }
        Ok(ReviewCommit {
            command_id: id.into(),
            committed_revision,
            session: review_read::session(db, session_id)?,
        })
    })
    .transpose()
}

pub(crate) fn commit(
    db: &Connection,
    command: &ReviewCommand,
    session: &ReviewSession,
    now: i64,
) -> Result<ReviewCommit, StorageError> {
    db.execute(
        "UPDATE review_sessions SET projection=?2,touched=?3 WHERE id=?1",
        params![session.id.0, serde_json::to_string(session)?, now],
    )?;
    if let Some(encounter) = &session.encounter {
        db.execute(
            "UPDATE review_encounters SET projection=?2 WHERE id=?1",
            params![encounter.id.0, serde_json::to_string(encounter)?],
        )?;
    }
    let (id, _) = identity(command);
    db.execute(
        "INSERT INTO review_receipts VALUES(?1,?2,?3,?4)",
        params![
            id,
            Sha256::digest(serde_json::to_vec(command)?).to_vec(),
            session.id.0,
            session.revision
        ],
    )?;
    Ok(ReviewCommit {
        command_id: id.into(),
        committed_revision: session.revision,
        session: session.clone(),
    })
}
