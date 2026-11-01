#[path = "review_composition.rs"]
mod composition;
#[path = "review_tasks.rs"]
mod tasks;
pub(super) use composition::generate;
pub(super) use tasks::generate as generate_tasks;

#[cfg(test)]
use {
    super::PACKAGE,
    mlearn_language_sdk::{
        learning::{ProbeOutput, ReviewDirection},
        serde_json::{self, Value},
    },
};

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
    fn character_lookup(key: &str) -> Result<Option<Value>, String> {
        Ok(match key {
            "character/6a4b" => Some(json!({
                "literal":"橋","codepoint":"6a4b","nameReadings":[],
                "groups":[{
                    "readings":[{"text":"はし","attributes":{"r_type":"ja_kun"}}],
                    "meanings":[{"text":"bridge","attributes":{}}]
                }]
            })),
            "character/5b57" => Some(json!({
                "literal":"字","codepoint":"5b57","nameReadings":[],
                "groups":[{
                    "readings":[{"text":"ジ","attributes":{"r_type":"ja_on"}}],
                    "meanings":[{"text":"caractère","attributes":{"m_lang":"fr"}}]
                }]
            })),
            "character/20000" => Some(json!({
                "literal":"𠀀","codepoint":"20000","groups":[],"nameReadings":[]
            })),
            _ => None,
        })
    }

    #[test]
    fn character_probes_keep_distinct_keys_and_do_not_invent_audio_support() {
        // Given canonical character material with independent reading and meaning.
        let mut value = input(Some("kanjidic:6a4b"));
        value["phrase"] = json!("橋");
        value["reading"] = json!("はし");
        value["meaning"] = json!("bridge");
        value["media"] = json!([{"id":"bound","kind":"audio","boundToTarget":true}]);

        // When the existing package probe owner generates its supported directions.
        let output: ProbeOutput =
            serde_json::from_value(generate(value, &character_lookup).unwrap()).unwrap();

        // Then character evidence stays separate from words and unsupported audio.
        assert_eq!(output.probes.len(), 2);
        for probe in &output.probes {
            assert_ne!(probe.direction, ReviewDirection::Audio);
            assert!(probe.required_media.is_none());
            for target in &probe.targets {
                let key = target.key.as_ref().unwrap();
                assert_eq!(key.target_id, "kanjidic:6a4b");
                assert_ne!(key.capability, format!("{PACKAGE}:listening"));
                assert!(!probe.supplied.contains(key));
            }
        }
    }

    #[test]
    fn metadata_only_character_has_no_probes_despite_authored_answer_fields() {
        // Given source metadata without published supported learning associations.
        let mut value = input(Some("kanjidic:20000"));
        value["phrase"] = json!("𠀀");
        value["media"] = json!([{"id":"bound","kind":"audio","boundToTarget":true}]);

        // When authored fields and audio are presented to the character target.
        let output: ProbeOutput =
            serde_json::from_value(generate(value, &character_lookup).unwrap()).unwrap();

        // Then the word generator is not a fallback for unavailable character tasks.
        assert!(output.probes.is_empty());
    }

    #[test]
    fn reading_only_character_omits_unavailable_meaning_from_targets_and_answer() {
        // Given a Japanese reading but only a foreign-language source meaning.
        let mut value = input(Some("kanjidic:5b57"));
        value["phrase"] = json!("字");
        value["reading"] = json!("じ");
        value["meaning"] = json!("letter");

        // When a reading task is requested through the shared probe owner.
        let output: ProbeOutput =
            serde_json::from_value(generate(value, &character_lookup).unwrap()).unwrap();

        // Then unsupported meaning never becomes a row, answer or supplied key.
        assert_eq!(output.probes.len(), 1);
        let probe = &output.probes[0];
        assert_eq!(probe.answer, "じ");
        assert_eq!(probe.targets.len(), 1);
        assert_eq!(probe.targets[0].id, "reading");
        assert!(probe
            .targets
            .iter()
            .filter_map(|target| target.key.as_ref())
            .chain(&probe.supplied)
            .all(|key| key.capability != format!("{PACKAGE}:meaning")));
    }

    #[test]
    fn character_material_cannot_bind_another_glyphs_identity() {
        // Given a valid target but authored content for a different character.
        let mut value = input(Some("kanjidic:6a4b"));
        value["phrase"] = json!("箸");
        value["reading"] = json!("はし");
        value["meaning"] = json!("bridge");

        // When attempting to generate canonical learner keys.
        let result = generate(value, &character_lookup);

        // Then same-reading characters cannot borrow one another's identity.
        assert!(result.is_err());
    }

    #[test]
    fn publisher_metadata_cannot_become_a_learning_probe() {
        // Given authored content linked to the publisher's metadata identity.
        let mut value = input(Some("jmdict:9999999"));
        value["phrase"] = json!("ＪＭｄｉｃｔ");
        let lookup = |key: &str| {
            Ok((key == "entry/9999999").then(|| {
                json!({
                    "targetId":"jmdict:9999999","headword":"ＪＭｄｉｃｔ",
                    "variants":[{"written":"ＪＭｄｉｃｔ","reading":"ジェイエムディクト"}],
                    "senses":[{"pos":["unclassified"],"forms":[],"readings":[],
                        "glosses":["Dictionary creation metadata"]}]
                })
            }))
        };

        // When the normal package task owner handles the linked target.
        let output: ProbeOutput =
            serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();

        // Then neither lexical prompts nor canonical learner observations are admitted.
        assert!(output.probes.is_empty());
    }

    #[test]
    fn linked_written_probe_groups_reading_and_meaning_without_supplied_overlap() {
        // Given a canonical dictionary target with independently hidden reading.
        let value = input(Some("jmdict:1"));
        // When generating written and focused directions.
        let output: ProbeOutput =
            serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
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
        let output: ProbeOutput =
            serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
        // Then the visible kana is not tested as a hidden reading.
        assert!(output.probes[0]
            .targets
            .iter()
            .all(|row| row.id != "reading"));
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
        let output: ProbeOutput = serde_json::from_value(
            generate(value, &|_| panic!("no local lexical lookup")).unwrap(),
        )
        .unwrap();
        // Then the audio direction binds the selected audio and no Knowledge.
        assert_eq!(output.probes.len(), 3);
        assert_eq!(
            output.probes[2].required_media,
            Some(mlearn_core::AuthoredMediaId("bound".into()))
        );
        assert!(output
            .probes
            .iter()
            .flat_map(|probe| &probe.targets)
            .all(|row| row.key.is_none()));
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
        })
        .unwrap();
        let output: ProbeOutput = serde_json::from_value(output).unwrap();
        // Then the exposed reading never becomes a retrieval row.
        assert!(output.probes[0]
            .targets
            .iter()
            .all(|row| row.id != "reading"));
    }
    #[test]
    fn valid_oversized_material_omits_unpresentable_directions_without_truncation() {
        // Given valid large authored content that cannot fit a Review answer.
        let mut value = input(None);
        value["meaning"] = json!("x".repeat(32768));
        // When deriving eligible tasks from the full unmodified authored content.
        let output: ProbeOutput =
            serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
        // Then no truncated task or fatal queue error is returned.
        assert!(output.probes.is_empty());
    }
}
