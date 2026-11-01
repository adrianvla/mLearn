//! Staged package validation; only its checked result reaches the Review transaction.
use super::*;
use mlearn_core::*;
use std::sync::atomic::{AtomicU64, Ordering};

impl Runtime {
    pub(super) fn prepare_review_capture(
        &mut self,
        command: ReviewCommand,
        cancellation: Cancellation,
    ) -> Result<Prepared, Failure> {
        let admission = self
            .store
            .review_capture_admission(&command)
            .map_err(storage_failure)?;
        let package = self
            .installed
            .get(&admission.package_id)
            .ok_or_else(|| {
                Failure::Operation("The admitted validation package is unavailable".into())
            })?
            .clone();
        if package.revision()? != admission.package_revision {
            return Err(Failure::Operation(
                "The admitted validation package changed; the saved task was not regraded".into(),
            ));
        }
        let ReviewCommand::CaptureResponse { mutation, .. } = &command else {
            return Err(Failure::Operation(
                "Expected a captured Review response".into(),
            ));
        };
        // Weak entries never retain guest work. Prune on admission and bound live
        // sessions independently of the executor's ordinary call admission.
        self.review_validations
            .retain(|_, value| value.strong_count() > 0);
        let token = match self
            .review_validations
            .get(&mutation.session_id.0)
            .and_then(std::sync::Weak::upgrade)
        {
            Some(token) => token,
            None => {
                if self.review_validations.len() >= 32 {
                    return Err(Failure::Busy);
                }
                let token = Arc::new(AtomicU64::new(0));
                self.review_validations
                    .insert(mutation.session_id.0.clone(), Arc::downgrade(&token));
                token
            }
        };
        let epoch = token.load(Ordering::Acquire);
        Ok(Prepared::Work(GuestWork::Language(Box::new(
            LanguageWork {
                package,
                cancellation: Cancellation {
                    value: token,
                    epoch,
                    operation: cancellation.operation,
                },
                action: LanguageAction::ReviewCapture {
                    command: Box::new(command),
                    admission: Box::new(admission),
                },
            },
        ))))
    }

    pub(super) fn cancel_review_validation(&mut self, session: &ReviewSessionId) {
        if let Some(token) = self
            .review_validations
            .remove(&session.0)
            .and_then(|value| value.upgrade())
        {
            token.fetch_add(1, Ordering::Release);
        }
    }

    pub(crate) fn complete_review_capture(
        &mut self,
        work: &LanguageWork,
        command: &ReviewCommand,
        admission: &ReviewAdmission,
        output: &ValidationOutput,
    ) -> Result<Response, Failure> {
        if work.package.revision()? != admission.package_revision {
            return Err(Failure::Protocol(
                "conflict",
                "The admitted validation package changed".into(),
            ));
        }
        work.cancellation.check()?;
        let commit = self
            .store
            .review_capture(command, output, now()?)
            .map_err(storage_failure)?;
        self.cancel_review_validation(&commit.session.id);
        Ok(Response::Review { commit })
    }
}

impl LanguageWork {
    pub(crate) fn validate_review_response(
        &self,
        command: &ReviewCommand,
        admission: &ReviewAdmission,
    ) -> Result<ValidationOutput, Failure> {
        let ReviewCommand::CaptureResponse { response, .. } = command else {
            return Err(Failure::Operation(
                "Expected a captured Review response".into(),
            ));
        };
        let task = admission
            .task
            .as_ref()
            .ok_or_else(|| Failure::Operation("Missing admitted response specification".into()))?;
        response
            .validate(&task.response_spec)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let input = ValidationInput {
            contract_version: 1,
            package_id: admission.package_id.clone(),
            package_revision: admission.package_revision.clone(),
            task_id: admission.probe.id.clone(),
            task_revision: task.revision,
            validator_id: task.validator_id.clone().ok_or_else(|| {
                Failure::Operation("Self-report has no executed validator".into())
            })?,
            response: response.clone(),
        };
        input
            .validate(&admission.package_id)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let value = self.invoke(
            "learning.validate.v1",
            serde_json::to_value(&input).map_err(|error| Failure::Operation(error.to_string()))?,
        )?;
        let output: ValidationOutput =
            serde_json::from_value(value).map_err(|error| Failure::Operation(error.to_string()))?;
        let rows: Vec<_> = admission
            .probe
            .targets
            .iter()
            .map(|row| row.id.as_str())
            .collect();
        output
            .validate(&input, &rows)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        Ok(output)
    }
}
