use mlearn_language_sdk::serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
pub(super) fn candidates(
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
