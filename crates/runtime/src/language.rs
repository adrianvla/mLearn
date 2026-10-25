use crate::{execution::Failure, guest::LanguageWork};
use mlearn_core::{
    AggregateClaim, KnowledgeKey, LanguageDescription, LexicalEntry, TargetKnowledge,
};
use serde_json::Value;

impl LanguageWork {
    pub(super) fn invoke(&self, capability: &str, input: Value) -> Result<Value, Failure> {
        self.cancellation.invoke(&self.package, capability, input)
    }
    pub(super) fn description(&self) -> Result<LanguageDescription, Failure> {
        let id = &self.package.manifest.id;
        let description: LanguageDescription =
            serde_json::from_value(self.invoke("language.describe.v1", Value::Null)?)
                .map_err(|e| Failure::Operation(e.to_string()))?;
        if !description
            .capabilities
            .iter()
            .any(|c| c.id == description.annotation_capability)
            || description.capabilities.is_empty()
            || description.capabilities.len() > 8
            || description.capabilities.iter().any(|c| {
                !c.id.starts_with(&format!("{id}:")) || c.id.len() > 256 || c.label.len() > 128
            })
        {
            return Err(Failure::Operation(
                "Invalid package capability schema".into(),
            ));
        }
        let mut scales = std::collections::BTreeSet::new();
        let declared_scales = description.level_scales.as_deref().unwrap_or_default();
        if declared_scales.len() > 16
            || declared_scales.iter().any(|scale| {
                !scale.id.starts_with(&format!("{id}:"))
                    || scale.id.len() > 512
                    || !scales.insert(&scale.id)
                    || scale.label.is_empty()
                    || scale.label.len() > 128
                    || scale.attribution.is_empty()
                    || scale.attribution.len() > 2048
            })
        {
            return Err(Failure::Operation("Invalid package level scales".into()));
        }
        Ok(description)
    }
    pub(super) fn entry(&self, target: &str) -> Result<LexicalEntry, Failure> {
        self.entry_with_schema(target, &self.description()?)
    }
    pub(super) fn entry_with_schema(
        &self,
        target: &str,
        schema: &LanguageDescription,
    ) -> Result<LexicalEntry, Failure> {
        if target.len() > 512 {
            return Err(Failure::Operation("Target id exceeds limit".into()));
        }
        let entry: LexicalEntry = serde_json::from_value(
            self.invoke("target.inspect.v1", serde_json::json!({"targetId":target}))?,
        )
        .map_err(|e| Failure::Operation(e.to_string()))?;
        if entry.target_id != target
            || entry.definition.len() > 32768
            || entry.headword.len() > 512
            || entry
                .summary
                .as_ref()
                .is_some_and(|summary| summary.is_empty() || summary.len() > 32768)
            || entry.senses.as_ref().is_some_and(|senses| {
                senses.is_empty()
                    || senses.len() > 128
                    || senses.iter().any(|sense| {
                        sense.heading.len() > 512
                            || sense.labels.len() > 32
                            || sense.notes.len() > 32
                            || sense.definitions.is_empty()
                            || sense.definitions.len() > 128
                            || sense.labels.iter().any(|label| label.len() > 512)
                            || sense.notes.iter().any(|note| note.len() > 2048)
                            || sense
                                .definitions
                                .iter()
                                .any(|definition| definition.is_empty() || definition.len() > 32768)
                    })
            })
            || serde_json::to_vec(&entry)
                .map_err(|e| Failure::Operation(e.to_string()))?
                .len()
                > 65536
        {
            return Err(Failure::Operation("Invalid inspected entry".into()));
        }
        crate::linguistic::validate(
            &entry.presentation,
            &entry.headword,
            &self.package.manifest.id,
        )?;
        let ids = entry
            .capabilities
            .iter()
            .map(|c| &c.id)
            .collect::<std::collections::BTreeSet<_>>();
        if entry.capabilities.len() > 8
            || ids.len() != entry.capabilities.len()
            || entry
                .capabilities
                .iter()
                .any(|c| !schema.capabilities.contains(c))
        {
            return Err(Failure::Operation(
                "Entry declares an unavailable capability".into(),
            ));
        }
        Ok(entry)
    }
}

impl crate::Runtime {
    pub(super) fn target_knowledge(
        &self,
        package: &str,
        entry: &LexicalEntry,
    ) -> Result<TargetKnowledge, Failure> {
        let keys = entry
            .capabilities
            .iter()
            .map(|cap| KnowledgeKey {
                package_id: package.into(),
                target_id: entry.target_id.clone(),
                capability: cap.id.clone(),
            })
            .collect::<Vec<_>>();
        // Read after guest completion: a claim admitted during lookup is visible.
        let projections = self
            .store
            .knowledge(&keys)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        let claim = if projections.is_empty() {
            AggregateClaim::Unavailable
        } else if projections.iter().all(|p| p.claim.is_none()) {
            AggregateClaim::Untracked
        } else if projections.iter().all(|p| p.claim == Some(true)) {
            AggregateClaim::ClaimedKnown
        } else if projections.iter().all(|p| p.claim == Some(false)) {
            AggregateClaim::ClaimedUnknown
        } else {
            AggregateClaim::Mixed
        };
        Ok(TargetKnowledge { projections, claim })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Runtime;
    use mlearn_core::ClaimChange;
    use mlearn_language_host::CodePolicy;
    use serde_json::json;

    #[test]
    fn selected_target_claims_remain_granular_current_and_durable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("profile");
        let mut runtime = Runtime::open(&path, CodePolicy::MobileBundled, None, vec![]).unwrap();
        let mut entry: LexicalEntry = serde_json::from_value(json!({
            "targetId":"target-a","headword":"entry","reading":null,"partOfSpeech":"noun",
            "definition":"Definition","summary":null,"senses":null,"attribution":"Dictionary",
            "capabilities":[{"id":"org.example:form","label":"Form"},{"id":"org.example:meaning","label":"Meaning"}]
        })).unwrap();
        assert_eq!(
            runtime
                .target_knowledge("org.example", &entry)
                .unwrap()
                .claim,
            AggregateClaim::Untracked
        );
        for (step, (index, claim, expected)) in [
            (0, Some(true), AggregateClaim::Mixed),
            (1, Some(true), AggregateClaim::ClaimedKnown),
            (0, None, AggregateClaim::Mixed),
            (1, None, AggregateClaim::Untracked),
            (0, Some(false), AggregateClaim::Mixed),
            (1, Some(false), AggregateClaim::ClaimedUnknown),
        ]
        .into_iter()
        .enumerate()
        {
            runtime
                .store
                .change_claim(&ClaimChange {
                    key: KnowledgeKey {
                        package_id: "org.example".into(),
                        target_id: entry.target_id.clone(),
                        capability: entry.capabilities[index].id.clone(),
                    },
                    claim,
                    command_id: format!("claim-{step}"),
                })
                .unwrap();
            let knowledge = runtime.target_knowledge("org.example", &entry).unwrap();
            assert_eq!(knowledge.claim, expected);
            assert!(
                knowledge
                    .projections
                    .iter()
                    .all(|p| p.assessed.is_none() && p.prediction.is_none())
            );
        }
        drop(runtime);
        let runtime = Runtime::open(&path, CodePolicy::MobileBundled, None, vec![]).unwrap();
        assert_eq!(
            runtime
                .target_knowledge("org.example", &entry)
                .unwrap()
                .claim,
            AggregateClaim::ClaimedUnknown
        );
        entry.target_id = "unrelated-alternative".into();
        assert_eq!(
            runtime
                .target_knowledge("org.example", &entry)
                .unwrap()
                .claim,
            AggregateClaim::Untracked
        );
        entry.capabilities.clear();
        assert_eq!(
            runtime
                .target_knowledge("org.example", &entry)
                .unwrap()
                .claim,
            AggregateClaim::Unavailable
        );
    }
}
