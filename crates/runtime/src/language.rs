use crate::{execution::Failure, guest::LanguageWork};
use mlearn_core::{LanguageDescription, LexicalEntry};
use serde_json::Value;

impl LanguageWork {
    pub(super) fn invoke(&self, capability: &str, input: Value) -> Result<Value, Failure> {
        self.cancellation.invoke(&self.package, capability, input)
    }
    pub(super) fn description(&self) -> Result<LanguageDescription, Failure> {
        let id = &self.package.manifest.id;
        let description: LanguageDescription = serde_json::from_value(self.invoke("language.describe.v1", Value::Null)?)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        if !description.capabilities.iter().any(|c| c.id == description.annotation_capability)
            || description.capabilities.is_empty()
            || description.capabilities.len() > 8
            || description.capabilities.iter().any(|c| {
                !c.id.starts_with(&format!("{id}:")) || c.id.len() > 256 || c.label.len() > 128
            })
        {
            return Err(Failure::Operation("Invalid package capability schema".into()));
        }
        Ok(description)
    }
    pub(super) fn entry(&self, target: &str) -> Result<LexicalEntry, Failure> {
        if target.len() > 512 { return Err(Failure::Operation("Target id exceeds limit".into())); }
        let entry: LexicalEntry = serde_json::from_value(self.invoke("target.inspect.v1", serde_json::json!({"targetId":target}))?)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        if entry.target_id != target || entry.definition.len() > 32768 || entry.headword.len() > 512
            || entry.summary.as_ref().is_some_and(|summary| summary.is_empty() || summary.len() > 32768)
            || entry.senses.as_ref().is_some_and(|senses| {
                senses.is_empty() || senses.len() > 128 || senses.iter().any(|sense| {
                    sense.heading.len() > 512 || sense.labels.len() > 32 || sense.notes.len() > 32
                        || sense.definitions.is_empty() || sense.definitions.len() > 128
                        || sense.labels.iter().any(|label| label.len() > 512)
                        || sense.notes.iter().any(|note| note.len() > 2048)
                        || sense.definitions.iter().any(|definition| definition.is_empty() || definition.len() > 32768)
                })
            })
            || serde_json::to_vec(&entry).map_err(|e| Failure::Operation(e.to_string()))?.len() > 65536
        {
            return Err(Failure::Operation("Invalid inspected entry".into()));
        }
        let schema = self.description()?;
        if entry.capabilities.iter().any(|c| !schema.capabilities.contains(c)) {
            return Err(Failure::Operation("Entry declares an unavailable capability".into()));
        }
        Ok(entry)
    }
}
