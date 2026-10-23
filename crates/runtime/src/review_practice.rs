//! Explicit selected work, using the Review package/admission owner without due selection.
use super::*;
use mlearn_core::{AnalyzedToken, PracticeItem, SourceAnchor, SourceLocator};

impl Runtime {
    pub(super) fn validate_practice(&self, items: &[PracticeItem]) -> Result<(), Failure> {
        let materials = self
            .store
            .review_practice_materials(items)
            .map_err(storage_failure)?;
        for (item, material) in items.iter().zip(materials) {
            if let Some(anchor) = &item.source {
                self.validate_capture_source(anchor)?;
                if anchor.package_id != material.content.package_id {
                    return Err(Failure::Protocol(
                        "invalid_review",
                        "Word Practice source and Material must use the same language package"
                            .into(),
                    ));
                }
            }
        }
        Ok(())
    }
}

impl ReviewWork {
    pub(super) fn run_practice(
        &self,
        store: &ProfileStore,
        items: &[PracticeItem],
    ) -> Result<Vec<ReviewAdmission>, Failure> {
        let materials = store
            .review_practice_materials(items)
            .map_err(storage_failure)?;
        let mut admissions = Vec::new();
        for (item, material) in items.iter().zip(materials) {
            let package_id = &material.content.package_id;
            let package = self.packages.get(package_id).ok_or_else(|| {
                Failure::Operation(format!(
                    "Word Practice language package {package_id} is unavailable"
                ))
            })?;
            if !package
                .manifest
                .capabilities
                .iter()
                .any(|c| c == "learning.probes.v1")
            {
                return Err(Failure::Operation(format!(
                    "Word Practice language package {package_id} does not provide learning.probes.v1"
                )));
            }
            let work = LanguageWork {
                package: package.clone(),
                cancellation: Cancellation::durable(),
                action: LanguageAction::Describe,
            };
            let revision = package.revision()?;
            if let Some(anchor) = &item.source {
                work.validate_practice_target(&material, anchor)?;
            }
            let probes = work.review_probes(&material, &revision)?;
            if probes.is_empty() {
                return Err(Failure::Protocol(
                    "invalid_review",
                    "A selected Material has no supported Word Practice probe".into(),
                ));
            }
            for probe in probes {
                use sha2::{Digest, Sha256};
                let identity = serde_json::to_vec(&(
                    &material.id,
                    material.revision,
                    package_id,
                    &revision,
                    &probe.id,
                ))
                .map_err(|e| Failure::Operation(e.to_string()))?;
                admissions.push(ReviewAdmission {
                    work_id: ReviewWorkId(format!("{:x}", Sha256::digest(identity))),
                    material_id: material.id.clone(),
                    material_revision: material.revision,
                    package_id: package_id.clone(),
                    package_version: package.manifest.version.clone(),
                    package_revision: revision.clone(),
                    probe,
                    source: item
                        .source
                        .clone()
                        .or_else(|| material.content.source.clone()),
                    scheduler_version: REVIEW_POLICY_VERSION,
                });
            }
        }
        Ok(admissions)
    }
}

impl LanguageWork {
    fn validate_practice_target(
        &self,
        material: &Material,
        anchor: &SourceAnchor,
    ) -> Result<(), Failure> {
        let (selection_start, selection_end) = match &anchor.locator {
            SourceLocator::Video {
                selection_start,
                selection_end,
                ..
            }
            | SourceLocator::Document {
                selection_start,
                selection_end,
                ..
            }
            | SourceLocator::Image {
                selection_start,
                selection_end,
                ..
            } => (*selection_start, *selection_end),
        };
        let start =
            usize::try_from(selection_start).map_err(|e| Failure::Operation(e.to_string()))?;
        let end = usize::try_from(selection_end).map_err(|e| Failure::Operation(e.to_string()))?;
        let selected = anchor
            .text
            .get(start..end)
            .filter(|text| !text.is_empty())
            .ok_or_else(|| {
                Failure::Protocol(
                    "invalid_review",
                    "Word Practice requires a valid source selection".into(),
                )
            })?;
        let matches = match &material.content.target_id {
            None => selected == material.content.phrase,
            Some(target) => {
                let output = self.invoke(
                    "text.analyze.v1",
                    serde_json::json!({"texts":[anchor.text]}),
                )?;
                let tokens: Vec<Vec<AnalyzedToken>> = serde_json::from_value(output)
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                tokens.len() == 1
                    && tokens[0].iter().any(|token| {
                        token.start == selection_start
                            && token.end == selection_end
                            && token.text == selected
                            && token.targets.contains(target)
                    })
            }
        };
        if !matches {
            return Err(Failure::Protocol(
                "invalid_review",
                "Word Practice source selection does not match the saved Material target".into(),
            ));
        }
        Ok(())
    }
}
