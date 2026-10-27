use crate::{
    Runtime,
    execution::{Cancellation, Failure},
    guest::{LanguageAction, LanguageWork, Prepared},
};
use mlearn_core::{
    MaterialCaptureBatch, MaterialCaptureResult, MaterialCreate, MaterialWriteResult, Response,
};

#[derive(Clone, Copy)]
pub(super) enum CaptureDelivery {
    Single,
    Batch,
}

pub(super) enum CaptureAdmission {
    Ready,
    Replayed(MaterialWriteResult),
    Rejected(String),
}

pub(super) struct CaptureInput {
    pub command: MaterialCreate,
    pub admission: CaptureAdmission,
}

impl Runtime {
    pub(super) fn prepare_material_capture(
        &mut self,
        batch: MaterialCaptureBatch,
        delivery: CaptureDelivery,
    ) -> Result<Prepared, Failure> {
        if batch.commands.len() > 16 {
            return Err(Failure::Protocol(
                "invalid_request",
                "Capture batch exceeds 16 items".into(),
            ));
        }
        let mut identities = std::collections::BTreeSet::new();
        let inputs = batch
            .commands
            .into_iter()
            .map(|command| {
                let checked = (|| {
                    if !identities.insert(command.command_id.clone()) {
                        return Err(Failure::Operation(
                            "Duplicate command identity within capture batch".into(),
                        ));
                    }
                    if command.content.package_id != batch.package_id {
                        return Err(Failure::Operation(
                            "Capture item belongs to a different language".into(),
                        ));
                    }
                    if let Some(receipt) = self
                        .store
                        .material_create_receipt(&command)
                        .map_err(|e| Failure::Operation(e.to_string()))?
                    {
                        return Ok(CaptureAdmission::Replayed(receipt));
                    }
                    if let Some(anchor) = &command.content.source {
                        self.validate_capture_source(anchor)?;
                    }
                    if command.content.sense.is_some()
                        && command.content.target_id.is_some()
                        && command.content.package_revision.is_none()
                    {
                        return Err(Failure::Operation(
                            "A selected sense requires its target".into(),
                        ));
                    }
                    if command.content.target_id.is_some() {
                        let package = self.installed.get(&batch.package_id).ok_or_else(|| {
                            Failure::Operation("Language package unavailable".into())
                        })?;
                        if let Some(revision) = &command.content.package_revision
                            && package.revision()? != *revision
                        {
                            return Err(Failure::Operation(
                                "Language package changed; inspect the item before capturing"
                                    .into(),
                            ));
                        }
                    }
                    Ok(CaptureAdmission::Ready)
                })();
                CaptureInput {
                    command,
                    admission: checked
                        .unwrap_or_else(|e| CaptureAdmission::Rejected(e.to_string())),
                }
            })
            .collect::<Vec<_>>();
        let needs_lookup = inputs.iter().any(|input| {
            matches!(input.admission, CaptureAdmission::Ready)
                && input.command.content.target_id.is_some()
        });
        if needs_lookup {
            self.language_work(
                &batch.package_id,
                LanguageAction::Capture { inputs, delivery },
                Cancellation::durable(),
            )
        } else {
            let checks = inputs.iter().map(|_| Ok(())).collect();
            Ok(Prepared::Immediate(Box::new(
                self.complete_material_capture(&inputs, checks, delivery)?,
            )))
        }
    }

    pub(super) fn complete_material_capture(
        &mut self,
        inputs: &[CaptureInput],
        checks: Vec<Result<(), String>>,
        delivery: CaptureDelivery,
    ) -> Result<Response, Failure> {
        if inputs.len() != checks.len() {
            return Err(Failure::Operation(
                "Capture result count does not match admission".into(),
            ));
        }
        let mut outcomes = Vec::new();
        for (input, check) in inputs.iter().zip(checks) {
            let result = match &input.admission {
                CaptureAdmission::Replayed(receipt) => Ok(receipt.clone()),
                CaptureAdmission::Rejected(message) => Err(message.clone()),
                CaptureAdmission::Ready => check.and_then(|()| {
                    self.write_material_create(&input.command)
                        .map_err(|e| e.to_string())
                }),
            };
            outcomes.push((input.command.command_id.clone(), result));
        }
        match delivery {
            CaptureDelivery::Single => {
                let (_, result) = outcomes
                    .into_iter()
                    .next()
                    .ok_or_else(|| Failure::Operation("Missing capture command".into()))?;
                Ok(Response::MaterialWritten {
                    outcome: result.map_err(Failure::Operation)?,
                })
            }
            CaptureDelivery::Batch => {
                let results = outcomes
                    .into_iter()
                    .map(|(command_id, result)| match result {
                        Ok(MaterialWriteResult::Saved {
                            material,
                            reused,
                            committed_revision,
                        }) => MaterialCaptureResult::Saved {
                            command_id,
                            material_id: material.id,
                            committed_revision,
                            reused,
                        },
                        Ok(MaterialWriteResult::Duplicate { items }) => {
                            MaterialCaptureResult::Duplicate {
                                command_id,
                                material_ids: items.into_iter().map(|item| item.id).collect(),
                            }
                        }
                        Err(message) => MaterialCaptureResult::Failed {
                            command_id,
                            message: message.chars().take(512).collect(),
                        },
                    })
                    .collect();
                Ok(Response::MaterialCaptured { results })
            }
        }
    }
}

impl LanguageWork {
    pub(super) fn check_capture_targets(&self, inputs: &[CaptureInput]) -> Vec<Result<(), String>> {
        let schema = self.description().map_err(|e| e.to_string());
        inputs
            .iter()
            .map(|input| {
                if !matches!(input.admission, CaptureAdmission::Ready) {
                    return Ok(());
                }
                let Some(target) = &input.command.content.target_id else {
                    return Ok(());
                };
                let schema = schema.as_ref().map_err(Clone::clone)?;
                let entry = self
                    .entry_with_schema(target, schema)
                    .map_err(|e| e.to_string())?;
                if let Some(selected) = &input.command.content.sense
                    && !entry
                        .senses
                        .as_ref()
                        .is_some_and(|senses| senses.contains(selected))
                {
                    return Err("Selected dictionary sense changed; inspect the item again".into());
                }
                Ok(())
            })
            .collect()
    }
}
