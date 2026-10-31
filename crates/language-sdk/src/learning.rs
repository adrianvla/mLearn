//! Versioned learning task wire types. Packages own linguistic task semantics.
use serde::{Deserialize, Serialize};

pub mod tasks;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProbeInput {
    pub material_id: String,
    pub material_revision: u32,
    pub package_id: String,
    pub package_revision: String,
    pub target_id: Option<String>,
    pub phrase: String,
    pub reading: String,
    pub meaning: String,
    pub context: String,
    pub media: Vec<ProbeMedia>,
}

impl ProbeInput {
    pub fn validate(&self, package: &str) -> Result<(), String> {
        if self.package_id != package
            || self.material_id.is_empty()
            || self.material_id.len() > 512
            || self.material_revision == 0
            || self.package_revision.is_empty()
            || self.package_revision.len() > 512
            || self.phrase.len() > 2048
            || self.reading.len() > 2048
            || [&self.meaning, &self.context]
                .iter()
                .any(|value| value.len() > 32768)
            || self
                .target_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 512)
            || self.media.len() > 32
            || self
                .media
                .iter()
                .any(|media| media.id.is_empty() || media.id.len() > 512)
        {
            return Err("Invalid learning.probes.v1 input or package identity".into());
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProbeMedia {
    pub id: String,
    pub kind: MediaKind,
    pub bound_to_target: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Image,
    Audio,
    Video,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOutput {
    pub contract_version: u32,
    pub probes: Vec<ReviewProbe>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewProbe {
    pub id: String,
    pub contract_version: u32,
    pub direction: ReviewDirection,
    pub cue: String,
    pub answer: String,
    pub targets: Vec<ReviewTarget>,
    pub supplied: Vec<KnowledgeKey>,
    pub required_media: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDirection {
    Written,
    Focused,
    Audio,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewTarget {
    pub id: String,
    pub label: String,
    pub mnemonic: Option<String>,
    pub key: Option<KnowledgeKey>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeKey {
    pub package_id: String,
    pub target_id: String,
    pub capability: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input() -> serde_json::Value {
        json!({"materialId":"m1","materialRevision":1,"packageId":"org.example.language",
            "packageRevision":"r1","targetId":null,"phrase":"word","reading":"","meaning":"definition",
            "context":"","media":[]})
    }

    #[test]
    fn untrusted_binding_must_be_explicit_on_every_media_item() {
        // Given a clip without the explicit target-binding assertion.
        let mut value = input();
        value["media"] = json!([{"id":"a1","kind":"audio"}]);
        // When parsing the SDK boundary.
        let result = serde_json::from_value::<ProbeInput>(value);
        // Then absent binding is not silently interpreted as valid audio.
        assert!(result.is_err());
    }

    #[test]
    fn package_identity_and_material_bounds_are_enforced_at_input() {
        // Given valid Material content and another exceeding its content budget.
        let valid: ProbeInput = serde_json::from_value(input()).unwrap();
        let mut oversized = input();
        oversized["meaning"] = json!("b".repeat(32769));
        let oversized: ProbeInput = serde_json::from_value(oversized).unwrap();
        // When accepting the tasks for a particular package.
        let same_package = valid.validate("org.example.language");
        let other_package = valid.validate("org.example.other");
        let over_budget = oversized.validate("org.example.language");
        // Then only the matching bounded task is valid.
        assert!(same_package.is_ok());
        assert!(other_package.is_err());
        assert!(over_budget.is_err());
    }
    #[test]
    fn valid_large_material_remains_available_for_package_eligibility() {
        // Given valid large authored content and a full-size identity.
        let mut value = input();
        value["meaning"] = json!("m".repeat(32768));
        value["context"] = json!("c".repeat(32768));
        value["targetId"] = json!("t".repeat(512));
        let value: ProbeInput = serde_json::from_value(value).unwrap();
        // When accepting input before per-direction output eligibility.
        let result = value.validate("org.example.language");
        // Then valid Material is not a task-generation error.
        assert!(result.is_ok());
    }
}
