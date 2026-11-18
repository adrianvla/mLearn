use super::{
    super::{characters, hiragana, inspect_entry, PACKAGE},
    composition::{compose, Content},
};
use mlearn_core::LexicalEntry;
use mlearn_language_sdk::{
    learning::{
        tasks::{PackageTask, ResponseSpec, TaskContract, TaskInput, TaskOutput},
        KnowledgeKey,
    },
    serde_json::{self, Value},
};
use std::rc::Rc;

pub(crate) fn generate(
    value: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let input: TaskInput = serde_json::from_value(value).map_err(|error| error.to_string())?;
    input.validate(PACKAGE).map_err(|error| error.to_string())?;
    let value = if input.target_id.starts_with("kanjidic:") {
        characters::inspect(&input.target_id, lookup)?
    } else {
        let sequence = input
            .target_id
            .strip_prefix("jmdict:")
            .filter(|seq| {
                !seq.is_empty() && seq.len() <= 10 && seq.bytes().all(|byte| byte.is_ascii_digit())
            })
            .ok_or("Unknown Japanese target identity")?;
        inspect_entry(
            &input.target_id,
            lookup(&format!("entry/{sequence}"))?.ok_or("JMdict entry not found")?,
            &|key| lookup(key).map(|value| value.map(Rc::new)),
        )?
        .0
    };
    let entry: LexicalEntry = serde_json::from_value(value).map_err(|error| error.to_string())?;
    if input.eligible_keys.iter().any(|key| {
        !entry
            .capabilities
            .iter()
            .any(|capability| capability.id == key.capability)
            || key.capability == format!("{PACKAGE}:listening")
    }) {
        return Err(
            "Unsupported Japanese lexical direction; canonical tasks have no bound audio".into(),
        );
    }
    let mut tasks = Vec::new();
    let mut tested = std::collections::BTreeSet::new();
    for mut probe in compose(Content {
        target_id: Some(&entry.target_id),
        phrase: &entry.headword,
        reading: entry.reading.as_deref().unwrap_or(""),
        meaning: &entry.definition,
        media: &[],
        capabilities: Some(&entry.capabilities),
    }) {
        // Record the entire revealed answer before narrowing the tested rows.
        let answer_supplied = [
            (
                "written-recognition",
                !entry.headword.is_empty() && probe.answer.contains(&entry.headword),
            ),
            (
                "reading",
                entry.reading.as_ref().is_some_and(|reading| {
                    reading.split(" / ").any(|value| {
                        !value.trim().is_empty()
                            && hiragana(&probe.answer).contains(&hiragana(value))
                    })
                }),
            ),
            (
                "meaning",
                !entry.definition.trim().is_empty()
                    && probe.answer.contains(entry.definition.trim()),
            ),
        ]
        .into_iter()
        .filter(|(capability, present)| {
            *present
                && entry
                    .capabilities
                    .iter()
                    .any(|value| value.id == format!("{PACKAGE}:{capability}"))
        })
        .map(|(capability, _)| KnowledgeKey {
            package_id: PACKAGE.into(),
            target_id: entry.target_id.clone(),
            capability: format!("{PACKAGE}:{capability}"),
        })
        .collect();
        // Choose one suitable cue per admitted key without hiding answer disclosures.
        probe.targets.retain(|row| {
            row.key.as_ref().is_some_and(|key| {
                input.eligible_keys.contains(key) && tested.insert(key.capability.clone())
            })
        });
        if probe.targets.is_empty() {
            continue;
        }
        let task = TaskContract {
            revision: 1,
            response_spec: ResponseSpec::SelfReport,
            validator_id: None,
            answer_supplied,
            attribution: entry.attribution.clone(),
            limitations: "Dictionary associations, not contextual sense or reading disambiguation; alternative readings and restricted senses remain as published by inspection. Retrospective self-report only; no objective grading, handwriting, pronunciation assessment or bound audio. Written cues disclose the headword and any visible reading; focused cues disclose the definition. Answer disclosure includes untested associations shown on reveal.".into(),
        };
        task.validate().map_err(|error| error.to_string())?;
        tasks.push(PackageTask { probe, task });
    }
    if input.eligible_keys.iter().any(|key| {
        !tasks.iter().any(|task| {
            task.probe
                .targets
                .iter()
                .any(|row| row.key.as_ref() == Some(key))
        })
    }) {
        return Err(
            "Requested Japanese lexical direction is unavailable without disclosing its answer"
                .into(),
        );
    }
    serde_json::to_value(TaskOutput {
        contract_version: 2,
        tasks,
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "review_task_tests.rs"]
mod tests;
