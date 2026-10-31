use crate::{Runtime, execution::Failure, material_proposal::storage};
use mlearn_core::*;

impl Runtime {
    pub(super) fn validate_material_generation_basis(
        &self,
        basis: &MaterialGenerationBasis,
    ) -> Result<(), Failure> {
        match basis {
            MaterialGenerationBasis::Source { source } => self.validate_capture_source(source),
            MaterialGenerationBasis::Material { material } => {
                let original = self.store.material(&material.id).map_err(storage)?;
                if original.revision != material.revision {
                    return Err(Failure::Protocol("conflict",
                        "The authored Material changed; choose its current revision before generating or collecting proposals".into()));
                }
                Ok(())
            }
        }
    }

    pub(super) fn validate_material_generation(&self, id: &GenerationId) -> Result<(), Failure> {
        if let Some(basis) = self.store.material_generation_basis(id).map_err(storage)? {
            self.validate_material_generation_basis(&basis)?;
        }
        Ok(())
    }

    pub(super) fn collect_material_generation(
        &mut self,
        id: &GenerationId,
    ) -> Result<MaterialGenerationReport, Failure> {
        let current = self.store.material_generation(id).map_err(storage)?;
        if current.collected {
            return Ok(current);
        }
        self.validate_material_generation(id)?;
        self.store.collect_material_generation(id).map_err(storage)
    }
}
