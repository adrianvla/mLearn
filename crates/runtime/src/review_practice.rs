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
                .any(|c| c == "learning.probes.v1" || c == "learning.probes.v2")
            {
                return Err(Failure::Operation(format!(
                    "Word Practice language package {package_id} does not provide supported learning tasks"
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
            let mut tasks: Vec<_> = if package
                .manifest
                .capabilities
                .iter()
                .any(|id| id == "learning.probes.v1")
            {
                work.review_probes(&material, &revision)?
                    .into_iter()
                    .map(|probe| (probe, None))
                    .collect()
            } else {
                Vec::new()
            };
            // A package may explicitly omit a valid target from its v1 family.
            // Only then ask its declared v2 family; errors never trigger fallback.
            if tasks.is_empty()
                && package
                    .manifest
                    .capabilities
                    .iter()
                    .any(|id| id == "learning.probes.v2")
                && let Some(target) = material.content.target_id.as_deref()
            {
                tasks = work
                    .review_tasks(target, &revision)?
                    .into_iter()
                    .map(|task| (task.probe, Some(task.task)))
                    .collect();
            }
            if tasks.is_empty() {
                return Err(Failure::Protocol(
                    "invalid_review",
                    "A selected Material has no supported Word Practice probe".into(),
                ));
            }
            for (probe, task) in tasks {
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
                    task,
                });
            }
        }
        Ok(admissions)
    }
}

impl LanguageWork {
    fn review_tasks(
        &self,
        target: &str,
        revision: &str,
    ) -> Result<Vec<mlearn_core::PackageTask>, Failure> {
        use mlearn_core::{KnowledgeKey, ResponseSpec, TaskInput, TaskOutput};
        let entry = self.entry(target)?;
        let package = &self.package.manifest.id;
        let input = TaskInput {
            contract_version: 2,
            package_id: package.clone(),
            package_revision: revision.into(),
            target_id: target.into(),
            eligible_keys: entry
                .capabilities
                .iter()
                .map(|capability| KnowledgeKey {
                    package_id: package.clone(),
                    target_id: target.into(),
                    capability: capability.id.clone(),
                })
                .collect(),
        };
        input
            .validate(package)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let value = self.invoke(
            "learning.probes.v2",
            serde_json::to_value(&input).map_err(|error| Failure::Operation(error.to_string()))?,
        )?;
        if serde_json::to_vec(&value)
            .map_err(|error| Failure::Operation(error.to_string()))?
            .len()
            > 131_072
        {
            return Err(Failure::Operation(
                "Package task output exceeds its bound".into(),
            ));
        }
        let output: TaskOutput =
            serde_json::from_value(value).map_err(|error| Failure::Operation(error.to_string()))?;
        if output.contract_version != 2 || !(1..=8).contains(&output.tasks.len()) {
            return Err(Failure::Operation(
                "Unsupported or empty package task output".into(),
            ));
        }
        let mut ids = std::collections::BTreeSet::new();
        let mut tested = std::collections::BTreeSet::new();
        for task in &output.tasks {
            task.task
                .validate()
                .map_err(|error| Failure::Operation(error.to_string()))?;
            let valid_key = |key: &KnowledgeKey| input.eligible_keys.contains(key);
            if !mlearn_core::review_compatible(&task.probe)
                || !ids.insert(&task.probe.id)
                || task.probe.required_media.is_some()
                || task.probe.targets.iter().any(|row| {
                    row.key.as_ref().is_none_or(|key| {
                        !valid_key(key) || !tested.insert(key.capability.as_str())
                    })
                })
                || task.probe.supplied.iter().any(|key| !valid_key(key))
                || task.task.answer_supplied.iter().any(|key| !valid_key(key))
                || (!matches!(task.task.response_spec, ResponseSpec::SelfReport)
                    && !self
                        .package
                        .manifest
                        .capabilities
                        .iter()
                        .any(|id| id == "learning.validate.v1"))
            {
                return Err(Failure::Operation(
                    "Package task widened or duplicated the admitted scope".into(),
                ));
            }
        }
        if tested.len() != input.eligible_keys.len() {
            return Err(Failure::Operation(
                "Package does not support all requested task directions".into(),
            ));
        }
        Ok(output.tasks)
    }

    fn validate_practice_target(
        &self,
        material: &Material,
        anchor: &SourceAnchor,
    ) -> Result<(), Failure> {
        let (selection_start, selection_end) = match &anchor.locator {
            SourceLocator::Message {
                selection_start,
                selection_end,
                ..
            }
            | SourceLocator::Video {
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
