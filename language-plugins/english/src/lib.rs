//! English package: UAX #29 spans, WordNet 3.0 exceptions and Morphy suffix rules.
//! Candidates are lexical senses, not a claim of contextual disambiguation.
use mlearn_core::{AnalyzedToken, Capability, LexicalEntry};
use mlearn_language_sdk::{
    Call,
    serde_json::{self, Value, json},
};
use std::collections::{BTreeMap, BTreeSet};
use unicode_segmentation::UnicodeSegmentation;
fn capabilities() -> Vec<Capability> {
    vec![
        Capability {
            id: "org.mlearn.english:written-recognition".into(),
            label: "Written recognition".into(),
        },
        Capability {
            id: "org.mlearn.english:meaning".into(),
            label: "Meaning".into(),
        },
    ]
}
fn read(key: &str) -> Result<Option<Value>, String> {
    mlearn_language_sdk::resource_get("lexicon.sqlite", key)?
        .map(|b| serde_json::from_slice(&b).map_err(|e| e.to_string()))
        .transpose()
}
fn candidates(
    word: &str,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Vec<String>, String> {
    let normalized = word.to_lowercase().replace('’', "'");
    let mut forms: BTreeMap<String, BTreeSet<&str>> = BTreeMap::new();
    forms.insert(
        normalized.clone(),
        BTreeSet::from(["n", "v", "a", "s", "r"]),
    );
    // Morphy substitutions and POS constraints belong exclusively to this package.
    for (pos, tags, rules) in [
        (
            "noun",
            &["n"][..],
            &[
                ("s", ""),
                ("ses", "s"),
                ("xes", "x"),
                ("zes", "z"),
                ("ches", "ch"),
                ("shes", "sh"),
                ("men", "man"),
                ("ies", "y"),
            ][..],
        ),
        (
            "verb",
            &["v"][..],
            &[
                ("s", ""),
                ("ies", "y"),
                ("es", "e"),
                ("es", ""),
                ("ed", "e"),
                ("ed", ""),
                ("ing", "e"),
                ("ing", ""),
            ][..],
        ),
        (
            "adj",
            &["a", "s"][..],
            &[("er", ""), ("est", ""), ("er", "e"), ("est", "e")][..],
        ),
        ("adv", &["r"][..], &[][..]),
    ] {
        let mut bases = BTreeSet::new();
        if let Some(Value::Array(exceptions)) = lookup(&format!("exception/{pos}/{normalized}"))? {
            for value in exceptions {
                if let Some(v) = value.as_str() {
                    bases.insert(v.to_owned());
                }
            }
        }
        for (suffix, ending) in rules {
            if let Some(stem) = normalized.strip_suffix(suffix) {
                if !stem.is_empty() {
                    bases.insert(format!("{stem}{ending}"));
                }
            }
        }
        for base in bases {
            forms.entry(base).or_default().extend(tags.iter().copied());
        }
    }
    let mut targets = BTreeSet::new();
    for (form, tags) in forms {
        if let Some(Value::Array(values)) = lookup(&format!("lemma/{form}"))? {
            for value in values {
                if let Some(id) = value.as_str() {
                    if id.split(':').nth(1).is_some_and(|tag| tags.contains(tag)) {
                        targets.insert(id.to_owned());
                    }
                }
            }
        }
    }
    Ok(targets.into_iter().collect())
}
fn handle(call: Call) -> Result<Value, String> {
    match call.capability.as_str() {
        "language.describe.v1" => Ok(
            json!({"language":"en","label":"English — WordNet 3.0","capabilities":capabilities(),"annotationCapability":"org.mlearn.english:meaning","attribution":"Princeton WordNet 3.0. All senses are alternatives; no contextual sense disambiguation."}),
        ),
        "text.analyze.v1" => {
            let texts = call
                .input
                .get("texts")
                .and_then(Value::as_array)
                .ok_or("Expected texts batch")?;
            if texts.len() > 16 {
                return Err("Analysis batch exceeds 16 text spans".into());
            }
            let mut batch = Vec::new();
            let mut bytes = 0;
            let mut words = 0;
            let mut memo: BTreeMap<String, Vec<String>> = BTreeMap::new();
            for value in texts {
                let text = value.as_str().ok_or("Batch contains non-text input")?;
                bytes += text.len();
                if text.len() > 2048 || bytes > 8192 {
                    return Err("Analysis exceeds 2048 bytes per span / 8192 per batch".into());
                }
                if text.chars().any(char::is_alphabetic)
                    && !text.chars().any(|c| c.is_ascii_alphabetic())
                {
                    return Err("This package analyzes English. This subtitle span has no supported English words; choose a compatible language package.".into());
                }
                let mut tokens = Vec::new();
                let mut end = 0;
                for (start, word) in text.unicode_word_indices() {
                    if start > end {
                        tokens.push(AnalyzedToken {
                            start: end as u32,
                            end: start as u32,
                            text: text[end..start].into(),
                            targets: vec![],
                        });
                    }
                    words += 1;
                    if words > 128 {
                        return Err("Analysis batch exceeds 128 words".into());
                    }
                    let normalized = word.to_lowercase();
                    let targets = if let Some(v) = memo.get(&normalized) {
                        v.clone()
                    } else {
                        let v = candidates(word, &read)?;
                        memo.insert(normalized, v.clone());
                        v
                    };
                    end = start + word.len();
                    tokens.push(AnalyzedToken {
                        start: start as u32,
                        end: end as u32,
                        text: word.into(),
                        targets,
                    });
                }
                if end < text.len() {
                    tokens.push(AnalyzedToken {
                        start: end as u32,
                        end: text.len() as u32,
                        text: text[end..].into(),
                        targets: vec![],
                    });
                }
                batch.push(tokens);
            }
            Ok(json!(batch))
        }
        "target.inspect.v1" => {
            let id = call
                .input
                .get("targetId")
                .and_then(Value::as_str)
                .ok_or("Expected targetId")?;
            let parts: Vec<_> = id.splitn(4, ':').collect();
            if parts.len() != 4 || parts[0] != "wn30" {
                return Err("Unknown English target identity".into());
            }
            let known = read(&format!("lemma/{}", parts[3].to_lowercase()))?
                .ok_or("Target lemma missing")?;
            if !known
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(id)))
            {
                return Err("Target is not a declared lexical sense".into());
            }
            let sense =
                read(&format!("sense/{}:{}", parts[1], parts[2]))?.ok_or("Sense missing")?;
            Ok(json!(LexicalEntry {
                target_id: id.into(),
                headword: parts[3].replace('_', " "),
                reading: None,
                part_of_speech: sense["pos"].as_str().ok_or("Invalid sense")?.into(),
                definition: sense["definition"]
                    .as_str()
                    .ok_or("Invalid definition")?
                    .into(),
                attribution: "Princeton WordNet 3.0".into(),
                capabilities: capabilities()
            }))
        }
        _ => Err("Unsupported English capability".into()),
    }
}
mlearn_language_sdk::export_plugin!(handle);
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsupported_script_is_not_reported_as_empty_english_analysis() {
        let result = handle(Call {
            capability: "text.analyze.v1".into(),
            input: json!({"texts":["日本語"]}),
        });
        assert!(result.unwrap_err().contains("English"));
    }
    #[test]
    fn unicode_spans_and_irregular_forms_resolve_without_claiming_a_sense() {
        let lookup = |k: &str| -> Result<Option<Value>, String> {
            Ok(match k {
                "exception/noun/children" => Some(json!(["child"])),
                "lemma/child" => Some(json!(["wn30:n:0001:child", "wn30:n:0002:child"])),
                "lemma/walk" => Some(json!(["wn30:v:0003:walk", "wn30:n:0004:walk"])),
                _ => None,
            })
        };
        assert_eq!(candidates("CHILDREN", &lookup).unwrap().len(), 2);
        assert_eq!(
            candidates("walked", &lookup).unwrap(),
            vec!["wn30:v:0003:walk"]
        );
        let text = "👩🏽‍💻 café children";
        for (offset, word) in text.unicode_word_indices() {
            assert_eq!(&text[offset..offset + word.len()], word);
        }
    }
}
