use super::{
    characters, dictionary_capabilities, validate_entry, Candidate, DictionaryEntry, PACKAGE,
    SOURCE_METADATA_TARGET,
};
use mlearn_core::{
    GraphConnection, GraphNeighborhood, GraphProperty, LexicalEntry, LinguisticEntity,
    LinguisticLabel, LinguisticRelation, RelationCategory,
};
use mlearn_language_sdk::serde_json::{self, json, Value};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{btree_map::Entry, BTreeMap, BTreeSet};

const ATTRIBUTION: &str = "JMdict (2026-10-17), James William Breen / EDRDG, CC-BY-SA-4.0";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Query {
    target_id: String,
    after: Option<String>,
}

/// Positions address this immutable package snapshot, never entity identities.
/// Each call examines at most32 candidate records and emits at most16 edges.
#[derive(Default, Deserialize, Serialize)]
struct Cursor {
    variant: usize,
    facet: u8,
    candidate: usize,
}

impl Cursor {
    fn advance(&mut self) {
        self.candidate = 0;
        if self.facet == 2 {
            self.variant += 1;
            self.facet = 0;
        } else {
            self.facet += 1;
        }
    }
}

fn label(id: &str, text: &str, attribution: &str) -> LinguisticLabel {
    LinguisticLabel {
        id: format!("{PACKAGE}:{id}"),
        label: text.into(),
        color: None,
        attribution: attribution.into(),
    }
}

fn property(id: &str, label: &str, value: Value, attribution: &str) -> GraphProperty {
    GraphProperty {
        id: format!("{PACKAGE}:{id}"),
        label: label.into(),
        value,
        attribution: attribution.into(),
    }
}

fn identity(value: &Value) -> Result<String, String> {
    Ok(format!(
        "{PACKAGE}:graph:{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|error| error.to_string())?)
    ))
}

fn load(
    target: &str,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<DictionaryEntry, String> {
    let sequence = target
        .strip_prefix("jmdict:")
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 10
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .ok_or("Unknown Japanese graph target")?;
    validate_entry(
        target,
        lookup(&format!("entry/{sequence}"))?.ok_or("JMdict graph entry is unavailable")?,
    )
}

fn entity(entry: &DictionaryEntry) -> LinguisticEntity {
    LinguisticEntity {
        id: entry.target_id.clone(),
        kind: if entry.target_id == SOURCE_METADATA_TARGET {
            label("source-metadata", "Source metadata", ATTRIBUTION)
        } else {
            label("dictionary-entry", "Dictionary entry", ATTRIBUTION)
        },
        label: entry.headword.clone(),
        target_id: Some(entry.target_id.clone()),
        capabilities: dictionary_capabilities(&entry.target_id),
        properties: vec![
            property(
                "dictionary-id",
                "Dictionary source identity",
                json!(entry.target_id),
                ATTRIBUTION,
            ),
            property(
                if entry.target_id == SOURCE_METADATA_TARGET {
                    "source-description"
                } else {
                    "definition-preview"
                },
                if entry.target_id == SOURCE_METADATA_TARGET {
                    "Source metadata"
                } else {
                    "Definition preview"
                },
                json!(entry.senses[0]
                    .glosses
                    .join("; ")
                    .chars()
                    .take(512)
                    .collect::<String>()),
                ATTRIBUTION,
            ),
        ],
        attribution: ATTRIBUTION.into(),
    }
}

fn source_identity(kind: &str, value: &Value) -> Result<String, String> {
    let text = value["text"]
        .as_str()
        .filter(|text| !text.is_empty())
        .ok_or("Invalid character source value")?;
    let attributes: BTreeMap<String, String> =
        serde_json::from_value(value["attributes"].clone()).map_err(|error| error.to_string())?;
    identity(&json!(["character-source", kind, text, attributes]))
}

fn character_fact(
    root: &str,
    kind: &str,
    description: &str,
    value: Value,
    group: Option<&str>,
    attribution: &str,
) -> Result<GraphConnection, String> {
    let id = source_identity(kind, &value)?;
    let text = value["text"]
        .as_str()
        .ok_or("Invalid character source text")?
        .to_string();
    let qualifiers = group
        .map(|group| {
            property(
                "source-group",
                "Reading/meaning group",
                json!(group),
                characters::ATTRIBUTION,
            )
        })
        .into_iter()
        .collect();
    Ok(GraphConnection {
        relation: LinguisticRelation {
            id: identity(&json!([root, kind, id, group]))?,
            category: RelationCategory::Property,
            predicate: label(kind, description, attribution),
            from: root.into(),
            to: id.clone(),
            qualifiers,
            attribution: attribution.into(),
        },
        entity: LinguisticEntity {
            id,
            kind: label(kind, description, attribution),
            label: text,
            target_id: None,
            capabilities: Vec::new(),
            properties: vec![property("source-value", "Source value", value, attribution)],
            attribution: attribution.into(),
        },
    })
}

fn character_neighborhood(
    query: Query,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<GraphNeighborhood, String> {
    let codepoint = query
        .target_id
        .strip_prefix("kanjidic:")
        .ok_or("Unknown character graph target")?;
    let key = format!("character/{codepoint}");
    let record = lookup(&key)?.ok_or("Character graph source is unavailable")?;
    let entry: LexicalEntry =
        serde_json::from_value(characters::inspect(&query.target_id, &|requested| {
            Ok((requested == key).then(|| record.clone()))
        })?)
        .map_err(|error| error.to_string())?;
    let components = match &record["components"] {
        Value::Null => None,
        Value::Array(values) => Some(values),
        _ => return Err("Invalid character lookup-element source".into()),
    };
    let mut properties = vec![property(
        "codepoint",
        "Unicode scalar",
        json!(format!("U+{}", codepoint.to_ascii_uppercase())),
        characters::ATTRIBUTION,
    )];
    for (id, text, field) in [
        ("stroke-counts", "Stroke counts", "strokeCounts"),
        ("grade", "KANJIDIC2 grade", "grade"),
        ("frequency", "KANJIDIC2 frequency rank", "frequency"),
        ("legacy-jlpt", "JLPT (pre-2010)", "legacyJlpt"),
    ] {
        if !record[field].is_null() {
            properties.push(property(
                id,
                text,
                record[field].clone(),
                characters::ATTRIBUTION,
            ));
        }
    }
    properties.push(property(
        "lookup-elements-available",
        "Lookup-element source available",
        json!(components.is_some()),
        characters::COMPONENT_ATTRIBUTION,
    ));
    let root = LinguisticEntity {
        id: query.target_id.clone(),
        kind: label("character", "Character", characters::ATTRIBUTION),
        label: entry.headword,
        target_id: Some(query.target_id.clone()),
        capabilities: entry.capabilities,
        properties,
        attribution: characters::ATTRIBUTION.into(),
    };
    let mut facts = BTreeMap::new();
    let mut add =
        |kind: &str, description: &str, value: Value, group: Option<&str>, attribution: &str| {
            let connection =
                character_fact(&root.id, kind, description, value, group, attribution)?;
            facts
                .entry(connection.relation.id.clone())
                .or_insert(connection);
            Ok::<_, String>(())
        };
    for (field, kind, text) in [
        ("codes", "character-code", "Source code"),
        (
            "radicals",
            "radical-classification",
            "Radical classification",
        ),
        ("variants", "variant-reference", "Variant reference"),
    ] {
        for value in record[field]
            .as_array()
            .ok_or("Invalid character source list")?
        {
            add(kind, text, value.clone(), None, characters::ATTRIBUTION)?;
        }
    }
    for group in record["groups"]
        .as_array()
        .ok_or("Invalid character source groups")?
    {
        let readings = group["readings"]
            .as_array()
            .ok_or("Invalid source readings")?;
        let meanings = group["meanings"]
            .as_array()
            .ok_or("Invalid source meanings")?;
        let members = [
            ("reading", "Reading", readings),
            ("meaning", "Meaning", meanings),
        ];
        let mut semantic_members = BTreeSet::new();
        for (kind, _, values) in members {
            for value in values {
                semantic_members.insert(source_identity(kind, value)?);
            }
        }
        let group_id = identity(&json!(["character-group", semantic_members]))?;
        for (kind, text, values) in members {
            for value in values {
                add(
                    kind,
                    text,
                    value.clone(),
                    Some(&group_id),
                    characters::ATTRIBUTION,
                )?;
            }
        }
    }
    for value in record["nameReadings"]
        .as_array()
        .ok_or("Invalid source name readings")?
    {
        let text = value.as_str().ok_or("Invalid source name reading")?;
        add(
            "name-reading",
            "Name reading",
            json!({"text":text,"attributes":{}}),
            None,
            characters::ATTRIBUTION,
        )?;
    }
    if let Some(components) = components {
        for value in components {
            let text = value.as_str().ok_or("Invalid lookup element")?;
            add(
                "lookup-element",
                "Lookup element",
                json!({"text":text,"attributes":{}}),
                None,
                characters::COMPONENT_ATTRIBUTION,
            )?;
        }
    }
    if query
        .after
        .as_ref()
        .is_some_and(|after| !facts.contains_key(after))
    {
        return Err("Invalid character graph cursor".into());
    }
    let mut eligible = facts.into_values().filter(|connection| {
        query
            .after
            .as_deref()
            .is_none_or(|after| connection.relation.id.as_str() > after)
    });
    let connections = eligible.by_ref().take(16).collect::<Vec<_>>();
    let next = eligible.next().and_then(|_| {
        connections
            .last()
            .map(|connection| connection.relation.id.clone())
    });
    Ok(GraphNeighborhood {
        entity: root,
        connections,
        next,
    })
}

pub(super) fn neighborhood(
    input: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<GraphNeighborhood, String> {
    let query: Query = serde_json::from_value(input).map_err(|error| error.to_string())?;
    if query.target_id.starts_with("kanjidic:") {
        return character_neighborhood(query, lookup);
    }
    let entry = load(&query.target_id, lookup)?;
    if entry.target_id == SOURCE_METADATA_TARGET {
        if query.after.is_some() {
            return Err("Source metadata has no graph continuation".into());
        }
        return Ok(GraphNeighborhood {
            entity: entity(&entry),
            connections: Vec::new(),
            next: None,
        });
    }
    let mut cursor = query
        .after
        .as_ref()
        .map(|after| serde_json::from_str::<Cursor>(after))
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    if cursor.facet > 2
        || cursor.variant > entry.variants.len()
        || query.after.is_some() && cursor.variant == entry.variants.len()
        || cursor.facet == 0 && cursor.candidate != 0
    {
        return Err("Invalid JMdict graph cursor".into());
    }
    let root = entity(&entry);
    let mut connections = Vec::new();
    let mut indices = BTreeMap::<String, Vec<Candidate>>::new();
    let mut examined = 0;
    while cursor.variant < entry.variants.len() && examined < 32 && connections.len() < 16 {
        let variant = &entry.variants[cursor.variant];
        if cursor.facet == 0 {
            let form = LinguisticEntity {
                id: identity(&json!(["form", variant.written, variant.reading]))?,
                kind: label(
                    "written-reading-pair",
                    "Attested written form and reading",
                    ATTRIBUTION,
                ),
                label: format!("{} · {}", variant.written, variant.reading),
                target_id: None,
                capabilities: vec![],
                properties: vec![
                    property(
                        "written",
                        "Written form",
                        json!(variant.written),
                        ATTRIBUTION,
                    ),
                    property("reading", "Reading", json!(variant.reading), ATTRIBUTION),
                ],
                attribution: ATTRIBUTION.into(),
            };
            connections.push(GraphConnection {
                relation: LinguisticRelation {
                    id: identity(&json!([root.id, "written-reading", form.id]))?,
                    category: RelationCategory::Property,
                    predicate: label("written-reading", "Attested form and reading", ATTRIBUTION),
                    from: root.id.clone(),
                    to: form.id.clone(),
                    qualifiers: vec![],
                    attribution: ATTRIBUTION.into(),
                },
                entity: form,
            });
            examined += 1;
            cursor.advance();
            continue;
        }
        let form = match cursor.facet {
            1 => &variant.written,
            2 => &variant.reading,
            _ => return Err("Invalid JMdict graph facet".into()),
        };
        let candidates = match indices.entry(form.clone()) {
            Entry::Occupied(value) => value.into_mut(),
            Entry::Vacant(slot) => {
                let value = lookup(&format!("form/{form}"))?
                    .ok_or("JMdict graph form index is unavailable")?;
                slot.insert(serde_json::from_value(value).map_err(|error| error.to_string())?)
            }
        };
        if candidates.len() > 128 || cursor.candidate > candidates.len() {
            return Err("JMdict graph candidate bound or cursor is invalid".into());
        }
        if cursor.candidate == candidates.len() {
            cursor.advance();
            continue;
        }
        let candidate = &candidates[cursor.candidate];
        cursor.candidate += 1;
        examined += 1;
        if candidate.id == query.target_id
            || candidate.id == SOURCE_METADATA_TARGET
            || cursor.facet == 2 && candidate.reading != variant.reading
        {
            continue;
        }
        let related = entity(&load(&candidate.id, lookup)?);
        let (category, predicate, text) = match cursor.facet {
            1 => (
                RelationCategory::Alternative,
                "same-written-form",
                "Alternative dictionary analysis",
            ),
            2 => (
                RelationCategory::Support,
                "shared-reading",
                "Shared pronunciation",
            ),
            _ => return Err("Invalid JMdict graph facet".into()),
        };
        connections.push(GraphConnection {
            relation: LinguisticRelation {
                id: identity(&json!([root.id, predicate, related.id,
                    variant.written, variant.reading, candidate.reading, candidate.pos]))?,
                category, predicate: label(predicate, text, ATTRIBUTION), from: root.id.clone(), to: related.id.clone(),
                qualifiers: vec![
                    property("matched-form", "Matched source form", json!(form), ATTRIBUTION),
                    property("candidate-reading", "Candidate reading", json!(candidate.reading), ATTRIBUTION),
                    property("candidate-categories", "Dictionary categories", json!(candidate.pos), ATTRIBUTION),
                    property("identity-limit", "Identity limit",
                        json!("A shared written form, reading or dictionary grouping does not merge learner targets or demonstrate another capability."), ATTRIBUTION),
                ],
                attribution: ATTRIBUTION.into(),
            }, entity: related,
        });
    }
    let next = (cursor.variant < entry.variants.len())
        .then(|| serde_json::to_string(&cursor).map_err(|error| error.to_string()))
        .transpose()?;
    Ok(GraphNeighborhood {
        entity: root,
        connections,
        next,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(target: &str, written: &str, reading: &str) -> Value {
        json!({"targetId":target,"headword":written,"variants":[{"written":written,"reading":reading}],
            "senses":[{"pos":["noun"],"forms":[],"readings":[],"glosses":["dictionary meaning"]}]})
    }

    fn character_record() -> Value {
        let mut meanings = (0..64)
            .map(|index| json!({"text":format!("meaning-{index}"),"attributes":{}}))
            .collect::<Vec<_>>();
        meanings.push(json!({"text":"pont","attributes":{"m_lang":"fr"}}));
        json!({
            "literal":"橋","codepoint":"6a4b",
            "codes":[{"text":"6a4b","attributes":{"cp_type":"ucs"}}],
            "groups":[{
                "readings":[
                    {"text":"はし","attributes":{"r_type":"ja_kun","org.future:notation":"unfamiliar"}},
                    {"text":"qiao2","attributes":{"r_type":"pinyin"}}
                ],
                "meanings":meanings
            }],
            "nameReadings":["はせ"],"strokeCounts":[16],"grade":null,
            "frequency":null,"legacyJlpt":4,
            "radicals":[{"text":"75","attributes":{"rad_type":"classical"}}],
            "variants":[],"components":["木","冂"]
        })
    }

    fn character_pages(target: &str, record: Value) -> Vec<GraphNeighborhood> {
        let key = format!("character/{}", target.strip_prefix("kanjidic:").unwrap());
        let lookup = |requested: &str| {
            Ok(if requested == key {
                Some(record.clone())
            } else if requested == "character/6728" {
                Some(json!({
                    "literal":"木","codepoint":"6728","nameReadings":[],
                    "groups":[{
                        "readings":[{"text":"き","attributes":{"r_type":"ja_kun"}}],
                        "meanings":[{"text":"tree","attributes":{}}]
                    }]
                }))
            } else {
                None
            })
        };
        let mut pages = Vec::new();
        let mut after = None;
        loop {
            let page = neighborhood(json!({"targetId":target,"after":after}), &lookup).unwrap();
            after = page.next.clone();
            pages.push(page);
            assert!(pages.len() <= 8);
            if after.is_none() {
                return pages;
            }
        }
    }

    #[test]
    fn character_facts_page_without_binding_foreign_readings_or_lookup_representatives() {
        // Given grouped source facts larger than one bounded graph response.
        let source = character_record();
        assert!(serde_json::to_vec(&source["groups"][0]).unwrap().len() > 2048);

        // When the existing graph protocol reads every native continuation.
        let pages = character_pages("kanjidic:6a4b", source);

        // Then provenance and associations survive, without inventing learner targets.
        let mut ids = BTreeSet::new();
        for page in &pages {
            assert_eq!(page.entity.target_id.as_deref(), Some("kanjidic:6a4b"));
            assert!(page.connections.len() <= 16);
            assert!(serde_json::to_vec(page).unwrap().len() <= 128 * 1024);
            for connection in &page.connections {
                assert!(ids.insert(connection.relation.id.clone()));
                assert_eq!(connection.relation.category, RelationCategory::Property);
                assert!(connection.entity.target_id.is_none());
                assert!(connection.entity.capabilities.is_empty());
                for property in &connection.entity.properties {
                    assert!(serde_json::to_vec(&property.value).unwrap().len() <= 2048);
                }
            }
        }
        assert_eq!(ids.len(), 72);
        let facts = pages
            .iter()
            .flat_map(|page| &page.connections)
            .collect::<Vec<_>>();
        let pinyin = facts
            .iter()
            .find(|fact| fact.entity.label == "qiao2")
            .unwrap();
        assert_eq!(
            pinyin.entity.properties[0].value["attributes"]["r_type"],
            "pinyin"
        );
        assert_eq!(pinyin.relation.qualifiers.len(), 1);
        let japanese = facts
            .iter()
            .find(|fact| fact.entity.label == "はし")
            .unwrap();
        assert_eq!(
            japanese.entity.properties[0].value["attributes"]["org.future:notation"],
            "unfamiliar"
        );
        let components = facts
            .iter()
            .filter(|fact| fact.entity.kind.id == format!("{PACKAGE}:lookup-element"))
            .collect::<Vec<_>>();
        assert_eq!(components.len(), 2);
        assert!(components.iter().all(|fact| {
            fact.entity.attribution == characters::COMPONENT_ATTRIBUTION
                && fact.relation.attribution == characters::COMPONENT_ATTRIBUTION
        }));
    }

    #[test]
    fn character_fact_and_group_identities_do_not_depend_on_source_array_order() {
        // Given one immutable set of attributed source associations.
        let mut source = character_record();
        let original = character_pages("kanjidic:6a4b", source.clone());
        source["groups"][0]["readings"]
            .as_array_mut()
            .unwrap()
            .reverse();
        source["groups"][0]["meanings"]
            .as_array_mut()
            .unwrap()
            .reverse();
        source["components"].as_array_mut().unwrap().reverse();

        // When the same semantic source values arrive in another publication order.
        let reordered = character_pages("kanjidic:6a4b", source);

        // Then property and parallel-group relation identities are unchanged.
        let relations = |pages: Vec<GraphNeighborhood>| {
            pages
                .into_iter()
                .flat_map(|page| page.connections)
                .map(|connection| (connection.relation.id, connection.entity.id))
                .collect::<BTreeSet<_>>()
        };
        assert_eq!(relations(original), relations(reordered));
    }

    #[test]
    fn metadata_only_character_retains_unavailable_component_coverage_without_learning_keys() {
        // Given a valid scalar with source metadata but no learning associations.
        let mut source = character_record();
        source["literal"] = json!("𠀀");
        source["codepoint"] = json!("20000");
        source["codes"] = json!([{"text":"20000","attributes":{"cp_type":"ucs"}}]);
        source["groups"] = json!([]);
        source["nameReadings"] = json!([]);
        source["radicals"] = json!([]);
        source["components"] = Value::Null;

        // When its existing source identity opens in the generic graph.
        let pages = character_pages("kanjidic:20000", source);

        // Then unavailable data is not an empty-success decomposition or word fallback.
        assert!(pages[0].entity.capabilities.is_empty());
        assert_eq!(
            pages[0]
                .entity
                .properties
                .iter()
                .find(|property| property.id == format!("{PACKAGE}:lookup-elements-available"))
                .unwrap()
                .value,
            json!(false)
        );
        assert_eq!(pages[0].connections.len(), 1);
        assert!(pages[0].connections[0].entity.target_id.is_none());
    }

    #[test]
    fn publisher_metadata_has_no_lexical_graph_bindings_or_continuation() {
        // Given source information that happens to share the dictionary record format.
        let lookup = |key: &str| {
            if key == "entry/9999999" {
                Ok(Some(record(
                    SOURCE_METADATA_TARGET,
                    "ＪＭｄｉｃｔ",
                    "ジェイエムディクト",
                )))
            } else {
                Err("Source metadata must not require lexical relation indices".into())
            }
        };

        // When it is opened through the existing graph owner.
        let result = neighborhood(
            json!({"targetId":SOURCE_METADATA_TARGET,"after":null}),
            &lookup,
        )
        .unwrap();

        // Then it remains attributed source information, not an analysis or learner key.
        assert_eq!(result.entity.kind.id, format!("{PACKAGE}:source-metadata"));
        assert!(result.entity.capabilities.is_empty());
        assert!(result.connections.is_empty());
        assert!(result.next.is_none());
    }

    #[test]
    fn homophones_and_same_written_analyses_keep_separate_explicit_targets() {
        let lookup = |key: &str| -> Result<Option<Value>, String> {
            Ok(match key {
                "entry/1" => Some(record("jmdict:1", "橋", "はし")),
                "entry/2" => Some(record("jmdict:2", "箸", "はし")),
                "entry/3" => Some(record("jmdict:3", "橋", "きょう")),
                "form/橋" => Some(json!([{"id":"jmdict:1","reading":"はし","pos":["noun"]},
                    {"id":"jmdict:3","reading":"きょう","pos":["noun"]}])),
                "form/はし" => Some(json!([{"id":"jmdict:1","reading":"はし","pos":["noun"]},
                    {"id":"jmdict:2","reading":"はし","pos":["noun"]}])),
                _ => None,
            })
        };
        let result = neighborhood(json!({"targetId":"jmdict:1","after":null}), &lookup).unwrap();
        assert_eq!(result.connections.len(), 3);
        let form = &result.connections[0];
        assert_eq!(form.relation.category, RelationCategory::Property);
        assert_eq!(form.entity.target_id, None);
        assert!(form.entity.capabilities.is_empty());
        assert_eq!(
            result.connections[1].relation.category,
            RelationCategory::Alternative
        );
        assert_eq!(
            result.connections[1].entity.target_id.as_deref(),
            Some("jmdict:3")
        );
        assert_eq!(
            result.connections[2].relation.category,
            RelationCategory::Support
        );
        assert_eq!(
            result.connections[2].entity.target_id.as_deref(),
            Some("jmdict:2")
        );
        assert!(result
            .connections
            .iter()
            .all(|item| item.relation.category != RelationCategory::Identity));
    }

    #[test]
    fn graph_candidate_quanta_continue_without_losing_or_reidentifying_relations() {
        let lookup = |key: &str| -> Result<Option<Value>, String> {
            if let Some(sequence) = key.strip_prefix("entry/") {
                return Ok(Some(record(&format!("jmdict:{sequence}"), "同", "どう")));
            }
            Ok(key.starts_with("form/").then(|| {
                json!((1..=41).map(|index|
                json!({"id":format!("jmdict:{index}"),"reading":"どう","pos":["noun"]})
            ).collect::<Vec<_>>())
            }))
        };
        let mut after: Option<String> = None;
        let mut ids = std::collections::BTreeSet::new();
        let mut pages = 0;
        loop {
            let page = neighborhood(json!({"targetId":"jmdict:1","after":after}), &lookup).unwrap();
            assert!(page.connections.len() <= 16);
            for connection in page.connections {
                assert!(ids.insert(connection.relation.id));
            }
            pages += 1;
            assert!(pages < 16);
            after = page.next;
            if after.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), 81);
        assert!(neighborhood(
            json!({"targetId":"jmdict:1","after":"not-a-cursor"}),
            &lookup
        )
        .is_err());
    }
}
