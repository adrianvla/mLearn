//! Explicit selected work, using the Review package/admission owner without due selection.
use super::*;
use mlearn_core::PracticeItem;

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
                    .review_tasks(target, &revision, None)?
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
                    subject: mlearn_core::ReviewSubject::Material {
                        material_id: material.id.clone(),
                        material_revision: material.revision,
                    },
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
    pub(super) fn review_tasks(
        &self,
        target: &str,
        revision: &str,
        eligible_keys: Option<&[mlearn_core::KnowledgeKey]>,
    ) -> Result<Vec<mlearn_core::PackageTask>, Failure> {
        use mlearn_core::{KnowledgeKey, ResponseSpec, TaskInput, TaskOutput};
        let entry = self.entry(target)?;
        let package = &self.package.manifest.id;
        let supported: Vec<_> = entry
            .capabilities
            .iter()
            .map(|capability| KnowledgeKey {
                package_id: package.clone(),
                target_id: target.into(),
                capability: capability.id.clone(),
            })
            .collect();
        let eligible_keys = eligible_keys.unwrap_or(&supported);
        if eligible_keys.iter().any(|key| !supported.contains(key)) {
            return Err(Failure::Protocol(
                "invalid_review",
                "Requested practice capability is not supported by this target".into(),
            ));
        }
        let input = TaskInput {
            contract_version: 2,
            package_id: package.clone(),
            package_revision: revision.into(),
            target_id: target.into(),
            eligible_keys: eligible_keys.to_vec(),
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
            let tested_key = |key: &KnowledgeKey| input.eligible_keys.contains(key);
            // Disclosures describe visible information, not additional tested work.
            // A narrowly scoped task can honestly disclose a sibling capability.
            let disclosed_key = |key: &KnowledgeKey| supported.contains(key);
            if !mlearn_core::review_compatible(&task.probe)
                || !ids.insert(&task.probe.id)
                || task.probe.required_media.is_some()
                || task.probe.targets.iter().any(|row| {
                    row.key.as_ref().is_none_or(|key| {
                        !tested_key(key) || !tested.insert(key.capability.as_str())
                    })
                })
                || task.probe.supplied.iter().any(|key| !disclosed_key(key))
                || task
                    .task
                    .answer_supplied
                    .iter()
                    .any(|key| !disclosed_key(key))
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
}
