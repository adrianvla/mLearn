//! Original mLearn instructional content, distributed under the repository LICENSE.
//! Reference facts are attributed separately; no curriculum or level is asserted.
use super::PACKAGE;
use mlearn_core::{
    Capability, CollectionTarget, GraphNeighborhood, GraphProperty, LexicalEntry, LinguisticEntity,
    LinguisticLabel,
};
use mlearn_language_sdk::serde_json::json;
use std::collections::BTreeMap;

pub(super) const TARGET: &str = "org.mlearn.english:grammar/past-simple-negative";
pub(super) const ATTRIBUTION: &str = "Original mLearn instructional content (OmO, 2026-10-31); repository LICENSE. Not an external curriculum.";
pub(super) const LIMITATIONS: &str = "One finite cloze and one visible sentence contrast, not general grammaticality or competence. Excludes be, modals and negative questions. No official level or efficacy claim.";
const DETAIL: &str = "For an ordinary past event, use did not or didn't followed by the base verb. This unit excludes be, modals and negative questions.";
const FORMATION: &str = "subject + did not / didn't + base verb";
const REFERENCE: &str = "British Council LearnEnglish Teens, Past simple - irregular verbs; formation fact only, not source of the original examples or tasks. https://learnenglishteens.britishcouncil.org/grammar/a1-a2-grammar/past-simple-irregular-verbs";

pub(super) fn capabilities() -> Vec<Capability> {
    [
        ("grammar-form", "Grammar formation"),
        ("grammar-meaning", "Grammar contrast"),
        ("grammar-recall", "Grammar retrospective recall"),
    ]
    .into_iter()
    .map(|(id, label)| Capability {
        id: format!("{PACKAGE}:{id}"),
        label: label.into(),
    })
    .collect()
}

pub(super) fn kind() -> LinguisticLabel {
    LinguisticLabel {
        id: format!("{PACKAGE}:grammar"),
        label: "Grammar".into(),
        color: None,
        attribution: ATTRIBUTION.into(),
    }
}

pub(super) fn entry() -> LexicalEntry {
    LexicalEntry {
        target_id: TARGET.into(),
        headword: "Past simple negative".into(),
        reading: None,
        presentation: None,
        part_of_speech: "grammar construction".into(),
        definition: format!(
            "{DETAIL}\nFormation: {FORMATION}\nExamples: Mira did not fold the map yesterday. We didn't move the desk on Monday."
        ),
        summary: Some(DETAIL.into()),
        senses: None,
        attribution: ATTRIBUTION.into(),
        capabilities: capabilities(),
    }
}

pub(super) fn collection_target() -> CollectionTarget {
    CollectionTarget {
        summary: entry().into(),
        kind: kind().id,
        capabilities: capabilities().into_iter().map(|value| value.id).collect(),
        scopes: vec![],
        levels: vec![],
        extensions: BTreeMap::new(),
    }
}

pub(super) fn neighborhood(after: Option<&str>) -> Result<GraphNeighborhood, String> {
    if after.is_some() {
        return Err("Grammar neighborhood has no continuation cursor".into());
    }
    let properties = [
        ("detail", "Detail", json!(DETAIL), ATTRIBUTION),
        ("formation", "Formation", json!(FORMATION), ATTRIBUTION),
        (
            "examples",
            "Original examples",
            json!(["Mira did not fold the map yesterday.", "We didn't move the desk on Monday."]),
            ATTRIBUTION,
        ),
        ("limitations", "Finite scope", json!(LIMITATIONS), ATTRIBUTION),
        (
            "relationships",
            "Unresolved relationship",
            json!([{"relation":"contrast","concept":"affirmative past","status":"unresolved_no_target_identity"}]),
            ATTRIBUTION,
        ),
        ("formation-reference", "Formation reference", json!(REFERENCE), REFERENCE),
    ]
    .into_iter()
    .map(|(id, label, value, attribution)| GraphProperty {
        id: format!("{PACKAGE}:grammar-{id}"),
        label: label.into(),
        value,
        attribution: attribution.into(),
    })
    .collect();
    Ok(GraphNeighborhood {
        entity: LinguisticEntity {
            id: TARGET.into(),
            kind: kind(),
            label: entry().headword,
            target_id: Some(TARGET.into()),
            capabilities: capabilities(),
            properties,
            attribution: ATTRIBUTION.into(),
        },
        connections: vec![],
        next: None,
    })
}
