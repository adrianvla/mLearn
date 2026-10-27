use super::{
    capabilities, inspect_entry, presentation, validate_lexicon_metadata, ATTRIBUTION, PACKAGE,
};
use mlearn_core::{
    CollectionCatalogPage, CollectionCatalogRequest, CollectionDescription,
    CollectionLevelMembership, CollectionTarget, LexicalEntry, LinguisticLabel,
};
use mlearn_language_sdk::{
    serde_json::{self, Value},
    ResourceKeyPage,
};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};

pub(super) fn description() -> CollectionDescription {
    CollectionDescription {
        capabilities: capabilities(),
        kinds: vec![LinguisticLabel {
            id: format!("{PACKAGE}:dictionary-entry"),
            label: "Dictionary entry".into(),
            color: None,
            attribution: ATTRIBUTION.into(),
        }],
        scopes: vec![LinguisticLabel {
            id: format!("{PACKAGE}:jmdict"),
            label: "JMdict".into(),
            color: None,
            attribution: ATTRIBUTION.into(),
        }],
        levels: (1..=5).map(presentation::vocabulary_level).collect(),
    }
}

pub(super) fn page(
    input: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
    keys: &impl Fn(Option<&str>, usize) -> Result<ResourceKeyPage, String>,
) -> Result<CollectionCatalogPage, String> {
    let request: CollectionCatalogRequest =
        serde_json::from_value(input).map_err(|error| error.to_string())?;
    request.validate()?;
    let metadata = lookup("metadata")?.ok_or("JMdict metadata missing")?;
    validate_lexicon_metadata(&metadata)?;
    let total = metadata["entries"]
        .as_u64()
        .and_then(|count| u32::try_from(count).ok())
        .filter(|count| *count <= 1_000_000)
        .ok_or("Invalid JMdict target count")?;
    let window = keys(request.after.as_deref(), request.limit as usize)?;
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
            kind: format!("{PACKAGE}:dictionary-entry"),
            capabilities,
            scopes: vec![format!("{PACKAGE}:jmdict")],
            levels,
            extensions: BTreeMap::new(),
        });
    }
    Ok(CollectionCatalogPage {
        items,
        next: window.next,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_language_sdk::serde_json::json;

    #[test]
    fn restricted_entry_catalog_preserves_all_levels_and_inline_hardest() {
        let values = BTreeMap::from([
            (
                "metadata",
                json!({"schema":"org.mlearn.japanese.lexicon","schemaVersion":3,
                "valueCodec":"zlib-json-v1","linguisticSchema":{"id":"org.mlearn.japanese.linguistic","version":1},"entries":2}),
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
        let keys = |after: Option<&str>, limit: usize| {
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
