//! Canonical tasks use the same admitted Review work without creating Materials.
use super::*;
use mlearn_core::{KnowledgeKey, ReviewAssistance, TargetPracticeItem};

impl Runtime {
    pub(crate) fn validate_target_practice(
        &self,
        items: &[TargetPracticeItem],
        assistance: &[ReviewAssistance],
    ) -> Result<(), Failure> {
        self.store
            .review_practice_targets(items, assistance)
            .map_err(storage_failure)?;
        for item in items {
            if let Some(anchor) = &item.source {
                self.validate_capture_source(anchor)?;
                if anchor.package_id != item.package_id {
                    return Err(Failure::Protocol(
                        "invalid_review",
                        "Practice source belongs to another package".into(),
                    ));
                }
            }
        }
        Ok(())
    }
}

impl ReviewWork {
    pub(super) fn run_target_practice(
        &self,
        store: &ProfileStore,
        items: &[TargetPracticeItem],
        assistance: &[ReviewAssistance],
    ) -> Result<Vec<ReviewAdmission>, Failure> {
        store
            .review_practice_targets(items, assistance)
            .map_err(storage_failure)?;
        let mut admissions = Vec::new();
        for item in items {
            let package = self.packages.get(&item.package_id).ok_or_else(|| {
                Failure::Operation(format!(
                    "Practice language package {} is unavailable",
                    item.package_id
                ))
            })?;
            let revision = package.revision()?;
            if revision != item.package_revision
                || !package
                    .manifest
                    .capabilities
                    .iter()
                    .any(|capability| capability == "learning.probes.v2")
            {
                return Err(Failure::Protocol(
                    "invalid_review",
                    "Selected target package revision or learning capability is unavailable".into(),
                ));
            }
            let work = LanguageWork {
                package: package.clone(),
                cancellation: Cancellation::durable(),
                action: LanguageAction::Describe,
            };
            if let Some(anchor) = &item.source {
                work.validate_canonical_practice_source(&item.target_id, anchor)?;
            }
            let keys: Vec<_> = item
                .capabilities
                .iter()
                .map(|capability| KnowledgeKey {
                    package_id: item.package_id.clone(),
                    target_id: item.target_id.clone(),
                    capability: capability.clone(),
                })
                .collect();
            // The package owner resolves identity and rejects unsupported scope.
            let tasks = work.review_tasks(&item.target_id, &revision, Some(&keys))?;
            for task in tasks {
                use sha2::{Digest, Sha256};
                let identity = serde_json::to_vec(&(
                    "canonical-target",
                    &item.package_id,
                    &revision,
                    &item.target_id,
                    &task.probe.id,
                    &task.probe,
                    &task.task,
                ))
                .map_err(|error| Failure::Operation(error.to_string()))?;
                admissions.push(ReviewAdmission {
                    work_id: ReviewWorkId(format!("{:x}", Sha256::digest(identity))),
                    subject: mlearn_core::ReviewSubject::Target {
                        target_id: item.target_id.clone(),
                    },
                    package_id: item.package_id.clone(),
                    package_version: package.manifest.version.clone(),
                    package_revision: revision.clone(),
                    probe: task.probe,
                    source: item.source.clone(),
                    scheduler_version: REVIEW_POLICY_VERSION,
                    task: Some(task.task),
                });
            }
        }
        Ok(admissions)
    }
}

impl LanguageWork {
    pub(crate) fn source_practice(
        &self,
        targets: &[mlearn_core::SourcePracticeTarget],
    ) -> Result<Vec<TargetPracticeItem>, Failure> {
        let schema = self.description()?;
        let revision = self.package.revision()?;
        let mut items = Vec::with_capacity(targets.len());
        for target in targets {
            self.cancellation.check()?;
            let entry = self.entry_with_schema(&target.target_id, &schema)?;
            let capabilities = entry
                .canonical_practice_capabilities
                .filter(|capabilities| !capabilities.is_empty())
                .ok_or_else(|| {
                    Failure::Operation(format!(
                        "Selected target {} has no package-supported canonical Practice",
                        target.target_id
                    ))
                })?;
            self.validate_canonical_practice_source(&target.target_id, &target.source)?;
            items.push(TargetPracticeItem {
                package_id: self.package.manifest.id.clone(),
                package_revision: revision.clone(),
                target_id: target.target_id.clone(),
                capabilities,
                source: Some(target.source.clone()),
            });
        }
        Ok(items)
    }
}
