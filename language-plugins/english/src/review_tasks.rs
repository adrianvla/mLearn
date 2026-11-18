use super::{
    super::{PACKAGE, inspect},
    composition::{Content, compose},
};
use mlearn_language_sdk::{
    learning::{
        KnowledgeKey,
        tasks::{PackageTask, ResponseSpec, TaskContract, TaskInput, TaskOutput},
    },
    serde_json::{self, Value},
};

pub(crate) fn generate(
    value: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let input: TaskInput = serde_json::from_value(value).map_err(|error| error.to_string())?;
    input.validate(PACKAGE).map_err(|error| error.to_string())?;
    let entry = inspect(&input.target_id, lookup)?;
    if input.eligible_keys.iter().any(|key| {
        !entry
            .capabilities
            .iter()
            .any(|capability| capability.id == key.capability)
            || key.capability == format!("{PACKAGE}:listening")
    }) {
        return Err(
            "Unsupported English lexical direction; canonical tasks have no bound audio".into(),
        );
    }
    let mut tasks = Vec::new();
    for mut probe in compose(Content {
        target_id: Some(&entry.target_id),
        phrase: &entry.headword,
        meaning: &entry.definition,
        media: &[],
    }) {
        let answer = probe.answer.to_lowercase();
        let answer_supplied = [
            ("written-recognition", entry.headword.as_str()),
            ("meaning", entry.definition.trim()),
        ]
        .into_iter()
        .filter(|(_, text)| !text.is_empty() && answer.contains(&text.to_lowercase()))
        .map(|(capability, _)| KnowledgeKey {
            package_id: PACKAGE.into(),
            target_id: entry.target_id.clone(),
            capability: format!("{PACKAGE}:{capability}"),
        })
        .collect();
        probe.targets.retain(|row| {
            row.key
                .as_ref()
                .is_some_and(|key| input.eligible_keys.contains(key))
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
            limitations: "Dictionary sense recall, not contextual sense disambiguation. Retrospective self-report only; no objective grading, pronunciation assessment or bound audio. The written cue supplies the headword; the focused cue supplies the definition. Revealing the answer discloses only the listed answer keys.".into(),
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
            "Requested English lexical direction is unavailable without disclosing its answer"
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
