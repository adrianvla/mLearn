use crate::{JapaneseEngine, Token, DICTIONARY_BYTES};
use mlearn_language_sdk::{Call, serde_json::{self, Value, json}};
use serde::Deserialize;
use std::{cell::RefCell, collections::BTreeSet};

thread_local! {
    static ENGINE: RefCell<Option<JapaneseEngine>> = const { RefCell::new(None) };
}
const PACKAGE: &str = "org.mlearn.japanese";
const ATTRIBUTION: &str = "JMdict (2026-10-17), James William Breen / EDRDG, CC-BY-SA-4.0. https://www.edrdg.org/edrdg/licence.html";

fn initialize() -> Result<(), String> {
    let bytes = mlearn_language_sdk::read_resource("sudachi.dic", DICTIONARY_BYTES, "34bdc3d279530567399874e62d7f98ea327c536dd7029a3dfdf5c694db1942c7")?;
    let engine = JapaneseEngine::from_verified_dictionary_bytes(bytes).map_err(|e| e.to_string())?;
    let metadata = read("metadata")?.ok_or("JMdict metadata missing")?;
    if metadata["schemaVersion"] != 1 || metadata["source"]["sha256"] != "eb7cb9c5179c23154f3897eddb0f78f2ef374837fcaef0474cf9875d42161d9b" {
        return Err("JMdict data is incompatible with this package".into());
    }
    ENGINE.with(|owner| *owner.borrow_mut() = Some(engine));
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
        .map(|b| serde_json::from_slice(&b).map_err(|e| e.to_string())).transpose()
}
fn hiragana(text: &str) -> String {
    text.chars().map(|c| match c { '\u{30a1}'..='\u{30f6}' => char::from_u32(u32::from(c) - 0x60).unwrap_or(c), _ => c }).collect()
}
#[derive(Deserialize)]
struct Candidate { id: String, reading: String, pos: Vec<String> }

fn compatible(pos: &[String], lexical: &[String]) -> bool {
    let Some(category) = pos.first().map(String::as_str) else { return false; };
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
fn candidates(token: &Token, lookup: &impl Fn(&str) -> Result<Option<Value>, String>) -> Result<Vec<String>, String> {
    if token.oov { return Ok(vec![]); }
    let mut targets = BTreeSet::new();
    // Dictionary form and normalized form are alternatives, never identity merges.
    for form in BTreeSet::from([token.lemma.as_str(), token.normalized.as_str()]) {
        if form.len() + 5 > 256 { continue; }
        if let Some(value) = lookup(&format!("form/{form}"))? {
            let values: Vec<Candidate> = serde_json::from_value(value).map_err(|e| e.to_string())?;
            if values.len() > 128 { return Err("JMdict candidate set exceeds its bound".into()); }
            for candidate in values {
                // An inflected surface reading is not a lemma reading. Preserve
                // reading ambiguity there instead of forcing an invented reading.
                let uninflected = token.surface == token.lemma || token.pos.get(4).is_some_and(|p| p == "*");
                let reading_matches = !uninflected || hiragana(&token.reading) == hiragana(&candidate.reading);
                if reading_matches && compatible(&token.pos, &candidate.pos) {
                    targets.insert(candidate.id);
                }
            }
        }
    }
    if targets.len() > 128 { return Err("Too many lexical alternatives".into()); }
    Ok(targets.into_iter().collect())
}

fn project(text: &str, tokens: Vec<Token>, lookup: &impl Fn(&str) -> Result<Option<Value>, String>) -> Result<Vec<Value>, String> {
    let mut result = Vec::new();
    let mut cursor = 0;
    for token in tokens {
        // Sudachi's one-to-many normalization can emit zero-width expansions.
        // M01 exposes only positive top-level source spans. Do not attach the
        // expansion's lexical identity to unrelated original bytes.
        if token.start == token.end { continue; }
        if token.start < cursor || text.get(token.start..token.end) != Some(token.surface.as_str()) {
            return Err("Analyzer returned invalid original source coordinates".into());
        }
        if token.start > cursor {
            result.push(json!({"start":cursor,"end":token.start,"text":&text[cursor..token.start],"targets":[]}));
        }
        let targets = candidates(&token, lookup)?;
        result.push(json!({"start":token.start,"end":token.end,"text":token.surface,"targets":targets}));
        cursor = token.end;
    }
    if cursor < text.len() { result.push(json!({"start":cursor,"end":text.len(),"text":&text[cursor..],"targets":[]})); }
    Ok(result)
}
fn handle(call: Call) -> Result<Value, String> {
    match call.capability.as_str() {
        "language.describe.v1" => Ok(json!({"language":"ja","label":"Japanese","capabilities":capabilities(),"annotationCapability":format!("{PACKAGE}:meaning"),"attribution":ATTRIBUTION})),
        "text.analyze.v1" => {
            let texts = call.input.get("texts").and_then(Value::as_array).ok_or("Expected texts batch")?;
            if texts.len() > 16 { return Err("Analysis batch exceeds 16 spans".into()); }
            let mut bytes = 0;
            let mut count = 0;
            let mut batch = Vec::new();
            ENGINE.with(|owner| {
                let mut owner = owner.borrow_mut();
                let engine = owner.as_mut().ok_or("Japanese engine not initialized")?;
                for value in texts {
                    let text = value.as_str().ok_or("Batch contains non-text input")?;
                    bytes += text.len();
                    if text.len() > 2048 || bytes > 8192 { return Err("Analysis exceeds 2048 bytes per span / 8192 per batch".into()); }
                    let tokens = engine.analyze(text).map_err(|e| e.to_string())?;
                    count += tokens.len();
                    if count > 512 { return Err("Analysis batch exceeds 512 morphemes".into()); }
                    batch.push(project(text, tokens, &read)?);
                }
                Ok(json!(batch))
            })
        }
        "target.inspect.v1" => {
            let target = call.input.get("targetId").and_then(Value::as_str).ok_or("Expected targetId")?;
            let seq = target.strip_prefix("jmdict:").filter(|s| !s.is_empty() && s.len() <= 10 && s.bytes().all(|b| b.is_ascii_digit())).ok_or("Unknown Japanese target identity")?;
            let mut entry = read(&format!("entry/{seq}"))?.ok_or("JMdict entry not found")?;
            if entry["targetId"] != target { return Err("JMdict entry identity mismatch".into()); }
            entry["attribution"] = json!(ATTRIBUTION);
            entry["capabilities"] = capabilities();
            Ok(entry)
        }
        _ => Err("Unsupported Japanese capability".into()),
    }
}
mlearn_language_sdk::export_plugin!(handle, initialize);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_calls_do_not_fake_host_resources() {
        assert!(initialize().is_err());
        assert_eq!(handle(Call { capability: "language.describe.v1".into(), input: Value::Null }).unwrap()["language"], "ja");
    }
    fn token() -> Token {
        Token { start: 0, end: 6, surface: "生物".into(), lemma: "生物".into(), normalized: "生物".into(), reading: "セイブツ".into(), pos: vec!["名詞".into()], oov: false }
    }
    #[test]
    fn reading_and_pos_restrict_candidates_without_collapsing_entries() {
        let lookup = |_: &str| Ok(Some(json!([
            {"id":"jmdict:1","reading":"せいぶつ","pos":["noun (common) (futsuumeishi)"]},
            {"id":"jmdict:2","reading":"せいぶつ","pos":["noun (common) (futsuumeishi)"]},
            {"id":"jmdict:3","reading":"なまもの","pos":["noun (common) (futsuumeishi)"]},
            {"id":"jmdict:4","reading":"せいぶつ","pos":["Godan verb"]}
        ])));
        assert_eq!(candidates(&token(), &lookup).unwrap(), ["jmdict:1", "jmdict:2"]);
        let mut oov = token(); oov.oov = true;
        assert!(candidates(&oov, &lookup).unwrap().is_empty());
    }
    #[test]
    fn katakana_dictionary_reading_preserves_half_width_source_association() {
        let token = Token {
            start: 0, end: 12, surface: "ｶﾞｯﾂ".into(), lemma: "ガッツ".into(),
            normalized: "ガッツ".into(), reading: "ガッツ".into(),
            pos: vec!["名詞".into(), "普通名詞".into(), "一般".into(), "*".into(), "*".into(), "*".into()],
            oov: false,
        };
        let lookup = |key: &str| {
            assert_eq!(key, "form/ガッツ");
            Ok(Some(json!([{
                "id":"jmdict:1040280", "reading":"ガッツ",
                "pos":["noun (common) (futsuumeishi)"]
            }])))
        };
        let result = project("ｶﾞｯﾂ", vec![token], &lookup).unwrap();
        assert_eq!(result, vec![json!({
            "start":0, "end":12, "text":"ｶﾞｯﾂ", "targets":["jmdict:1040280"]
        })]);
    }
    #[test]
    fn zero_width_expansion_has_no_fabricated_source_association() {
        let mut first = token(); first.surface = "㍿".into(); first.end = 3;
        let mut expansion = token(); expansion.surface.clear(); expansion.start = 3; expansion.end = 3;
        let result = project("㍿", vec![first, expansion], &|_| Ok(None)).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0]["text"], "㍿");
        assert_eq!(result[0]["end"], 3);
        assert_eq!(result[0]["targets"], json!([]));
    }
}
