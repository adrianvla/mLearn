use crate::{
    Runtime,
    execution::{Cancellation, Failure},
    guest::{LanguageAction, Prepared},
};
use mlearn_core::{MaterialEdit, Request, Response};

impl Runtime {
    pub(super) fn prepare_material_edit(
        &mut self,
        command: MaterialEdit,
    ) -> Result<Prepared, Failure> {
        if let Some(outcome) = self
            .store
            .material_edit_receipt(&command)
            .map_err(|e| Failure::Operation(e.to_string()))?
        {
            return Ok(Prepared::Immediate(Box::new(Response::MaterialWritten {
                outcome,
            })));
        }
        let current = self
            .store
            .material(&command.id)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        if current.revision != command.expected_revision {
            return Err(Failure::Protocol(
                "conflict",
                "Material changed elsewhere; reload before saving".into(),
            ));
        }
        if current.content.source != command.content.source
            && let Some(anchor) = &command.content.source
        {
            self.validate_capture_source(anchor)?;
        }
        if command.content.target_id.is_some()
            && (current.content.package_id != command.content.package_id
                || current.content.target_id != command.content.target_id
                || current.content.package_revision != command.content.package_revision
                || current.content.sense != command.content.sense)
        {
            let package_id = command.content.package_id.clone();
            let package = self
                .installed
                .get(&package_id)
                .ok_or_else(|| Failure::Operation("Language package unavailable".into()))?;
            let revision = package.revision()?;
            if command.content.sense.is_some() && command.content.package_revision.is_none()
                || command
                    .content
                    .package_revision
                    .as_ref()
                    .is_some_and(|expected| expected != &revision)
            {
                return Err(Failure::Operation(
                    "Inspect the current target before changing its dictionary identity".into(),
                ));
            }
            return self.language_work(
                &package_id,
                LanguageAction::EditMaterial(Box::new(command)),
                Cancellation::durable(),
            );
        }
        Ok(Prepared::Immediate(Box::new(Response::MaterialWritten {
            outcome: self.write_material_edit(&command)?,
        })))
    }

    pub(super) fn material_metadata(
        &mut self,
        request: Request,
        epoch: u64,
    ) -> Result<Response, Failure> {
        match request {
            Request::PlanMaterialMedia { request } => self.plan_material_media(&request, epoch),
            Request::MaterialMedia { id } => self.material_media_location(&id),
            Request::Materials { query } => Ok(Response::Materials {
                page: self
                    .store
                    .materials(&query)
                    .map_err(|e| Failure::Operation(e.to_string()))?,
            }),
            Request::Material { id } => Ok(Response::Material {
                material: self
                    .store
                    .material(&id)
                    .map_err(|e| Failure::Operation(e.to_string()))?,
            }),
            Request::MaterialEligibility { targets } => Ok(Response::MaterialEligibility {
                items: self
                    .store
                    .capture_eligibility(&targets)
                    .map_err(|e| Failure::Operation(e.to_string()))?,
            }),
            Request::SetCaptureExclusion { command } => Ok(Response::CaptureExclusionChanged {
                item: self
                    .store
                    .set_capture_exclusion(&command)
                    .map_err(|e| Failure::Operation(e.to_string()))?,
            }),
            Request::ReturnMaterialSource { id } => self.return_material_source(&id, epoch),
            _ => Err(Failure::Operation(
                "Not a Material metadata operation".into(),
            )),
        }
    }
}
