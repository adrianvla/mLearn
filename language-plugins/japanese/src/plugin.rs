use crate::{JapaneseEngine, Token, DICTIONARY_BYTES};
use mlearn_language_sdk::{
    serde_json::{self, json, Value},
    Call,
};
use serde::Deserialize;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};
#[path = "presentation.rs"]
mod presentation;

thread_local! {
    static ENGINE: RefCell<Option<JapaneseEngine>> = const { RefCell::new(None) };
}
const PACKAGE: &str = "org.mlearn.japanese";
const ATTRIBUTION: &str = concat!(
    "JMdict (2026-10-17), James William Breen / EDRDG, CC-BY-SA-4.0. https://www.edrdg.org/edrdg/licence.html\n",
    "Pitch: Uros Ozvatic / Kanjium, repackaged by toasted-nutbread; CC-BY-SA-4.0. https://github.com/mifunetoshiro/kanjium ; https://creativecommons.org/licenses/by-sa/4.0/\n",
    "JLPT vocabulary list: mLearn reference 1788f9c7. Not an official syllabus."
);

fn initialize() -> Result<(), String> {
    let bytes = mlearn_language_sdk::read_resource(
        "sudachi.dic",
        DICTIONARY_BYTES,
        "34bdc3d279530567399874e62d7f98ea327c536dd7029a3dfdf5c694db1942c7",
    )?;
    let engine =
        JapaneseEngine::from_verified_dictionary_bytes(bytes).map_err(|e| e.to_string())?;
    let metadata = read("metadata")?.ok_or("JMdict metadata missing")?;
    validate_lexicon_metadata(&metadata)?;
    ENGINE.with(|owner| *owner.borrow_mut() = Some(engine));
    Ok(())
}
fn validate_lexicon_metadata(metadata: &Value) -> Result<(), String> {
    if metadata["schema"] != "org.mlearn.japanese.lexicon"
        || metadata["schemaVersion"] != 3
        || metadata["valueCodec"] != "zlib-json-v1"
        || metadata["linguisticSchema"]["id"] != "org.mlearn.japanese.linguistic"
        || metadata["linguisticSchema"]["version"] != 1
    {
        return Err("JMdict data is incompatible with this package".into());
    }
    Ok(())
}
fn capabilities() -> Value {
    json!([
        {"id":format!("{PACKAGE}:written-recognition"),"label":"Written recognition"},
        {"id":format!("{PACKAGE}:meaning"),"label":"Meaning"}
    ])
}
fn read(key: &str) -> Result<Option<Value>, String> {
    mlearn_language_sdk::resource_get("lexicon.sqlite", key)?
        .map(|bytes| {
            if key == "metadata" {
                return serde_json::from_slice(&bytes).map_err(|e| e.to_string());
            }
            decode_record(&bytes)
        })
        .transpose()
}
fn decode_record(bytes: &[u8]) -> Result<Value, String> {
    let decoded = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(bytes, 65536)
        .map_err(|e| format!("Invalid compressed lexical record: {e:?}"))?;
    serde_json::from_slice(&decoded).map_err(|e| e.to_string())
}
fn hiragana(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\u{30a1}'..='\u{30f6}' => char::from_u32(u32::from(c) - 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}
#[derive(Deserialize)]
struct Candidate {
    id: String,
    reading: String,
    pos: Vec<String>,
}

fn compatible(pos: &[String], lexical: &[String]) -> bool {
    let Some(category) = pos.first().map(String::as_str) else {
        return false;
    };
    lexical.iter().any(|p| match category {
        "名詞" => p.contains("noun") || p.contains("numeric") || p.contains("counter"),
        "代名詞" => p.contains("pronoun"),
        "動詞" => p.contains("verb") && !p.contains("auxiliary"),
        "形容詞" => p.contains("adjective") && !p.contains("na-adjective"),
        "形状詞" => p.contains("na-adjective") || p.contains("adjectival nouns"),
        "副詞" => p.contains("adverb"),
        "助詞" => p.contains("particle"),
        "助動詞" => p.contains("auxiliary"),
        "連体詞" => p.contains("pre-noun adjectival"),
        "接続詞" => p.contains("conjunction"),
        "感動詞" => p.contains("interjection"),
        "接頭辞" => p.contains("prefix"),
        "接尾辞" => p.contains("suffix") || p.contains("counter"),
        _ => false,
    })
}
fn candidates(
    token: &Token,
    lookup: &impl Fn(&str) -> Result<Option<Rc<Value>>, String>,
) -> Result<Vec<String>, String> {
    if token.oov {
        return Ok(vec![]);
    }
    let mut targets = BTreeSet::new();
    // Dictionary form and normalized form are alternatives, never identity merges.
    for form in BTreeSet::from([token.lemma.as_str(), token.normalized.as_str()]) {
        if form.len() + 5 > 256 {
            continue;
        }
        if let Some(value) = lookup(&format!("form/{form}"))? {
            let values =
                Vec::<Candidate>::deserialize(value.as_ref()).map_err(|e| e.to_string())?;
            if values.len() > 128 {
                return Err("JMdict candidate set exceeds its bound".into());
            }
            for candidate in values {
                // An inflected surface reading is not a lemma reading. Preserve
                // reading ambiguity there instead of forcing an invented reading.
                let uninflected =
                    token.surface == token.lemma || token.pos.get(4).is_some_and(|p| p == "*");
                let reading_matches =
                    !uninflected || hiragana(&token.reading) == hiragana(&candidate.reading);
                if reading_matches && compatible(&token.pos, &candidate.pos) {
                    targets.insert(candidate.id);
                }
            }
        }
    }
    if targets.len() > 128 {
        return Err("Too many lexical alternatives".into());
    }
    Ok(targets.into_iter().collect())
}

fn project(
    text: &str,
    tokens: Vec<Token>,
    lookup: &impl Fn(&str) -> Result<Option<Rc<Value>>, String>,
) -> Result<Vec<Value>, String> {
    let mut result = Vec::new();
    let mut cursor = 0;
    for token in tokens {
        // Sudachi's one-to-many normalization can emit zero-width expansions.
        // M01 exposes only positive top-level source spans. Do not attach the
        // expansion's lexical identity to unrelated original bytes.
        if token.start == token.end {
            continue;
        }
        if token.start < cursor || text.get(token.start..token.end) != Some(token.surface.as_str())
        {
            return Err("Analyzer returned invalid original source coordinates".into());
        }
        if token.start > cursor {
            result.push(json!({"start":cursor,"end":token.start,"text":&text[cursor..token.start],"targets":[]}));
        }
        let targets = candidates(&token, lookup)?;
        let presentation = presentation::token(&token, &targets, lookup)?;
        let mut value =
            json!({"start":token.start,"end":token.end,"text":token.surface,"targets":targets});
        if let Some(presentation) = presentation {
            value["presentation"] = presentation;
        }
        result.push(value);
        cursor = token.end;
    }
    if cursor < text.len() {
        result.push(json!({"start":cursor,"end":text.len(),"text":&text[cursor..],"targets":[]}));
    }
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryEntry {
    target_id: String,
    headword: String,
    variants: Vec<DictionaryVariant>,
    senses: Vec<DictionarySense>,
}
#[derive(Deserialize)]
struct DictionaryVariant {
    written: String,
    reading: String,
}
#[derive(Deserialize)]
struct DictionarySense {
    pos: Vec<String>,
    forms: Vec<String>,
    readings: Vec<String>,
    glosses: Vec<String>,
}

fn inspect_entry(
    target: &str,
    value: Value,
    lookup: &impl Fn(&str) -> Result<Option<Rc<Value>>, String>,
) -> Result<Value, String> {
    let entry: DictionaryEntry = serde_json::from_value(value).map_err(|e| e.to_string())?;
    if entry.target_id != target
        || entry.senses.is_empty()
        || entry.senses.iter().any(|sense| sense.glosses.is_empty())
    {
        return Err("JMdict entry identity or senses are invalid".into());
    }
    let presentation = presentation::entry(&entry.headword, &entry.variants, lookup)?;
    let readings = entry
        .variants
        .iter()
        .filter(|variant| variant.written == entry.headword)
        .map(|variant| variant.reading.as_str())
        .collect::<BTreeSet<_>>();
    let reading =
        (!readings.is_empty()).then(|| readings.into_iter().collect::<Vec<_>>().join(" / "));
    let summary = entry.senses[0]
        .glosses
        .iter()
        .take(3)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("; ");
    // Preserve the complete target.inspect.v1 field for existing consumers.
    // The short nearby meaning is an additive field, not lost dictionary data.
    let definition = entry
        .senses
        .iter()
        .map(|sense| {
            let restrictions = sense
                .forms
                .iter()
                .chain(&sense.readings)
                .map(String::as_str)
                .collect::<Vec<_>>();
            let glosses = sense.glosses.join("; ");
            if restrictions.is_empty() {
                glosses
            } else {
                format!("[{}] {glosses}", restrictions.join(", "))
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let mut parts = Vec::new();
    let senses = entry
        .senses
        .into_iter()
        .map(|sense| {
            for part in &sense.pos {
                if !parts.contains(part) {
                    parts.push(part.clone());
                }
            }
            // JMdict owns these labels. Keep the full taxonomy while presenting its
            // short English heading; no shared UI knows Japanese POS conventions.
            let heading = sense
                .pos
                .iter()
                .map(|part| {
                    part.split_once(" (")
                        .map_or(part.as_str(), |(label, _)| label)
                })
                .collect::<Vec<_>>()
                .join(", ");
            let mut notes = Vec::new();
            if !sense.forms.is_empty() {
                notes.push(format!("Written forms: {}", sense.forms.join(", ")));
            }
            if !sense.readings.is_empty() {
                notes.push(format!("Readings: {}", sense.readings.join(", ")));
            }
            json!({"heading":heading,"labels":sense.pos,"definitions":sense.glosses,"notes":notes})
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "targetId":entry.target_id,"headword":entry.headword,"reading":reading,"presentation":presentation,
        "partOfSpeech":parts.join("; "),"definition":definition,"summary":summary,"senses":senses,
        "attribution":ATTRIBUTION,"capabilities":capabilities()
    }))
}

fn handle(call: Call) -> Result<Value, String> {
    match call.capability.as_str() {
        "language.describe.v1" => Ok(
            json!({"language":"ja","label":"Japanese","capabilities":capabilities(),"annotationCapability":format!("{PACKAGE}:meaning"),"attribution":ATTRIBUTION}),
        ),
        "text.analyze.v1" => {
            let texts = call
                .input
                .get("texts")
                .and_then(Value::as_array)
                .ok_or("Expected texts batch")?;
            if texts.len() > 16 {
                return Err("Analysis batch exceeds 16 spans".into());
            }
            let mut bytes = 0;
            let mut count = 0;
            let mut batch = Vec::new();
            let cache = RefCell::new(BTreeMap::<String, Option<Rc<Value>>>::new());
            let lookup = |key: &str| {
                if let Some(value) = cache.borrow().get(key) {
                    return Ok(value.clone());
                }
                let value = read(key)?.map(Rc::new);
                if cache.borrow().len() < 128 {
                    cache.borrow_mut().insert(key.into(), value.clone());
                }
                Ok(value)
            };
            ENGINE.with(|owner| {
                let mut owner = owner.borrow_mut();
                let engine = owner.as_mut().ok_or("Japanese engine not initialized")?;
                for value in texts {
                    let text = value.as_str().ok_or("Batch contains non-text input")?;
                    bytes += text.len();
                    if text.len() > 2048 || bytes > 8192 {
                        return Err("Analysis exceeds 2048 bytes per span / 8192 per batch".into());
                    }
                    let tokens = engine.analyze(text).map_err(|e| e.to_string())?;
                    count += tokens.len();
                    if count > 512 {
                        return Err("Analysis batch exceeds 512 morphemes".into());
                    }
                    batch.push(project(text, tokens, &lookup)?);
                }
                Ok(Value::Array(batch.into_iter().map(Value::Array).collect()))
            })
        }
        "target.inspect.v1" => {
            let target = call
                .input
                .get("targetId")
                .and_then(Value::as_str)
                .ok_or("Expected targetId")?;
            let seq = target
                .strip_prefix("jmdict:")
                .filter(|s| !s.is_empty() && s.len() <= 10 && s.bytes().all(|b| b.is_ascii_digit()))
                .ok_or("Unknown Japanese target identity")?;
            let entry = read(&format!("entry/{seq}"))?.ok_or("JMdict entry not found")?;
            inspect_entry(target, entry, &|key| {
                read(key).map(|value| value.map(Rc::new))
            })
        }
        _ => Err("Unsupported Japanese capability".into()),
    }
}
mlearn_language_sdk::export_plugin!(handle, initialize);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_package_metadata_does_not_require_legacy_source_structures() {
        let metadata = json!({
            "schema":"org.mlearn.japanese.lexicon","schemaVersion":3,"valueCodec":"zlib-json-v1",
            "linguisticSchema":{"id":"org.mlearn.japanese.linguistic","version":1}
        });
        assert!(validate_lexicon_metadata(&metadata).is_ok());
        let mut incompatible = metadata.clone();
        incompatible["linguisticSchema"]["version"] = json!(2);
        assert!(validate_lexicon_metadata(&incompatible).is_err());
        let mut incompatible = metadata;
        incompatible["schema"] = json!("other.package.lexicon");
        assert!(validate_lexicon_metadata(&incompatible).is_err());
    }
    #[test]
    fn lexical_codec_round_trips_and_rejects_corruption_or_expansion_overflow() {
        let record = json!({"meaning":["one; complete gloss"],"reading":"ご",
            "org.example:future":{"schemaVersion":7,"data":{"opaque":["unfamiliar",{"relation":"A→B"}]}}});
        let compressed =
            miniz_oxide::deflate::compress_to_vec_zlib(record.to_string().as_bytes(), 9);
        assert_eq!(decode_record(&compressed).unwrap(), record);
        assert!(decode_record(b"not a zlib value").is_err());
        let valid_but_oversized = json!("x".repeat(65536)).to_string();
        let compressed =
            miniz_oxide::deflate::compress_to_vec_zlib(valid_but_oversized.as_bytes(), 9);
        assert!(decode_record(&compressed).is_err());
    }
    #[test]
    fn native_calls_do_not_fake_host_resources() {
        assert!(initialize().is_err());
        assert_eq!(
            handle(Call {
                capability: "language.describe.v1".into(),
                input: Value::Null
            })
            .unwrap()["language"],
            "ja"
        );
    }
    #[test]
    fn dictionary_projection_preserves_gloss_boundaries_and_restrictions() {
        let source = json!({
            "targetId":"jmdict:1","headword":"語","variants":[{"written":"語","reading":"ご"}],
            "senses":[
                {"pos":["noun (common) (futsuumeishi)"],"forms":["語"],"readings":[],
                 "glosses":["a gloss; including punctuation","another gloss"]},
                {"pos":["expression"],"forms":[],"readings":["ご"],
                 "glosses":["a separate sense"]}
            ]
        });
        let entry = inspect_entry("jmdict:1", source.clone(), &|_| Ok(None)).unwrap();
        assert_eq!(
            entry["senses"][0]["definitions"],
            source["senses"][0]["glosses"]
        );
        assert_eq!(
            entry["senses"][1]["definitions"],
            source["senses"][1]["glosses"]
        );
        assert!(
            entry["definition"]
                .as_str()
                .unwrap()
                .contains("a separate sense"),
            "ABI-v1 consumers must still receive the complete definition"
        );
        assert!(!entry["summary"]
            .as_str()
            .unwrap()
            .contains("a separate sense"));
        assert_eq!(entry["senses"][0]["labels"], source["senses"][0]["pos"]);
        assert_eq!(entry["senses"][0]["heading"], "noun");
        assert!(!entry["senses"][0]["notes"].as_array().unwrap().is_empty());
        assert!(!entry["senses"][1]["notes"].as_array().unwrap().is_empty());
        assert!(inspect_entry("jmdict:2", source, &|_| Ok(None)).is_err());
    }
    fn token() -> Token {
        Token {
            start: 0,
            end: 6,
            surface: "生物".into(),
            lemma: "生物".into(),
            normalized: "生物".into(),
            reading: "セイブツ".into(),
            pos: vec!["名詞".into()],
            oov: false,
        }
    }
    #[test]
    fn reading_and_pos_restrict_candidates_without_collapsing_entries() {
        let lookup = |_: &str| {
            Ok(Some(Rc::new(json!([
                {"id":"jmdict:1","reading":"せいぶつ","pos":["noun (common) (futsuumeishi)"]},
                {"id":"jmdict:2","reading":"せいぶつ","pos":["noun (common) (futsuumeishi)"]},
                {"id":"jmdict:3","reading":"なまもの","pos":["noun (common) (futsuumeishi)"]},
                {"id":"jmdict:4","reading":"せいぶつ","pos":["Godan verb"]}
            ]))))
        };
        assert_eq!(
            candidates(&token(), &lookup).unwrap(),
            ["jmdict:1", "jmdict:2"]
        );
        let mut oov = token();
        oov.oov = true;
        assert!(candidates(&oov, &lookup).unwrap().is_empty());
    }
    #[test]
    fn katakana_dictionary_reading_preserves_half_width_source_association() {
        let token = Token {
            start: 0,
            end: 12,
            surface: "ｶﾞｯﾂ".into(),
            lemma: "ガッツ".into(),
            normalized: "ガッツ".into(),
            reading: "ガッツ".into(),
            pos: vec![
                "名詞".into(),
                "普通名詞".into(),
                "一般".into(),
                "*".into(),
                "*".into(),
                "*".into(),
            ],
            oov: false,
        };
        let lookup = |key: &str| {
            if key.starts_with("linguistic/") {
                return Ok(None);
            }
            if key == "entry/1040280" {
                return Ok(None);
            }
            assert_eq!(key, "form/ガッツ");
            Ok(Some(Rc::new(json!([{
                "id":"jmdict:1040280", "reading":"ガッツ",
                "pos":["noun (common) (futsuumeishi)"]
            }]))))
        };
        let result = project("ｶﾞｯﾂ", vec![token], &lookup).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["start"], 0);
        assert_eq!(result[0]["end"], 12);
        assert_eq!(result[0]["text"], "ｶﾞｯﾂ");
        assert_eq!(result[0]["targets"], json!(["jmdict:1040280"]));
        assert_eq!(result[0]["presentation"]["readings"][0]["text"], "がっつ");
    }
    #[test]
    fn zero_width_expansion_has_no_fabricated_source_association() {
        let mut first = token();
        first.surface = "㍿".into();
        first.end = 3;
        let mut expansion = token();
        expansion.surface.clear();
        expansion.start = 3;
        expansion.end = 3;
        let result = project("㍿", vec![first, expansion], &|_| Ok(None)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["text"], "㍿");
        assert_eq!(result[0]["end"], 3);
        assert_eq!(result[0]["targets"], json!([]));
    }
}
