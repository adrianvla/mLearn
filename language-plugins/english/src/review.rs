use super::{PACKAGE, validate_target};
use mlearn_language_sdk::{
    learning::{KnowledgeKey, MediaKind, ProbeInput, ProbeOutput, ReviewDirection, ReviewProbe, ReviewTarget},
    serde_json::{self, Value},
};

pub(super) fn generate(
    value: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let input: ProbeInput = serde_json::from_value(value).map_err(|error| error.to_string())?;
    input.validate(PACKAGE)?;
    if let Some(target) = &input.target_id {
        validate_target(target, lookup)?;
    }
    let key = |capability: &str| input.target_id.as_ref().map(|target| KnowledgeKey {
        package_id: PACKAGE.into(),
        target_id: target.clone(),
        capability: format!("{PACKAGE}:{capability}"),
    });
    let row = |capability: &str, label: &str| ReviewTarget {
        id: capability.into(), label: label.into(), mnemonic: None, key: key(capability),
    };
    let mut probes = Vec::new();
    let meaning = input.meaning.trim();
    if !input.phrase.trim().is_empty() && !meaning.is_empty() && !input.phrase.to_lowercase().contains(&meaning.to_lowercase()) {
        probes.push(ReviewProbe {
            id: "written".into(), contract_version: 1, direction: ReviewDirection::Written,
            cue: input.phrase.clone(), answer: meaning.into(),
            targets: vec![row("meaning", "Meaning")],
            supplied: key("written-recognition").into_iter().collect(), required_media: None,
        });
    }
    if !input.phrase.trim().is_empty() && !meaning.is_empty() && !meaning.to_lowercase().contains(&input.phrase.to_lowercase()) {
        probes.push(ReviewProbe {
            id: "focused".into(), contract_version: 1, direction: ReviewDirection::Focused,
            cue: meaning.into(), answer: input.phrase.clone(),
            targets: vec![row("written-recognition", "Written form")],
            supplied: key("meaning").into_iter().collect(), required_media: None,
        });
    }
    if let Some(media) = input.media.iter().find(|media| !input.phrase.trim().is_empty() && media.kind == MediaKind::Audio && media.bound_to_target) {
        let mut targets = vec![row("listening", "Listening recognition")];
        if !meaning.is_empty() {
            targets.push(row("meaning", "Meaning"));
        }
        probes.push(ReviewProbe {
            id: "audio".into(), contract_version: 1, direction: ReviewDirection::Audio,
            cue: "Listen to the audio".into(),
            answer: if meaning.is_empty() { input.phrase.clone() } else { format!("{}\n{meaning}", input.phrase) },
            targets, supplied: vec![], required_media: Some(media.id.clone()),
        });
    }
    probes.retain(|probe| probe.cue.len() <= 16_384 && probe.answer.len() <= 16_384);
    serde_json::to_value(ProbeOutput { contract_version: 1, probes }).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_language_sdk::serde_json::json;

    fn input(target: Option<&str>) -> Value {
        json!({"materialId":"m1","materialRevision":1,"packageId":PACKAGE,"packageRevision":"r1",
            "targetId":target,"phrase":"cat","reading":"","meaning":"a feline","context":"","media":[]})
    }
    fn lookup(key: &str) -> Result<Option<Value>, String> {
        Ok(match key {
            "lemma/cat" => Some(json!(["wn30:n:0001:cat"])),
            "sense/n:0001" => Some(json!({"pos":"noun","definition":"a feline"})),
            _ => None,
        })
    }
    #[test]
    fn linked_probes_have_validated_disjoint_keys_and_core_wire_shape() {
        // Given an authenticated canonical lexical record.
        let value = input(Some("wn30:n:0001:cat"));
        // When generating automatic probes through the package owner.
        let output = generate(value, &lookup).unwrap();
        // Then native admission accepts the wire objects without a semantic adapter.
        let probes: Vec<mlearn_core::ReviewProbe> = serde_json::from_value(output["probes"].clone()).unwrap();
        assert_eq!(probes.len(), 2);
        assert!(probes.iter().all(mlearn_core::review_compatible));
        assert_eq!(probes[0].targets[0].key.as_ref().unwrap().target_id, "wn30:n:0001:cat");
    }
    #[test]
    fn undeclared_linked_target_is_rejected_instead_of_promoted() {
        // Given a plausible but undeclared sense.
        let value = input(Some("wn30:n:0002:cat"));
        // When generating canonical probes.
        let result = generate(value, &lookup);
        // Then no canonical Knowledge identity is invented.
        assert!(result.is_err());
    }
    #[test]
    fn local_audio_requires_explicit_binding_and_never_gains_keys() {
        // Given local content with arbitrary attachments and one bound audio.
        let mut value = input(None);
        value["media"] = json!([
            {"id":"unbound","kind":"audio","boundToTarget":false},
            {"id":"image","kind":"image","boundToTarget":true},
            {"id":"bound","kind":"audio","boundToTarget":true}
        ]);
        // When the local material generates its probes without lexical access.
        let output: ProbeOutput = serde_json::from_value(generate(value, &|_| panic!("local material must not query lexical identity")).unwrap()).unwrap();
        // Then only bound audio is required and all rows stay local.
        assert_eq!(output.probes.len(), 3);
        assert_eq!(output.probes[2].required_media.as_deref(), Some("bound"));
        assert!(output.probes.iter().flat_map(|probe| &probe.targets).all(|target| target.key.is_none()));
        assert!(output.probes.iter().all(|probe| probe.supplied.is_empty()));
    }
    #[test]
    fn unbound_audio_does_not_create_an_audio_task() {
        // Given an arbitrary authored clip.
        let mut value = input(None);
        value["media"] = json!([{"id":"clip","kind":"audio","boundToTarget":false}]);
        // When generating tasks.
        let output: ProbeOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
        // Then the package exposes only available written directions.
        assert!(output.probes.iter().all(|probe| probe.direction != ReviewDirection::Audio));
    }
    #[test]
    fn production_dispatch_omits_focused_task_when_definition_contains_answer() {
        // Given a definition that explicitly includes the written answer.
        let mut value = input(None);
        value["meaning"] = json!("a cat is a feline");
        // When invoking the production learning capability.
        let output = super::super::handle(mlearn_language_sdk::Call {
            capability: "learning.probes.v1".into(),
            input: value,
        }).unwrap();
        let output: ProbeOutput = serde_json::from_value(output).unwrap();
        // Then that definition cannot stand in for hidden written retrieval.
        assert!(output.probes.iter().all(|probe| probe.direction != ReviewDirection::Focused));
    }
    #[test]
    fn valid_oversized_material_omits_unpresentable_directions_without_truncation() {
        // Given a valid authored meaning larger than any Review answer/cue.
        let mut value = input(None);
        value["meaning"] = json!("x".repeat(32768));
        // When generating eligible directions.
        let output: ProbeOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
        // Then the queue can skip this item without a write or fabricated answer.
        assert!(output.probes.is_empty());
    }
}
