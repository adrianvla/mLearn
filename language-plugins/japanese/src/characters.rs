use super::{capabilities, PACKAGE};
use mlearn_language_sdk::serde_json::{self, json, Value};
use serde::Deserialize;
use std::collections::BTreeMap;

pub(super) const ATTRIBUTION: &str =
    "KANJIDIC2 (2026-301, 2026-10-28), James William Breen / EDRDG, CC-BY-SA-4.0. https://www.edrdg.org/edrdg/licence.html";
pub(super) const COMPONENT_ATTRIBUTION: &str =
    "KRADFILE (0c5487c1de77), Michael Raine / James William Breen / EDRDG, CC-BY-SA-4.0. https://www.edrdg.org/edrdg/licence.html";

pub(super) fn count(metadata: &Value) -> Result<u32, String> {
    let schema = &metadata["characterSchema"];
    if schema["id"] != "org.mlearn.japanese.characters" || schema["version"] != 1 {
        return Err("Character data is incompatible with this package".into());
    }
    schema["characters"]
        .as_u64()
        .and_then(|count| u32::try_from(count).ok())
        .filter(|count| *count <= 1_000_000)
        .ok_or_else(|| "Invalid character target count".into())
}

#[derive(Deserialize)]
struct SourceValue {
    text: String,
    attributes: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct Group {
    readings: Vec<SourceValue>,
    meanings: Vec<SourceValue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Character {
    literal: String,
    codepoint: String,
    groups: Vec<Group>,
    name_readings: Vec<String>,
}

fn load(
    target: &str,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Character, String> {
    let codepoint = target
        .strip_prefix("kanjidic:")
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 6
                && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .ok_or("Unknown Japanese character identity")?;
    let character: Character = serde_json::from_value(
        lookup(&format!("character/{codepoint}"))?.ok_or("Character source is unavailable")?,
    )
    .map_err(|error| error.to_string())?;
    let mut literal = character.literal.chars();
    let scalar = literal.next().ok_or("Character source has no literal")?;
    if literal.next().is_some()
        || character.codepoint != codepoint
        || format!("{:x}", u32::from(scalar)) != codepoint
    {
        return Err("Character source identity disagrees with its literal".into());
    }
    Ok(character)
}

pub(super) fn inspect(
    target: &str,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let character = load(target, lookup)?;
    let mut readings = Vec::new();
    for reading in character.groups.iter().flat_map(|group| &group.readings) {
        if matches!(
            reading.attributes.get("r_type").map(String::as_str),
            Some("ja_on" | "ja_kun")
        ) && !readings.contains(&reading.text.as_str())
        {
            readings.push(reading.text.as_str());
        }
    }
    for reading in &character.name_readings {
        if !readings.contains(&reading.as_str()) {
            readings.push(reading.as_str());
        }
    }
    let meanings = character
        .groups
        .iter()
        .map(|group| {
            group
                .meanings
                .iter()
                .filter(|meaning| {
                    meaning
                        .attributes
                        .get("m_lang")
                        .is_none_or(|language| language == "en")
                })
                .map(|meaning| meaning.text.as_str())
                .collect::<Vec<_>>()
        })
        .filter(|group| !group.is_empty())
        .collect::<Vec<_>>();
    let has_reading = !readings.is_empty();
    let has_meaning = !meanings.is_empty();
    let supported = capabilities()
        .into_iter()
        .filter(|capability| {
            capability.id == format!("{PACKAGE}:written-recognition")
                && (has_reading || has_meaning)
                || capability.id == format!("{PACKAGE}:meaning") && has_meaning
                || capability.id == format!("{PACKAGE}:reading") && has_reading
        })
        .collect::<Vec<_>>();
    let definition = meanings
        .iter()
        .map(|group| group.join("; "))
        .collect::<Vec<_>>()
        .join("\n");
    let summary = has_meaning.then(|| {
        meanings
            .iter()
            .flatten()
            .take(3)
            .copied()
            .collect::<Vec<_>>()
            .join("; ")
            .chars()
            .take(512)
            .collect::<String>()
    });
    let senses = has_meaning.then(|| {
        meanings
            .iter()
            .map(|definitions| {
                json!({"heading":"","labels":[],"definitions":definitions,"notes":[]})
            })
            .collect::<Vec<_>>()
    });
    Ok(json!({
        "targetId":target,
        "headword":character.literal,
        "reading":has_reading.then(|| readings.join(" / ")),
        "partOfSpeech":"",
        "definition":definition,
        "summary":summary,
        "senses":senses,
        "attribution":ATTRIBUTION,
        "capabilities":supported,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> Value {
        json!({
            "literal":"橋","codepoint":"6a4b",
            "groups":[{
                "readings":[
                    {"text":"キョウ","attributes":{"r_type":"ja_on"}},
                    {"text":"はし","attributes":{"r_type":"ja_kun"}},
                    {"text":"qiao2","attributes":{"r_type":"pinyin"}}
                ],
                "meanings":[
                    {"text":"bridge","attributes":{}},
                    {"text":"pont","attributes":{"m_lang":"fr"}}
                ]
            }],
            "nameReadings":["はせ"]
        })
    }

    #[test]
    fn japanese_source_associations_exclude_foreign_readings_and_audio_capabilities() {
        // Given source-owned Japanese associations and separately tagged foreign facts.
        let lookup = |key: &str| Ok((key == "character/6a4b").then(source));
        // When inspecting the canonical character rather than a dictionary word.
        let entry = inspect("kanjidic:6a4b", &lookup).unwrap();
        // Then only attested Japanese associations create learning entry points.
        assert_eq!(entry["targetId"], "kanjidic:6a4b");
        assert_eq!(entry["headword"], "橋");
        assert_eq!(entry["reading"], "キョウ / はし / はせ");
        assert_eq!(entry["senses"][0]["definitions"], json!(["bridge"]));
        assert_eq!(
            entry["capabilities"],
            json!([
                {"id":format!("{PACKAGE}:written-recognition"),"label":"Written recognition"},
                {"id":format!("{PACKAGE}:meaning"),"label":"Meaning"},
                {"id":format!("{PACKAGE}:reading"),"label":"Reading"}
            ])
        );
    }

    #[test]
    fn supplementary_metadata_only_character_has_no_implicit_learning_keys() {
        // Given an attested supplementary scalar without supported associations.
        let source = json!({
            "literal":"𠀀","codepoint":"20000","groups":[],"nameReadings":[],
            "strokeCounts":[2],"components":null
        });
        // When the Inspector opens its separate canonical source identity.
        let entry = inspect("kanjidic:20000", &|_| Ok(Some(source.clone()))).unwrap();
        // Then absence stays unavailable, not an invented reading or word capability.
        assert_eq!(entry["headword"], "𠀀");
        assert_eq!(entry["capabilities"], json!([]));
        assert_eq!(entry["reading"], Value::Null);
        assert_eq!(entry["summary"], Value::Null);
        assert_eq!(entry["senses"], Value::Null);
    }

    #[test]
    fn character_lookup_rejects_noncanonical_and_cross_source_identity() {
        // Given an authenticated record addressed through a mismatching key.
        let lookup = |_: &str| Ok(Some(source()));
        // When validating requested identities against the actual literal and UCS.
        let results = [
            "jmdict:6a4b",
            "kanjidic:6A4B",
            "kanjidic:06a4b",
            "kanjidic:6a4c",
        ]
        .map(|target| inspect(target, &lookup));
        // Then aliases never bind the character's learner state.
        assert!(results.into_iter().all(|result| result.is_err()));
    }
}
