use super::{
    capabilities, characters, inspect_entry, presentation, validate_lexicon_metadata, ATTRIBUTION,
    PACKAGE, SOURCE_METADATA_TARGET,
};
use mlearn_core::{
    CollectionCatalogPage, CollectionCatalogRequest, CollectionDescription,
    CollectionLevelMembership, CollectionTarget, LexicalEntry, LinguisticLabel,
};
use mlearn_language_sdk::{
    serde_json::{self, Value},
    ResourceKeyPage,
};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};

#[derive(Deserialize, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case", deny_unknown_fields)]
enum Cursor {
    Words { after: Option<String> },
    Characters { after: Option<String> },
}

pub(super) fn description() -> CollectionDescription {
    CollectionDescription {
        capabilities: capabilities(),
        kinds: vec![
            LinguisticLabel {
                id: format!("{PACKAGE}:dictionary-entry"),
                label: "Dictionary entry".into(),
                color: None,
                attribution: ATTRIBUTION.into(),
            },
            LinguisticLabel {
                id: format!("{PACKAGE}:character"),
                label: "Character".into(),
                color: None,
                attribution: characters::ATTRIBUTION.into(),
            },
            LinguisticLabel {
                id: format!("{PACKAGE}:source-metadata"),
                label: "Source metadata".into(),
                color: None,
                attribution: ATTRIBUTION.into(),
            },
        ],
        scopes: vec![
            LinguisticLabel {
                id: format!("{PACKAGE}:jmdict"),
                label: "JMdict".into(),
                color: None,
                attribution: ATTRIBUTION.into(),
            },
            LinguisticLabel {
                id: format!("{PACKAGE}:kanjidic"),
                label: "KANJIDIC2".into(),
                color: None,
                attribution: characters::ATTRIBUTION.into(),
            },
        ],
        levels: (1..=5).map(presentation::vocabulary_level).collect(),
    }
}

pub(super) fn page(
    input: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
    keys: &impl Fn(&str, Option<&str>, usize) -> Result<ResourceKeyPage, String>,
) -> Result<CollectionCatalogPage, String> {
    let request: CollectionCatalogRequest =
        serde_json::from_value(input).map_err(|error| error.to_string())?;
    request.validate()?;
    let metadata = lookup("metadata")?.ok_or("JMdict metadata missing")?;
    validate_lexicon_metadata(&metadata)?;
    let word_count = metadata["entries"]
        .as_u64()
        .and_then(|count| u32::try_from(count).ok())
        .filter(|count| *count <= 1_000_000)
        .ok_or("Invalid JMdict target count")?;
    let character_count = characters::count(&metadata)?;
    let total = word_count
        .checked_add(character_count)
        .filter(|count| *count <= 1_000_000)
        .ok_or("Catalog target count exceeds bounds")?;
    let cursor = request
        .after
        .as_deref()
        .map(serde_json::from_str::<Cursor>)
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| {
            if word_count == 0 && character_count > 0 {
                Cursor::Characters { after: None }
            } else {
                Cursor::Words { after: None }
            }
        });
    let (prefix, after, count) = match &cursor {
        Cursor::Words { after } => ("entry/", after.as_deref(), word_count),
        Cursor::Characters { after } => ("character/", after.as_deref(), character_count),
    };
    if after.is_some_and(|key| !key.starts_with(prefix)) || count == 0 && total != 0 {
        return Err("Invalid catalog prefix cursor".into());
    }
    // A real 24-entry window after entry/1207490 exceeds the unchanged 64M
    // allowance; 12 entries use 35.8M. Requested limits are upper bounds.
    let limit = usize::try_from(request.limit.min(12)).map_err(|error| error.to_string())?;
    let window = keys(prefix, after, limit)?;
    if window.keys.is_empty() && total != 0 {
        return Err("Catalog cursor or source count is inconsistent".into());
    }
    let cache = RefCell::new(BTreeMap::<String, Option<Rc<Value>>>::new());
    let resolve = |key: &str| {
        if let Some(value) = cache.borrow().get(key) {
            return Ok(value.clone());
        }
        let value = lookup(key)?.map(Rc::new);
        if cache.borrow().len() < 128 {
            cache.borrow_mut().insert(key.into(), value.clone());
        }
        Ok(value)
    };
    let mut items = Vec::with_capacity(window.keys.len());
    for key in window.keys {
        match &cursor {
            Cursor::Words { .. } => {}
            Cursor::Characters { .. } => {
                let codepoint = key
                    .strip_prefix("character/")
                    .ok_or("Invalid character catalog key")?;
                let target = format!("kanjidic:{codepoint}");
                let record = lookup(&key)?.ok_or("Character catalog entry missing")?;
                let entry: LexicalEntry =
                    serde_json::from_value(characters::inspect(&target, &|requested| {
                        Ok((requested == key).then(|| record.clone()))
                    })?)
                    .map_err(|error| error.to_string())?;
                let capabilities = entry
                    .capabilities
                    .iter()
                    .map(|value| value.id.clone())
                    .collect();
                items.push(CollectionTarget {
                    summary: entry.into(),
                    kind: format!("{PACKAGE}:character"),
                    capabilities,
                    scopes: vec![format!("{PACKAGE}:kanjidic")],
                    levels: Vec::new(),
                    extensions: BTreeMap::new(),
                });
                continue;
            }
        }
        let seq = key
            .strip_prefix("entry/")
            .filter(|seq| {
                !seq.is_empty() && seq.len() <= 10 && seq.bytes().all(|byte| byte.is_ascii_digit())
            })
            .ok_or("Invalid JMdict catalog key")?;
        let target = format!("jmdict:{seq}");
        let record = lookup(&key)?.ok_or("JMdict catalog entry missing")?;
        let (entry, levels) = inspect_entry(&target, record, &resolve)?;
        let entry: LexicalEntry =
            serde_json::from_value(entry).map_err(|error| error.to_string())?;
        let capabilities = entry
            .capabilities
            .iter()
            .map(|value| value.id.clone())
            .collect();
        let levels = levels
            .into_iter()
            .map(|level| {
                let value = presentation::vocabulary_level(level);
                CollectionLevelMembership {
                    scale_id: value.scale_id,
                    level: value.level,
                }
            })
            .collect();
        items.push(CollectionTarget {
            summary: entry.into(),
            kind: format!(
                "{PACKAGE}:{}",
                if target == SOURCE_METADATA_TARGET {
                    "source-metadata"
                } else {
                    "dictionary-entry"
                }
            ),
            capabilities,
            scopes: vec![format!("{PACKAGE}:jmdict")],
            levels,
            extensions: BTreeMap::new(),
        });
    }
    let next = match (cursor, window.next) {
        (Cursor::Words { .. }, Some(after)) => Some(Cursor::Words { after: Some(after) }),
        (Cursor::Words { .. }, None) if character_count > 0 => {
            Some(Cursor::Characters { after: None })
        }
        (Cursor::Words { .. }, None) => None,
        (Cursor::Characters { .. }, Some(after)) => Some(Cursor::Characters { after: Some(after) }),
        (Cursor::Characters { .. }, None) => None,
    };
    let next = next
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
    fn mixed_catalog_keeps_prefix_local_cursors_and_metadata_only_characters() {
        // Given one word and two source characters, one without learning associations.
        let values = BTreeMap::from([
            (
                "metadata",
                json!({
                    "schema":"org.mlearn.japanese.lexicon","schemaVersion":3,
                    "valueCodec":"zlib-json-v1",
                    "linguisticSchema":{"id":"org.mlearn.japanese.linguistic","version":1},
                    "entries":1,
                    "characterSchema":{"id":"org.mlearn.japanese.characters","version":1,"characters":2}
                }),
            ),
            (
                "entry/1",
                json!({
                    "targetId":"jmdict:1","headword":"橋",
                    "variants":[{"written":"橋","reading":"はし"}],
                    "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["bridge"]}]
                }),
            ),
            (
                "character/20000",
                json!({
                    "literal":"𠀀","codepoint":"20000","groups":[],"nameReadings":[]
                }),
            ),
            (
                "character/6a4b",
                json!({
                    "literal":"橋","codepoint":"6a4b","nameReadings":[],"legacyJlpt":4,
                    "groups":[{
                        "readings":[{"text":"はし","attributes":{"r_type":"ja_kun"}}],
                        "meanings":[{"text":"bridge","attributes":{}}]
                    }]
                }),
            ),
        ]);
        let lookup = |key: &str| Ok(values.get(key).cloned());
        let keys = |prefix: &str, after: Option<&str>, limit: usize| {
            assert!(after.is_none_or(|key| key.starts_with(prefix)));
            let available = values
                .keys()
                .copied()
                .filter(|key| key.starts_with(prefix) && after.is_none_or(|after| *key > after))
                .collect::<Vec<_>>();
            let keys = available
                .iter()
                .take(limit)
                .map(|key| (*key).to_string())
                .collect::<Vec<_>>();
            let next = (available.len() > keys.len()).then(|| keys.last().unwrap().clone());
            Ok(ResourceKeyPage { keys, next })
        };

        // When successive bounded calls cross the immutable resource-prefix boundary.
        let first = page(json!({"after":null,"limit":1}), &lookup, &keys).unwrap();
        let second = page(json!({"after":first.next,"limit":1}), &lookup, &keys).unwrap();
        let last = page(json!({"after":second.next,"limit":1}), &lookup, &keys).unwrap();

        // Then no identity disappears, acquires another target's keys, or invents a level.
        description().validate(PACKAGE).unwrap();
        assert_eq!([first.total, second.total, last.total], [3, 3, 3]);
        assert_eq!(
            [&first, &second, &last].map(|page| page.items[0].summary.target_id.as_str()),
            ["jmdict:1", "kanjidic:20000", "kanjidic:6a4b"]
        );
        assert!(second.items[0].capabilities.is_empty());
        assert_eq!(last.items[0].kind, format!("{PACKAGE}:character"));
        assert!(!last.items[0].capabilities.is_empty());
        assert!(last.items[0].levels.is_empty());
        assert!(last.items[0].summary.presentation.is_none());
        assert!(last.next.is_none());
        let foreign_prefix = json!({"phase":"characters","after":"entry/1"}).to_string();
        assert!(page(json!({"after":foreign_prefix,"limit":1}), &lookup, &keys).is_err());
    }

    #[test]
    fn character_only_catalog_skips_the_empty_word_phase() {
        // Given an immutable catalog with no word entries and one metadata-only scalar.
        let lookup = |key: &str| {
            Ok(match key {
                "metadata" => Some(json!({
                    "schema":"org.mlearn.japanese.lexicon","schemaVersion":3,
                    "valueCodec":"zlib-json-v1",
                    "linguisticSchema":{"id":"org.mlearn.japanese.linguistic","version":1},
                    "entries":0,
                    "characterSchema":{"id":"org.mlearn.japanese.characters","version":1,"characters":1}
                })),
                "character/20000" => Some(json!({
                    "literal":"𠀀","codepoint":"20000","groups":[],"nameReadings":[]
                })),
                _ => None,
            })
        };
        let keys = |prefix: &str, after: Option<&str>, limit: usize| {
            assert_eq!(prefix, "character/");
            assert!(after.is_none());
            assert_eq!(limit, 12);
            Ok(ResourceKeyPage {
                keys: vec!["character/20000".into()],
                next: None,
            })
        };

        // When the first bounded page is requested.
        let first = page(json!({"after":null,"limit":64}), &lookup, &keys).unwrap();

        // Then it publishes actual source content, never an empty intermediate page.
        assert_eq!(first.total, 1);
        assert_eq!(first.items.len(), 1);
        assert_eq!(first.items[0].summary.target_id, "kanjidic:20000");
        assert!(first.items[0].capabilities.is_empty());
        assert!(first.next.is_none());
    }

    #[test]
    fn publisher_metadata_remains_in_source_totals_without_lexical_kind_or_capabilities() {
        // Given the publisher's creation record in the immutable entry prefix.
        let lookup = |key: &str| {
            Ok(match key {
                "metadata" => Some(json!({
                    "schema":"org.mlearn.japanese.lexicon","schemaVersion":3,
                    "valueCodec":"zlib-json-v1",
                    "linguisticSchema":{"id":"org.mlearn.japanese.linguistic","version":1},
                    "entries":1,
                    "characterSchema":{"id":"org.mlearn.japanese.characters","version":1,"characters":0}
                })),
                "entry/9999999" => Some(json!({
                    "targetId":SOURCE_METADATA_TARGET,"headword":"ＪＭｄｉｃｔ",
                    "variants":[{"written":"ＪＭｄｉｃｔ","reading":"ジェイエムディクト"}],
                    "senses":[{"pos":["unclassified"],"forms":[],"readings":[],
                        "glosses":["Dictionary creation metadata"]}]
                })),
                _ => None,
            })
        };
        let keys = |prefix: &str, after: Option<&str>, _: usize| {
            assert_eq!(prefix, "entry/");
            assert!(after.is_none());
            Ok(ResourceKeyPage {
                keys: vec!["entry/9999999".into()],
                next: None,
            })
        };

        // When its actual catalog row is published.
        let result = page(json!({"after":null,"limit":12}), &lookup, &keys).unwrap();

        // Then source membership is truthful without claiming a vocabulary capability.
        description().validate(PACKAGE).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.items[0].summary.target_id, SOURCE_METADATA_TARGET);
        assert_eq!(result.items[0].kind, format!("{PACKAGE}:source-metadata"));
        assert!(result.items[0].capabilities.is_empty());
        assert!(result.items[0].levels.is_empty());
    }

    #[test]
    fn requested_large_windows_preserve_a_bounded_continuation() {
        let lookup = |key: &str| {
            if key == "metadata" {
                return Ok(Some(
                    json!({"schema":"org.mlearn.japanese.lexicon","schemaVersion":3,
                    "valueCodec":"zlib-json-v1","linguisticSchema":{"id":"org.mlearn.japanese.linguistic","version":1},
                    "entries":13,"characterSchema":{"id":"org.mlearn.japanese.characters","version":1,"characters":0}}),
                ));
            }
            Ok(key.strip_prefix("entry/").map(|id| {
                json!({
                    "targetId":format!("jmdict:{id}"),"headword":"語",
                    "variants":[{"written":"語","reading":"ご"}],
                    "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["word"]}]
                })
            }))
        };
        let keys = |prefix: &str, after: Option<&str>, limit: usize| {
            assert_eq!(prefix, "entry/");
            let all = (100..=112)
                .map(|id| format!("entry/{id}"))
                .collect::<Vec<_>>();
            let eligible = all
                .into_iter()
                .filter(|key| after.is_none_or(|after| key.as_str() > after))
                .collect::<Vec<_>>();
            let keys = eligible.iter().take(limit).cloned().collect::<Vec<_>>();
            let next = (eligible.len() > keys.len()).then(|| keys.last().unwrap().clone());
            Ok(ResourceKeyPage { keys, next })
        };
        let first = page(json!({"after":null,"limit":64}), &lookup, &keys).unwrap();
        assert_eq!(first.items.len(), 12);
        let last = page(json!({"after":first.next,"limit":64}), &lookup, &keys).unwrap();
        assert_eq!(last.items.len(), 1);
        assert_eq!(last.items[0].summary.target_id, "jmdict:112");
        assert_eq!(last.next, None);
    }

    #[test]
    fn restricted_entry_catalog_preserves_all_levels_and_inline_hardest() {
        let values = BTreeMap::from([
            (
                "metadata",
                json!({"schema":"org.mlearn.japanese.lexicon","schemaVersion":3,
                "valueCodec":"zlib-json-v1","linguisticSchema":{"id":"org.mlearn.japanese.linguistic","version":1},"entries":2,
                "characterSchema":{"id":"org.mlearn.japanese.characters","version":1,"characters":0}}),
            ),
            (
                "entry/1",
                json!({"targetId":"jmdict:1","headword":"語",
                "variants":[{"written":"語","reading":"ご"}],
                "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["word","language"]}]}),
            ),
            (
                "entry/2",
                json!({"targetId":"jmdict:2","headword":"字",
                "variants":[{"written":"字","reading":"じ"}],
                "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["letter"]}]}),
            ),
            ("linguistic/3:語ご", json!({"accent":[],"jlpt":[1,5]})),
            ("linguistic/3:字じ", json!({"accent":[],"jlpt":[5]})),
        ]);
        let lookup = |key: &str| Ok(values.get(key).cloned());
        let keys = |prefix: &str, after: Option<&str>, limit: usize| {
            assert_eq!(prefix, "entry/");
            assert_eq!(limit, 1);
            Ok(match after {
                None => ResourceKeyPage {
                    keys: vec!["entry/1".into()],
                    next: Some("entry/1".into()),
                },
                Some("entry/1") => ResourceKeyPage {
                    keys: vec!["entry/2".into()],
                    next: None,
                },
                _ => return Err("Invalid fixture cursor".into()),
            })
        };
        description().validate(PACKAGE).unwrap();
        let first = page(json!({"after":null,"limit":1}), &lookup, &keys).unwrap();
        assert_eq!(first.total, 2);
        assert_eq!(first.items[0].summary.target_id, "jmdict:1");
        assert_eq!(
            first.items[0]
                .levels
                .iter()
                .map(|value| value.level.as_str())
                .collect::<Vec<_>>(),
            ["N1", "N5"]
        );
        assert_eq!(
            first.items[0]
                .summary
                .presentation
                .as_ref()
                .unwrap()
                .levels
                .as_ref()
                .unwrap()[0]
                .level,
            "N1"
        );
        assert_eq!(first.items[0].summary.summary, "word; language");
        let last = page(json!({"after":first.next,"limit":1}), &lookup, &keys).unwrap();
        assert_eq!(last.items[0].summary.target_id, "jmdict:2");
        assert_eq!(last.items[0].levels[0].level, "N5");
        assert_eq!(last.next, None);
        assert!(page(json!({"after":null,"limit":0}), &lookup, &keys).is_err());
    }
}
