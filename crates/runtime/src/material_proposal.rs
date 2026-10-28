use crate::{Runtime, execution::Failure};
use mlearn_core::*;

pub(super) fn storage(error: mlearn_storage::StorageError) -> Failure {
    let code = if matches!(error, mlearn_storage::StorageError::Conflict) {
        "conflict"
    } else {
        "invalid_material_proposal"
    };
    Failure::Protocol(code, error.to_string())
}

impl Runtime {
    pub(super) fn material_proposal_metadata(
        &mut self,
        request: Request,
        epoch: u64,
    ) -> Result<Response, Failure> {
        match request {
            Request::MaterialGeneration { id } => Ok(Response::MaterialGeneration {
                report: self.store.material_generation(&id).map_err(storage)?,
            }),
            Request::MaterialGenerations { after } => Ok(Response::MaterialGenerations {
                page: self
                    .store
                    .material_generations(after.as_ref())
                    .map_err(storage)?,
            }),
            Request::CollectMaterialGeneration { id } => Ok(Response::MaterialGeneration {
                report: self.collect_material_generation(&id)?,
            }),
            Request::MaterialProposals { query } => Ok(Response::MaterialProposals {
                page: self.store.material_proposals(&query).map_err(storage)?,
            }),
            Request::MaterialProposal { id } => Ok(Response::MaterialProposal {
                proposal: self.store.material_proposal(&id).map_err(storage)?,
            }),
            Request::SuggestMaterial { command } => {
                if let Some(receipt) = self
                    .store
                    .material_proposal_suggestion_receipt(&command)
                    .map_err(storage)?
                {
                    return Ok(Response::MaterialProposalReviewed { receipt });
                }
                // Existing Material already owns its dictionary/source identity.
                // Fresh source proposals are text drafts, not invented dictionary entries.
                if command.replaces.is_none() {
                    if command.content.target_id.is_some() || command.content.sense.is_some() {
                        return Err(Failure::Operation(
                            "Suggest source text or choose existing Material; a proposal cannot invent dictionary identity".into(),
                        ));
                    }
                    let source = command.content.source.as_ref().ok_or_else(|| {
                        Failure::Operation("Choose source text before suggesting Material".into())
                    })?;
                    self.validate_capture_source(source)?;
                }
                Ok(Response::MaterialProposalReviewed {
                    receipt: self.store.suggest_material(&command).map_err(storage)?,
                })
            }
            Request::ReviewMaterialProposal { command } => {
                if let Some(receipt) = self
                    .store
                    .material_proposal_review_receipt(&command)
                    .map_err(storage)?
                {
                    return Ok(Response::MaterialProposalReviewed { receipt });
                }
                let proposal = self.store.material_proposal(&command.id).map_err(storage)?;
                if matches!(command.decision, MaterialProposalDecision::Accept { .. })
                    && proposal.replaces.is_none()
                {
                    let source = proposal.content.source.as_ref().ok_or_else(|| {
                        Failure::Operation("The proposal's original source is unavailable".into())
                    })?;
                    self.validate_capture_source(source)?;
                }
                Ok(Response::MaterialProposalReviewed {
                    receipt: self
                        .store
                        .review_material_proposal(&command)
                        .map_err(storage)?,
                })
            }
            Request::ReturnMaterialProposalSource { id } => {
                let proposal = self.store.material_proposal(&id).map_err(storage)?;
                let source = proposal.content.source.ok_or_else(|| {
                    Failure::Operation("This authored Material has no source association".into())
                })?;
                self.return_source_anchor(source, epoch)
            }
            _ => Err(Failure::Operation("Not a Material proposal action".into())),
        }
    }
}
