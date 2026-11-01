use super::*;
use mlearn_language_sdk::{learning::ReviewDirection, serde_json::json};
use std::collections::BTreeSet;

fn input(target: &str, capabilities: &[&str]) -> Value {
    json!({
        "contractVersion":2,"packageId":PACKAGE,"packageRevision":"fixture-r1",
        "targetId":target,
        "eligibleKeys":capabilities.iter().map(|capability| KnowledgeKey {
            package_id: PACKAGE.into(), target_id: target.into(),
            capability: format!("{PACKAGE}:{capability}"),
        }).collect::<Vec<_>>(),
    })
}

fn lookup(key: &str) -> Result<Option<Value>, String> {
    Ok(match key {
        "entry/1" => Some(json!({
            "targetId":"jmdict:1","headword":"猫","variants":[{"written":"猫","reading":"ねこ"}],
            "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["cat"]}]
        })),
        "entry/2" => Some(json!({
            "targetId":"jmdict:2","headword":"ネコ","variants":[{"written":"ネコ","reading":"ねこ"}],
            "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["cat"]}]
        })),
        "entry/3" => Some(json!({
            "targetId":"jmdict:3","headword":"ネコ",
            "variants":[{"written":"ネコ","reading":"ねこ"},{"written":"ネコ","reading":"ねご"}],
            "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["cat"]}]
        })),
        "entry/9999999" => Some(json!({
            "targetId":"jmdict:9999999","headword":"ＪＭｄｉｃｔ",
            "variants":[{"written":"ＪＭｄｉｃｔ","reading":"ジェイエムディクト"}],
            "senses":[{"pos":["unclassified"],"forms":[],"readings":[],"glosses":["Metadata"]}]
        })),
        "character/5b57" => Some(json!({
            "literal":"字","codepoint":"5b57","nameReadings":[],
            "groups":[{"readings":[{"text":"ジ","attributes":{"r_type":"ja_on"}}],
                "meanings":[{"text":"caractère","attributes":{"m_lang":"fr"}}]}]
        })),
        "character/20000" => Some(json!({
            "literal":"𠀀","codepoint":"20000","groups":[],"nameReadings":[]
        })),
        _ => None,
    })
}

#[test]
fn canonical_requested_subset_keeps_untested_answer_disclosures() {
    // Given only meaning is eligible for the canonical word.
    let value = input("jmdict:1", &["meaning"]);
    // When resolving real inspection content and shared probe composition.
    let output: TaskOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
    // Then reading is revealed but never promoted to a tested key.
    assert_eq!(output.contract_version, 2);
    assert_eq!(output.tasks.len(), 1);
    let task = &output.tasks[0];
    assert_eq!(task.probe.cue, "猫");
    assert_eq!(task.probe.answer, "ねこ\ncat");
    assert_eq!(task.probe.targets.len(), 1);
    assert_eq!(
        task.probe.targets[0].key.as_ref().unwrap().capability,
        format!("{PACKAGE}:meaning")
    );
    assert_eq!(
        task.task
            .answer_supplied
            .iter()
            .map(|key| key.capability.as_str())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["org.mlearn.japanese:reading", "org.mlearn.japanese:meaning"])
    );
    assert_eq!(task.task.response_spec, ResponseSpec::SelfReport);
    assert!(task.task.validator_id.is_none());
    assert!(task.probe.required_media.is_none());
    task.task.validate().unwrap();
}

#[test]
fn canonical_exact_requested_coverage_is_disjoint_from_cues() {
    // Given every supported non-audio lexical key.
    let value = input("jmdict:1", &["reading", "meaning", "written-recognition"]);
    let request: TaskInput = serde_json::from_value(value.clone()).unwrap();
    // When generating through the package's canonical owner.
    let output: TaskOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
    // Then the tested union is exactly the requested union and never intersects cues.
    let tested = output
        .tasks
        .iter()
        .flat_map(|task| &task.probe.targets)
        .map(|row| row.key.as_ref().unwrap().capability.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        tested,
        request
            .eligible_keys
            .iter()
            .map(|key| key.capability.as_str())
            .collect()
    );
    assert_eq!(
        output
            .tasks
            .iter()
            .map(|task| task.probe.targets.len())
            .sum::<usize>(),
        request.eligible_keys.len(),
        "Each admitted capability must be tested once, not repeated across tasks"
    );
    for task in &output.tasks {
        assert!(mlearn_core::review_compatible(&task.probe));
        assert!(task.probe.targets.iter().all(|row| {
            let key = row.key.as_ref().unwrap();
            request.eligible_keys.contains(key) && !task.probe.supplied.contains(key)
        }));
        let disclosures = task
            .task
            .answer_supplied
            .iter()
            .map(|key| key.capability.as_str())
            .collect::<BTreeSet<_>>();
        match task.probe.direction {
            ReviewDirection::Written => {
                assert_eq!(task.probe.answer, "ねこ\ncat");
                assert_eq!(
                    disclosures,
                    BTreeSet::from(["org.mlearn.japanese:reading", "org.mlearn.japanese:meaning"])
                );
            }
            ReviewDirection::Focused => {
                assert_eq!(task.probe.answer, "猫\nねこ");
                assert_eq!(
                    disclosures,
                    BTreeSet::from([
                        "org.mlearn.japanese:written-recognition",
                        "org.mlearn.japanese:reading"
                    ])
                );
            }
            ReviewDirection::Audio => panic!("no canonical audio binding"),
        }
    }
}

#[test]
fn canonical_kana_cue_discloses_reading_instead_of_testing_it() {
    // Given kana already supplies the reading but meaning remains eligible.
    let value = input("jmdict:2", &["meaning", "written-recognition"]);
    // When the canonical generator composes its written task.
    let output: TaskOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
    // Then reading is a cue disclosure, not a hidden tested row.
    let task = &output.tasks[0];
    assert_eq!(task.probe.targets.len(), 1);
    assert_eq!(task.probe.targets[0].id, "meaning");
    assert!(task
        .probe
        .supplied
        .iter()
        .any(|key| key.capability == format!("{PACKAGE}:reading")));
    assert!(task
        .task
        .answer_supplied
        .iter()
        .any(|key| key.capability == format!("{PACKAGE}:reading")));
    let focused = output
        .tasks
        .iter()
        .find(|task| task.probe.direction == ReviewDirection::Focused)
        .unwrap();
    assert_eq!(focused.probe.answer, "ネコ");
    assert!(focused
        .task
        .answer_supplied
        .iter()
        .any(|key| key.capability == format!("{PACKAGE}:reading")));
}

#[test]
fn canonical_visible_alternative_reading_cannot_be_tested_as_hidden() {
    // Given one of several published readings is visible in the headword.
    let value = input("jmdict:3", &["reading"]);
    // When requesting reading without an uncontaminated direction.
    let result = generate(value, &lookup);
    // Then other alternatives do not erase the visible reading disclosure.
    assert!(result.is_err());
}

#[test]
fn canonical_character_uses_only_published_associations() {
    // Given a character with Japanese reading but only a foreign meaning.
    let value = input("kanjidic:5b57", &["reading"]);
    // When character inspection supplies the actual canonical content.
    let output: TaskOutput = serde_json::from_value(generate(value, &lookup).unwrap()).unwrap();
    // Then neither unsupported meaning nor audio is invented.
    assert_eq!(output.tasks.len(), 1);
    let task = &output.tasks[0];
    assert_eq!(task.probe.cue, "字");
    assert_eq!(task.probe.answer, "ジ");
    assert_eq!(task.task.answer_supplied.len(), 1);
    assert_eq!(
        task.task.answer_supplied[0].capability,
        format!("{PACKAGE}:reading")
    );
    let inspected: LexicalEntry =
        serde_json::from_value(characters::inspect("kanjidic:5b57", &lookup).unwrap()).unwrap();
    assert_eq!(task.task.attribution, inspected.attribution);
    assert!(task.probe.required_media.is_none());
}

#[test]
fn canonical_listening_and_unsupported_capabilities_are_rejected() {
    // Given unavailable audio, unknown capability and unpublished character associations.
    let values = [
        input("jmdict:1", &["listening"]),
        input("jmdict:1", &["meaning", "listening"]),
        input("jmdict:1", &["unknown"]),
        input("kanjidic:5b57", &["meaning"]),
        input("kanjidic:5b57", &["listening"]),
        input("kanjidic:20000", &["reading"]),
    ];
    // When each canonical request is generated.
    let results = values
        .into_iter()
        .map(|value| generate(value, &lookup))
        .collect::<Vec<_>>();
    // Then no missing direction is silently widened or declared successful.
    assert!(results.iter().all(Result::is_err));
}

#[test]
fn canonical_invalid_foreign_and_metadata_targets_are_rejected() {
    // Given unknown/foreign targets, metadata and foreign package scope.
    let mut foreign = input("jmdict:1", &["meaning"]);
    foreign["packageId"] = json!("org.mlearn.english");
    let mut mismatch = input("jmdict:1", &["meaning"]);
    mismatch["eligibleKeys"][0]["targetId"] = json!("jmdict:2");
    let values = [
        input("jmdict:9", &["meaning"]),
        input("wn30:n:0001:cat", &["meaning"]),
        input("jmdict:9999999", &["meaning"]),
        foreign,
        mismatch,
    ];
    // When package identity and published target membership are checked.
    let results = values
        .into_iter()
        .map(|value| generate(value, &lookup))
        .collect::<Vec<_>>();
    // Then no canonical identity or evidence is manufactured.
    assert!(results.iter().all(Result::is_err));
}
