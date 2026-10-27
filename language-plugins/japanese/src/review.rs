use super::{hiragana, validate_entry, PACKAGE};
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
        let sequence = target.strip_prefix("jmdict:")
            .filter(|seq| !seq.is_empty() && seq.len() <= 10 && seq.bytes().all(|byte| byte.is_ascii_digit()))
            .ok_or("Unknown Japanese target identity")?;
        validate_entry(target, lookup(&format!("entry/{sequence}"))?.ok_or("JMdict entry not found")?)?;
    }
    let key = |capability: &str| input.target_id.as_ref().map(|target| KnowledgeKey {
        package_id: PACKAGE.into(), target_id: target.clone(), capability: format!("{PACKAGE}:{capability}"),
    });
    let row = |capability: &str, label: &str| ReviewTarget {
        id: capability.into(), label: label.into(), mnemonic: None, key: key(capability),
    };
    let meaning = input.meaning.trim();
    let reading = input.reading.trim();
    let hidden_reading = !reading.is_empty() && !hiragana(&input.phrase).contains(&hiragana(reading));
    let mut probes = Vec::new();
    let mut targets = Vec::new();
    if hidden_reading {
        targets.push(row("reading", "Reading"));
    }
    if !meaning.is_empty() && !input.phrase.contains(meaning) {
        targets.push(row("meaning", "Meaning"));
    }
    let answer = [reading, meaning].into_iter().filter(|text| !text.is_empty()).collect::<Vec<_>>().join("\n");
    if !input.phrase.trim().is_empty() && !targets.is_empty() {
        let mut supplied: Vec<_> = key("written-recognition").into_iter().collect();
        if !hidden_reading && !reading.is_empty() {
            supplied.extend(key("reading"));
        }
        probes.push(ReviewProbe {
            id: "written".into(), contract_version: 1, direction: ReviewDirection::Written,
            cue: input.phrase.clone(), answer, targets, supplied, required_media: None,
        });
    }
    if !input.phrase.trim().is_empty() && !meaning.is_empty() && !meaning.contains(&input.phrase)
        && (reading.is_empty() || !meaning.contains(reading))
    {
        let mut targets = vec![row("written-recognition", "Written form")];
        if hidden_reading {
            targets.push(row("reading", "Reading"));
        }
        probes.push(ReviewProbe {
            id: "focused".into(), contract_version: 1, direction: ReviewDirection::Focused,
            cue: meaning.into(),
            answer: if hidden_reading { format!("{}\n{reading}", input.phrase) } else { input.phrase.clone() },
            targets, supplied: key("meaning").into_iter().collect(), required_media: None,
        });
    }
    if let Some(media) = input.media.iter().find(|media| !input.phrase.trim().is_empty() && media.kind == MediaKind::Audio && media.bound_to_target) {
        let mut targets = vec![row("listening", "Listening recognition")];
        if !meaning.is_empty() {
            targets.push(row("meaning", "Meaning"));
        }
        probes.push(ReviewProbe {
            id: "audio".into(), contract_version: 1, direction: ReviewDirection::Audio,
            cue: "音声を聞く".into(),
            answer: [input.phrase.as_str(), reading, meaning].into_iter().filter(|text| !text.is_empty()).collect::<Vec<_>>().join("\n"),
            targets, supplied: key("reading").into_iter().collect(), required_media: Some(media.id.clone()),
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
            "targetId":target,"phrase":"猫","reading":"ねこ","meaning":"cat","context":"","media":[]})
    }
    fn lookup(key: &str) -> Result<Option<Value>, String> {
        Ok((key == "entry/1").then(|| json!({
            "targetId":"jmdict:1","headword":"猫","variants":[{"written":"猫","reading":"ねこ"}],
            "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["cat"]}]
        })))
    }
    #[test]
    fn linked_written_probe_groups_reading_and_meaning_without_supplied_overlap() {
        // Given a canonical dictionary target with independently hidden reading.
        let value = input(Some("jmdict:1"));
        // When generating written and focused directions.
        let output: ProbeOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
        // Then compatible rows share an encounter and canonical identity.
        assert_eq!(output.probes.len(), 2);
        assert_eq!(output.probes[0].targets.len(), 2);
        for probe in &output.probes {
            for target in &probe.targets {
                let key = target.key.as_ref().unwrap();
                assert_eq!(key.target_id, "jmdict:1");
                assert!(!probe.supplied.contains(key));
            }
        }
    }
    #[test]
    fn kana_cue_does_not_claim_hidden_reading_retrieval() {
        // Given a kana spelling identical to its supplied pronunciation.
        let mut value = input(None);
        value["phrase"] = json!("ネコ");
        // When generating written tasks.
        let output: ProbeOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
        // Then the visible kana is not tested as a hidden reading.
        assert!(output.probes[0].targets.iter().all(|row| row.id != "reading"));
    }
    #[test]
    fn local_audio_uses_only_target_bound_audio_without_canonical_keys() {
        // Given authored content with unrelated audio and one explicit binding.
        let mut value = input(None);
        value["media"] = json!([
            {"id":"unbound","kind":"audio","boundToTarget":false},
            {"id":"picture","kind":"image","boundToTarget":true},
            {"id":"bound","kind":"audio","boundToTarget":true}
        ]);
        // When generating local tasks without a dictionary identity.
        let output: ProbeOutput = serde_json::from_value(generate(value, &|_| panic!("no local lexical lookup")).unwrap()).unwrap();
        // Then the audio direction binds the selected audio and no Knowledge.
        assert_eq!(output.probes.len(), 3);
        assert_eq!(output.probes[2].required_media.as_deref(), Some("bound"));
        assert!(output.probes.iter().flat_map(|probe| &probe.targets).all(|row| row.key.is_none()));
        assert!(output.probes.iter().all(|probe| probe.supplied.is_empty()));
    }
    #[test]
    fn linked_entry_identity_mismatch_is_rejected() {
        // Given a resource with a different canonical target.
        let value = input(Some("jmdict:2"));
        // When generating probes against that mismatched resource.
        let result = generate(value, &|_| lookup("entry/1"));
        // Then no canonical rows are admitted.
        assert!(result.is_err());
    }
    #[test]
    fn production_dispatch_omits_reading_already_annotated_in_cue() {
        // Given local authored text that explicitly includes its pronunciation.
        let mut value = input(None);
        value["phrase"] = json!("猫（ねこ）");
        // When invoking the actual package task entry point.
        let output = super::super::handle(mlearn_language_sdk::Call {
            capability: "learning.probes.v1".into(),
            input: value,
        }).unwrap();
        let output: ProbeOutput = serde_json::from_value(output).unwrap();
        // Then the exposed reading never becomes a retrieval row.
        assert!(output.probes[0].targets.iter().all(|row| row.id != "reading"));
    }
    #[test]
    fn valid_oversized_material_omits_unpresentable_directions_without_truncation() {
        // Given valid large authored content that cannot fit a Review answer.
        let mut value = input(None);
        value["meaning"] = json!("x".repeat(32768));
        // When deriving eligible tasks from the full unmodified authored content.
        let output: ProbeOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
        // Then no truncated task or fatal queue error is returned.
        assert!(output.probes.is_empty());
    }
}
