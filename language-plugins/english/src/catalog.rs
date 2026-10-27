use super::{PACKAGE, capabilities, inspect};
use mlearn_core::{
    CollectionCatalogPage, CollectionCatalogRequest, CollectionDescription, CollectionTarget,
    LinguisticLabel,
};
use mlearn_language_sdk::{
    ResourceKeyPage,
    serde_json::{self, Value},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn scope_id(pos: &str) -> String {
    format!("{PACKAGE}:part-of-speech:{pos}")
}

pub(super) fn description() -> CollectionDescription {
    CollectionDescription {
        capabilities: capabilities(),
        kinds: vec![LinguisticLabel {
            id: format!("{PACKAGE}:lexical-sense"),
            label: "Lexical sense".into(),
            color: None,
            attribution: "Princeton WordNet 3.0".into(),
        }],
        scopes: [
            ("noun", "Nouns"),
            ("verb", "Verbs"),
            ("adj", "Adjectives"),
            ("adv", "Adverbs"),
        ]
        .into_iter()
        .map(|(pos, label)| LinguisticLabel {
            id: scope_id(pos),
            label: label.into(),
            color: None,
            attribution: "Princeton WordNet 3.0".into(),
        })
        .collect(),
        levels: vec![],
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    lemma: String,
    sense: usize,
}

pub(super) fn page(
    input: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
    keys: &impl Fn(Option<&str>) -> Result<ResourceKeyPage, String>,
) -> Result<CollectionCatalogPage, String> {
    let request: CollectionCatalogRequest =
        serde_json::from_value(input).map_err(|error| error.to_string())?;
    request.validate()?;
    let limit = request.limit as usize;
    let metadata = lookup("metadata")?.ok_or("WordNet metadata missing")?;
    if metadata["schemaVersion"] != 1 {
        return Err("Unsupported WordNet resource schema".into());
    }
    let total = metadata["entries"]
        .as_u64()
        .and_then(|count| u32::try_from(count).ok())
        .filter(|count| *count <= 1_000_000)
        .ok_or("Invalid WordNet target count")?;
    let mut cursor = match request.after {
        Some(after) => {
            Some(serde_json::from_str::<Cursor>(&after).map_err(|error| error.to_string())?)
        }
        None => keys(None)?
            .keys
            .into_iter()
            .next()
            .map(|lemma| Cursor { lemma, sense: 0 }),
    };
    let mut items = Vec::with_capacity(limit);
    while items.len() < limit {
        let Some(mut current) = cursor.take() else {
            break;
        };
        if !current.lemma.starts_with("lemma/") || current.lemma.len() > 256 {
            return Err("Invalid WordNet catalog cursor".into());
        }
        let value = lookup(&current.lemma)?.ok_or("WordNet catalog lemma missing")?;
        let targets = value.as_array().ok_or("Invalid WordNet lemma record")?;
        if current.sense >= targets.len() {
            return Err("Invalid WordNet sense cursor".into());
        }
        for target in targets.iter().skip(current.sense).take(limit - items.len()) {
            let id = target.as_str().ok_or("Invalid WordNet target")?;
            let entry = inspect(id, lookup)?;
            let scope = scope_id(&entry.part_of_speech);
            let capabilities = entry
                .capabilities
                .iter()
                .map(|value| value.id.clone())
                .collect();
            items.push(CollectionTarget {
                summary: entry.into(),
                kind: format!("{PACKAGE}:lexical-sense"),
                capabilities,
                scopes: vec![scope],
                levels: vec![],
                extensions: BTreeMap::new(),
            });
            current.sense += 1;
        }
        cursor = if current.sense < targets.len() {
            Some(current)
        } else {
            keys(Some(&current.lemma))?
                .keys
                .into_iter()
                .next()
                .map(|lemma| Cursor { lemma, sense: 0 })
        };
    }
    let next = cursor
        .map(|cursor| serde_json::to_string(&cursor))
        .transpose()
        .map_err(|error| error.to_string())?;
    Ok(CollectionCatalogPage { items, next, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_language_sdk::serde_json::json;

    #[test]
    fn real_sense_identities_resume_within_a_lemma_and_reuse_summaries() {
        let values = BTreeMap::from([
            ("metadata", json!({"schemaVersion":1,"entries":4})),
            (
                "lemma/alpha",
                json!([
                    "wn30:n:00000001:alpha",
                    "wn30:n:00000002:alpha",
                    "wn30:v:00000003:alpha"
                ]),
            ),
            ("lemma/beta", json!(["wn30:n:00000004:beta"])),
            (
                "sense/n:00000001",
                json!({"pos":"noun","definition":"First line\nNot a list summary"}),
            ),
            (
                "sense/n:00000002",
                json!({"pos":"noun","definition":"Second sense"}),
            ),
            (
                "sense/v:00000003",
                json!({"pos":"verb","definition":"Third sense"}),
            ),
            (
                "sense/n:00000004",
                json!({"pos":"noun","definition":"Fourth sense"}),
            ),
        ]);
        let lookup = |key: &str| Ok(values.get(key).cloned());
        let keys = |after: Option<&str>| {
            Ok(match after {
                None => ResourceKeyPage {
                    keys: vec!["lemma/alpha".into()],
                    next: Some("lemma/alpha".into()),
                },
                Some("lemma/alpha") => ResourceKeyPage {
                    keys: vec!["lemma/beta".into()],
                    next: None,
                },
                Some("lemma/beta") => ResourceKeyPage {
                    keys: vec![],
                    next: None,
                },
                _ => return Err("Invalid fixture cursor".into()),
            })
        };
        description().validate(PACKAGE).unwrap();
        let first = page(json!({"after":null,"limit":2}), &lookup, &keys).unwrap();
        assert_eq!(first.total, 4);
        assert_eq!(first.items.len(), 2);
        assert_eq!(first.items[0].summary.summary, "First line");
        assert_eq!(first.items[0].summary.target_id, "wn30:n:00000001:alpha");
        let last = page(json!({"after":first.next,"limit":2}), &lookup, &keys).unwrap();
        assert_eq!(
            last.items
                .iter()
                .map(|item| item.summary.target_id.as_str())
                .collect::<Vec<_>>(),
            ["wn30:v:00000003:alpha", "wn30:n:00000004:beta"]
        );
        assert_eq!(last.items[0].scopes, vec![scope_id("verb")]);
        assert_eq!(last.next, None);
        assert!(page(json!({"after":"not a cursor","limit":2}), &lookup, &keys).is_err());
        assert!(page(json!({"after":null,"limit":65}), &lookup, &keys).is_err());
    }
}
