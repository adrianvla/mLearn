use super::{PACKAGE, inspect, validate_target};
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
mod tests {
    use super::*;

    fn lookup(key: &str) -> Result<Option<Value>, String> {
        Ok(match key {
            "lemma/child" => Some(json!(["wn30:n:0001:child", "wn30:n:0002:child"])),
            "lemma/kid" => Some(json!(["wn30:n:0001:kid"])),
            "sense/n:0001" => {
                Some(json!({"pos":"noun","definition":"young person","words":["child","kid"]}))
            }
            "sense/n:0002" => {
                Some(json!({"pos":"noun","definition":"descendant","words":["child"]}))
            }
            _ => None,
        })
    }

    #[test]
    fn lexical_alternatives_and_synset_support_keep_distinct_target_bindings() {
        let result = neighborhood(
            json!({"targetId":"wn30:n:0001:child","after":null}),
            &lookup,
        )
        .unwrap();
        assert_eq!(
            result.entity.target_id.as_deref(),
            Some("wn30:n:0001:child")
        );
        assert_eq!(result.connections.len(), 2);
        assert_eq!(
            result.connections[0].relation.category,
            RelationCategory::Alternative
        );
        assert_eq!(
            result.connections[0].entity.target_id.as_deref(),
            Some("wn30:n:0002:child")
        );
        assert_eq!(
            result.connections[1].relation.category,
            RelationCategory::Support
        );
        assert_eq!(
            result.connections[1].entity.target_id.as_deref(),
            Some("wn30:n:0001:kid")
        );
        assert!(
            result
                .connections
                .iter()
                .all(|item| item.relation.category != RelationCategory::Identity)
        );
        assert_eq!(result.next, None);
    }

    #[test]
    fn bounded_pages_visit_each_stable_relation_without_reinterpreting_a_cursor() {
        let lookup = |key: &str| -> Result<Option<Value>, String> {
            let alternatives = (0..35)
                .map(|index| format!("wn30:n:{index:04}:child"))
                .collect::<Vec<_>>();
            Ok(if key == "lemma/child" {
                Some(json!(alternatives))
            } else if key.starts_with("sense/n:") {
                Some(
                    json!({"pos":"noun","definition":"one actual lexical alternative","words":["child"]}),
                )
            } else {
                None
            })
        };
        let first = neighborhood(
            json!({"targetId":"wn30:n:0000:child","after":null}),
            &lookup,
        )
        .unwrap();
        let second = neighborhood(
            json!({"targetId":"wn30:n:0000:child","after":first.next}),
            &lookup,
        )
        .unwrap();
        let third = neighborhood(
            json!({"targetId":"wn30:n:0000:child","after":second.next}),
            &lookup,
        )
        .unwrap();
        assert_eq!(
            [
                first.connections.len(),
                second.connections.len(),
                third.connections.len()
            ],
            [16, 16, 2]
        );
        let ids = first
            .connections
            .iter()
            .chain(&second.connections)
            .chain(&third.connections)
            .map(|item| &item.relation.id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), 34);
        assert!(third.next.is_none());
        assert!(
            neighborhood(
                json!({"targetId":"wn30:n:0000:child","after":"invalid"}),
                &lookup
            )
            .is_err()
        );
    }
}
