use super::{PACKAGE, grammar, inspect, validate_target};
use mlearn_core::{
    GraphConnection, GraphNeighborhood, GraphProperty, LinguisticEntity, LinguisticLabel,
    LinguisticRelation, RelationCategory,
};
use mlearn_language_sdk::serde_json::{self, Value, json};
use serde::Deserialize;
use std::collections::BTreeMap;

const ATTRIBUTION: &str = "Princeton WordNet 3.0";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Query {
    target_id: String,
    after: Option<String>,
}

fn label(id: &str, text: &str) -> LinguisticLabel {
    LinguisticLabel {
        id: format!("{PACKAGE}:{id}"),
        label: text.into(),
        color: None,
        attribution: ATTRIBUTION.into(),
    }
}

fn entity(
    target: &str,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<LinguisticEntity, String> {
    let entry = inspect(target, lookup)?;
    let preview = entry.definition.chars().take(512).collect::<String>();
    Ok(LinguisticEntity {
        id: target.into(),
        kind: label("lexical-sense", "Lexical sense"),
        label: entry.headword,
        target_id: Some(target.into()),
        capabilities: entry.capabilities,
        properties: vec![
            GraphProperty {
                id: format!("{PACKAGE}:part-of-speech"),
                label: "Part of speech".into(),
                value: json!(entry.part_of_speech),
                attribution: ATTRIBUTION.into(),
            },
            GraphProperty {
                id: format!("{PACKAGE}:definition-preview"),
                label: "Definition preview".into(),
                value: json!(preview),
                attribution: ATTRIBUTION.into(),
            },
        ],
        attribution: ATTRIBUTION.into(),
    })
}

pub(super) fn neighborhood(
    input: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<GraphNeighborhood, String> {
    let query: Query = serde_json::from_value(input).map_err(|error| error.to_string())?;
    if query.target_id == grammar::TARGET {
        return grammar::neighborhood(query.after.as_deref());
    }
    let root = entity(&query.target_id, lookup)?;
    let sense = validate_target(&query.target_id, lookup)?;
    let parts = query.target_id.splitn(4, ':').collect::<Vec<_>>();
    let lemma = parts.get(3).ok_or("Missing WordNet lemma")?;
    let alternatives = lookup(&format!("lemma/{}", lemma.to_lowercase()))?
        .ok_or("WordNet lemma is unavailable")?;
    let alternatives = alternatives
        .as_array()
        .ok_or("Invalid WordNet lemma index")?;
    let words = sense["words"]
        .as_array()
        .ok_or("WordNet relation data is unavailable; update this package")?;
    if alternatives.len() > 512 || words.len() > 512 {
        return Err("WordNet neighborhood exceeds its bounded candidate limit".into());
    }
    let mut candidates = BTreeMap::new();
    for target in alternatives {
        let target = target
            .as_str()
            .ok_or("Invalid WordNet alternative identity")?;
        if target != query.target_id {
            candidates.insert(
                format!("alternative:{target}"),
                (
                    target.to_owned(),
                    RelationCategory::Alternative,
                    "alternative-sense",
                    "Alternative lexical sense",
                ),
            );
        }
    }
    for word in words {
        let word = word.as_str().ok_or("Invalid WordNet synset word")?;
        let target = format!("wn30:{}:{}:{word}", parts[1], parts[2]);
        if target != query.target_id {
            candidates.insert(
                format!("support:{target}"),
                (
                    target,
                    RelationCategory::Support,
                    "same-synset",
                    "Same dictionary synset",
                ),
            );
        }
    }
    let start = query
        .after
        .as_ref()
        .map(|after| {
            after
                .parse::<usize>()
                .map_err(|_| "Invalid WordNet graph cursor")
        })
        .transpose()?
        .unwrap_or(0);
    if query.after.is_some() && start >= candidates.len() {
        return Err("WordNet graph cursor is outside this neighborhood".into());
    }
    let end = (start + 16).min(candidates.len());
    let mut connections = Vec::new();
    for (id, (target, category, predicate, text)) in candidates.iter().skip(start).take(16) {
        let related = entity(target, lookup)?;
        connections.push(GraphConnection {
            relation: LinguisticRelation {
                id: format!("{}:{id}", query.target_id),
                category: *category, predicate: label(predicate, text),
                from: root.id.clone(), to: related.id.clone(),
                qualifiers: vec![GraphProperty {
                    id: format!("{PACKAGE}:identity-limit"), label: "Identity limit".into(),
                    value: json!("Dictionary alternatives and synset grouping do not share learner state or demonstrate another capability."),
                    attribution: ATTRIBUTION.into(),
                }],
                attribution: ATTRIBUTION.into(),
            },
            entity: related,
        });
    }
    Ok(GraphNeighborhood {
        entity: root,
        connections,
        next: (end < candidates.len()).then(|| end.to_string()),
    })
}

#[cfg(test)]
mod tests;
