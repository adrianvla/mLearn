use super::{hiragana, DictionaryEntry, DictionaryVariant, PACKAGE};
use crate::Token;
use mlearn_language_sdk::serde_json::{self, json, Value};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const READING_SOURCE: &str = "SudachiDict Small 20260116; Apache-2.0";
const PITCH_SOURCE: &str = "Uros Ozvatic / Kanjium; CC-BY-SA-4.0";
const LEVEL_SOURCE: &str = "Reference JLPT vocabulary list, 1788f9c7; not an official syllabus";

// Package-owned linguistic.v1 records. Compact wire keys are defined here,
// independently of the source-bank structures understood only by conversion.
#[derive(Deserialize, Serialize)]
struct Accent {
    #[serde(rename = "drop")]
    drop_after_mora: u32,
    #[serde(rename = "pos")]
    part_of_speech: Vec<String>,
}
#[derive(Deserialize, Serialize)]
struct Supplemental {
    #[serde(rename = "accent")]
    pronunciations: Vec<Accent>,
    #[serde(rename = "jlpt")]
    vocabulary_levels: Vec<u32>,
}
fn key(written: &str, reading: &str) -> String {
    format!(
        "linguistic/{}:{written}{}",
        written.len(),
        hiragana(reading)
    )
}

fn morae(reading: &str) -> Vec<String> {
    let mut units: Vec<String> = Vec::new();
    for character in reading.chars() {
        // Small vowels/glides and combining voicing marks extend a mora; small
        // tsu, syllabic n and the long-vowel mark each retain their own timing.
        if matches!(
            character,
            'ぁ' | 'ぃ' | 'ぅ' | 'ぇ' | 'ぉ' | 'ゃ' | 'ゅ' | 'ょ' | 'ゎ' | '\u{3099}' | '\u{309a}'
        ) && !units.is_empty()
        {
            if let Some(last) = units.last_mut() {
                last.push(character);
            }
        } else {
            units.push(character.to_string());
        }
    }
    units
}

fn contour(written: &str, reading: &str, accent: &Accent) -> Option<Value> {
    let units = morae(reading);
    if units.is_empty() || units.len() > 64 || accent.drop_after_mora as usize > units.len() {
        return None;
    }
    let (category, color) = match accent.drop_after_mora {
        0 => ("Heiban", "#00b84a"),
        1 => ("Atamadaka", "#ffa500"),
        position if position as usize == units.len() => ("Odaka", "#ff0000"),
        _ => ("Nakadaka", "#00aaff"),
    };
    let points = units
        .into_iter()
        .enumerate()
        .map(|(index, text)| {
            let high = match accent.drop_after_mora {
                0 => index > 0,
                1 => index == 0,
                position => index > 0 && index < position as usize,
            };
            json!({"text":text,"height":if high {1.0} else {0.0}})
        })
        .collect::<Vec<_>>();
    let identity = format!(
        "{written}\0{reading}\0{}\0{}",
        accent.drop_after_mora,
        accent.part_of_speech.join(",")
    );
    Some(json!({
        "id":format!("{PACKAGE}:pitch:{:x}",Sha256::digest(identity)),
        "reading":reading,"units":points,"followingHeight":if accent.drop_after_mora==0 {1.0} else {0.0},
        "label":format!("{category} [{}]{}",accent.drop_after_mora,
            if accent.part_of_speech.is_empty(){String::new()}else{format!(" · {}",accent.part_of_speech.join(", "))}),
        "color":color,"attribution":PITCH_SOURCE,
    }))
}

fn build(
    written: &str,
    readings: BTreeSet<String>,
    ruby: Option<(&str, &str)>,
    tag: Option<&str>,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let mut contours = BTreeMap::new();
    let mut levels = BTreeSet::new();
    for reading in readings {
        let Some(value) = lookup(&key(written, &reading))? else {
            continue;
        };
        let supplemental: Supplemental =
            serde_json::from_value(value).map_err(|e| e.to_string())?;
        levels.extend(supplemental.vocabulary_levels);
        for accent in supplemental.pronunciations {
            if tag.is_some_and(|tag| {
                !accent.part_of_speech.is_empty()
                    && !accent.part_of_speech.iter().any(|value| value == tag)
            }) {
                continue;
            }
            if let Some(value) = contour(written, &reading, &accent) {
                contours.insert(
                    (
                        reading.clone(),
                        accent.drop_after_mora,
                        accent.part_of_speech.clone(),
                    ),
                    value,
                );
            }
        }
    }
    let labels = levels.into_iter().map(|level| {
        if !(1..=5).contains(&level) { return Err("Invalid vocabulary level".into()); }
        Ok(json!({"id":format!("{PACKAGE}:jlpt-vocabulary:N{level}"),"label":format!("JLPT N{level}"),
            "color":null,"attribution":LEVEL_SOURCE}))
    }).collect::<Result<Vec<_>, String>>()?;
    let readings = ruby
        .map(|(text, attribution)| {
            vec![json!({
                "start":0,"end":written.len(),"text":text,"attribution":attribution
            })]
        })
        .unwrap_or_default();
    Ok(
        json!({"readings":readings,"labels":labels,"contours":contours.into_values().collect::<Vec<_>>()}),
    )
}

pub(super) fn token(
    token: &Token,
    targets: &[String],
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let reading = hiragana(&token.reading);
    let ruby = (!token.oov
        && !reading.is_empty()
        && reading != "*"
        && reading != hiragana(&token.surface))
    .then_some((reading.as_str(), READING_SOURCE));
    let category = token.pos.first().map(String::as_str).unwrap_or("");
    let standalone = !token.oov
        && (token.surface == token.lemma || token.pos.get(4).is_some_and(|part| part == "*"))
        && !matches!(category, "助詞" | "助動詞" | "補助記号" | "記号");
    // Never lend a lemma's accent to an inflected surface or a coincidentally
    // spelled auxiliary. Surface ruby still comes from actual morphological work.
    let readings = if standalone {
        BTreeSet::from([reading.clone()])
    } else {
        BTreeSet::new()
    };
    let tag = match category {
        "名詞" => Some("n"),
        "代名詞" => Some("pn"),
        "副詞" => Some("adv"),
        "形状詞" => Some("adj-na"),
        "感動詞" => Some("int"),
        _ => Some(""),
    };
    let lookup_surface = |requested: &str| {
        let value = lookup(requested)?;
        // A non-inflecting kana spelling can name the same dictionary form
        // (つまり / 詰まり). Join its actual morphological reading, not a lemma's
        // different pronunciation, and never apply this to inflected surfaces.
        if value.is_some() || !standalone {
            return Ok(value);
        }
        let mut forms = BTreeSet::new();
        if token.surface != token.lemma {
            forms.insert(token.lemma.clone());
        }
        // Sudachi can retain kana even when JMdict has an equivalent written
        // form. Only admitted lexical alternatives and their restricted pairs
        // establish that join; matching a reading alone across words does not.
        for target in targets {
            let Some(seq) = target.strip_prefix("jmdict:") else {
                continue;
            };
            let Some(value) = lookup(&format!("entry/{seq}"))? else {
                continue;
            };
            let entry: DictionaryEntry =
                serde_json::from_value(value).map_err(|e| e.to_string())?;
            forms.extend(
                entry
                    .variants
                    .into_iter()
                    .filter(|variant| {
                        hiragana(&variant.reading) == reading && variant.written != token.surface
                    })
                    .map(|variant| variant.written),
            );
        }
        let mut pronunciations = Vec::new();
        let mut levels = BTreeSet::new();
        for form in forms {
            let Some(value) = lookup(&key(&form, &reading))? else {
                continue;
            };
            let supplemental: Supplemental =
                serde_json::from_value(value).map_err(|e| e.to_string())?;
            levels.extend(supplemental.vocabulary_levels);
            pronunciations.extend(supplemental.pronunciations);
        }
        if pronunciations.is_empty() && levels.is_empty() {
            return Ok(None);
        }
        serde_json::to_value(Supplemental {
            pronunciations,
            vocabulary_levels: levels.into_iter().collect(),
        })
        .map(Some)
        .map_err(|e| e.to_string())
    };
    build(&token.surface, readings, ruby, tag, &lookup_surface)
}

pub(super) fn entry(
    written: &str,
    variants: &[DictionaryVariant],
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let readings = variants
        .iter()
        .filter(|variant| variant.written == written)
        .map(|variant| hiragana(&variant.reading))
        .collect::<BTreeSet<_>>();
    // A dictionary entry can have multiple legitimate readings. Do not pretend
    // that its first alternative is a contextually selected pronunciation.
    let ruby = (readings.len() == 1)
        .then(|| readings.first().map(String::as_str))
        .flatten()
        .filter(|reading| *reading != hiragana(written));
    build(
        written,
        readings.clone(),
        ruby.map(|reading| (reading, "JMdict / EDRDG; CC-BY-SA-4.0")),
        None,
        lookup,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contours_preserve_morae_variants_and_following_context() {
        assert_eq!(morae("きょう"), ["きょ", "う"]);
        assert_eq!(morae("がっこう"), ["が", "っ", "こ", "う"]);
        let flat = contour(
            "今日",
            "きょう",
            &Accent {
                drop_after_mora: 0,
                part_of_speech: vec![],
            },
        )
        .unwrap();
        let tail = contour(
            "今日",
            "きょう",
            &Accent {
                drop_after_mora: 2,
                part_of_speech: vec![],
            },
        )
        .unwrap();
        assert_eq!(flat["units"], tail["units"]);
        assert_ne!(flat["followingHeight"], tail["followingHeight"]);
        let value = build(
            "今日",
            BTreeSet::from(["きょう".into()]),
            None,
            None,
            &|_| {
                Ok(Some(json!({
                    "accent":[{"drop":0,"pos":[]},{"drop":1,"pos":[]}],"jlpt":[3]
                })))
            },
        )
        .unwrap();
        assert_eq!(value["contours"].as_array().unwrap().len(), 2);
        assert_eq!(value["labels"][0]["label"], "JLPT N3");
    }
    #[test]
    fn inflected_surface_ruby_does_not_borrow_lemma_accent() {
        let token = Token {
            start: 0,
            end: 6,
            surface: "食べ".into(),
            lemma: "食べる".into(),
            normalized: "食べる".into(),
            reading: "タベ".into(),
            pos: vec![
                "動詞".into(),
                "一般".into(),
                "*".into(),
                "*".into(),
                "下一段".into(),
            ],
            oov: false,
        };
        let value = super::token(&token, &[], &|_| {
            panic!("Inflection must not request a lemma's pitch")
        })
        .unwrap();
        assert_eq!(value["readings"][0]["text"], "たべ");
        assert_eq!(value["readings"][0]["end"], 6);
        assert_eq!(value["contours"], json!([]));
    }
    #[test]
    fn restricted_written_readings_never_inherit_each_others_metadata() {
        let variants = vec![
            DictionaryVariant {
                written: "生物".into(),
                reading: "せいぶつ".into(),
            },
            DictionaryVariant {
                written: "生き物".into(),
                reading: "いきもの".into(),
            },
        ];
        let value = entry("生物", &variants, &|requested| {
            assert_eq!(requested, key("生物", "せいぶつ"));
            Ok(None)
        })
        .unwrap();
        assert_eq!(value["readings"][0]["text"], "せいぶつ");
        assert_eq!(value["contours"], json!([]));
    }
    #[test]
    fn noninflecting_kana_alias_uses_its_verified_dictionary_form_and_reading() {
        let token = Token {
            start: 0,
            end: 9,
            surface: "つまり".into(),
            lemma: "つまり".into(),
            normalized: "詰まり".into(),
            reading: "ツマリ".into(),
            pos: vec![
                "副詞".into(),
                "*".into(),
                "*".into(),
                "*".into(),
                "*".into(),
            ],
            oov: false,
        };
        let value = super::token(&token, &["jmdict:1".into()], &|requested| {
            if requested == key("つまり", "つまり") {
                return Ok(None);
            }
            if requested == "entry/1" {
                return Ok(Some(json!({"targetId":"jmdict:1","headword":"詰まり","senses":[],
                    "variants":[{"written":"詰まり","reading":"つまり"},{"written":"別語","reading":"べつご"}]})));
            }
            assert_eq!(requested, key("詰まり", "つまり"));
            Ok(Some(json!({
                "accent":[{"drop":1,"pos":["adv"]},{"drop":3,"pos":["n"]}],
                "jlpt":[3]
            })))
        })
        .unwrap();
        assert_eq!(value["labels"][0]["label"], "JLPT N3");
        assert_eq!(value["readings"], json!([]));
        assert_eq!(value["contours"].as_array().unwrap().len(), 1);
        assert_eq!(value["contours"][0]["reading"], "つまり");
    }
}
