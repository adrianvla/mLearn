use crate::{StorageError, review_admission::next, review_attempt, review_read};
use mlearn_core::*;
use rusqlite::Connection;

pub(crate) fn apply(
    db: &Connection,
    session: &mut ReviewSession,
    command: &ReviewCommand,
    candidate: Option<&ReviewAdmission>,
    now: i64,
) -> Result<(), StorageError> {
    if session.state == ReviewSessionState::Paused
        && !matches!(
            command,
            ReviewCommand::Resume { .. } | ReviewCommand::Pause { .. }
        )
    {
        return Err(StorageError::Invalid(
            "Resume Review before changing it".into(),
        ));
    }
    match command {
        ReviewCommand::Start { .. } => Err(StorageError::Invalid("Use Review start".into())),
        ReviewCommand::Next { .. } => next(db, session, candidate),
        ReviewCommand::Pause { .. } => {
            if let Some(encounter) = session.encounter.as_mut()
                && matches!(
                    encounter.conditions.delivery,
                    ReviewDelivery::Pending | ReviewDelivery::Started
                )
            {
                // Pausing releases the player; commit its interruption with the
                // session state rather than relying on a later renderer cleanup.
                encounter.conditions.delivery = ReviewDelivery::Interrupted;
            }
            session.state = ReviewSessionState::Paused;
            Ok(())
        }
        ReviewCommand::Resume { .. } => {
            if session.state != ReviewSessionState::Paused {
                return Err(StorageError::Invalid("Review is not paused".into()));
            }
            session.state =
                if session.total == Some(session.completed) && session.encounter.is_none() {
                    ReviewSessionState::Complete
                } else {
                    ReviewSessionState::Active
                };
            Ok(())
        }
        ReviewCommand::Submit { response, .. } => {
            review_attempt::submit(db, session, response, now)
        }
        ReviewCommand::Undo { .. } => review_attempt::undo(db, session),
        ReviewCommand::Correct { response, .. } => {
            review_attempt::correct(db, session, response, now)
        }
        ReviewCommand::Reveal { encounter_id, .. } => {
            let encounter = current(session, encounter_id)?;
            encounter.answer = Some(review_read::admission(db, encounter_id)?.probe.answer);
            encounter.conditions.revealed = true;
            Ok(())
        }
        ReviewCommand::Assistance {
            encounter_id,
            assistance,
            ..
        } => {
            let encounter = current(session, encounter_id)?;
            if !encounter.conditions.assistance.contains(assistance) {
                encounter.conditions.assistance.push(*assistance);
            }
            Ok(())
        }
        ReviewCommand::Delivery {
            encounter_id,
            delivery,
            ..
        } => {
            let encounter = current(session, encounter_id)?;
            if encounter.required_media.is_none() {
                return Err(StorageError::Invalid(
                    "Encounter has no required audio".into(),
                ));
            }
            let previous = encounter.conditions.delivery;
            let valid = match delivery {
                ReviewDelivery::NotRequired => false,
                ReviewDelivery::Pending => true,
                ReviewDelivery::Started => {
                    matches!(previous, ReviewDelivery::Pending | ReviewDelivery::Started)
                }
                ReviewDelivery::Completed => matches!(
                    previous,
                    ReviewDelivery::Started | ReviewDelivery::Completed
                ),
                ReviewDelivery::Interrupted | ReviewDelivery::Failed => true,
            };
            if !valid {
                return Err(StorageError::Invalid(
                    "Invalid Review audio transition".into(),
                ));
            }
            if *delivery == ReviewDelivery::Pending && previous != ReviewDelivery::Pending {
                encounter.conditions.exposure_count =
                    encounter.conditions.exposure_count.saturating_add(1);
                if !encounter
                    .conditions
                    .assistance
                    .contains(&ReviewAssistance::RepeatedExposure)
                {
                    encounter
                        .conditions
                        .assistance
                        .push(ReviewAssistance::RepeatedExposure);
                }
            }
            encounter.conditions.delivery = *delivery;
            Ok(())
        }
    }
}

pub(crate) fn current<'a>(
    session: &'a mut ReviewSession,
    id: &ReviewEncounterId,
) -> Result<&'a mut ReviewEncounter, StorageError> {
    session
        .encounter
        .as_mut()
        .filter(|value| &value.id == id)
        .ok_or_else(|| StorageError::Invalid("Encounter is not the current Review task".into()))
}
