//! Finite task generation and validation for the package-owned past-negative unit.
use super::grammar;
use mlearn_language_sdk::{
    learning::{KnowledgeKey, ReviewDirection, ReviewProbe, ReviewTarget},
    serde_json::{self, Value},
};

use super::PACKAGE;
use mlearn_language_sdk::learning::tasks::{
    ChoiceOption, PackageTask, ResponseSpec, TaskContract, TaskInput, TaskOutput, TaskResponse,
    ValidationInput, ValidationOutcome, ValidationOutput, ValidationResult,
};

#[derive(Clone, Copy)]
enum Task {
    Typed,
    Contrast,
    Recall,
}

impl Task {
    const ALL: [Self; 3] = [Self::Typed, Self::Contrast, Self::Recall];

    const fn suffix(self) -> &'static str {
        match self {
            Self::Typed => "typed",
            Self::Contrast => "contrast",
            Self::Recall => "recall",
        }
    }

    fn id(self) -> String {
        format!("{}/{}", grammar::TARGET, self.suffix())
    }

    fn capability(self) -> String {
        let suffix = match self {
            Self::Typed => "grammar-form",
            Self::Contrast => "grammar-meaning",
            Self::Recall => "grammar-recall",
        };
        format!("{PACKAGE}:{suffix}")
    }

    fn contract(self) -> TaskContract {
        let (response_spec, supplied) = match self {
            Self::Typed => (
                ResponseSpec::TypedText { max_bytes: 2048 },
                "Subject, object, time and base verb are supplied. Only listed cloze forms/contrasts are assessed; other text is unassessed. Trim ASCII space/tab/CR/LF at ends and lowercase ASCII only; preserve internal spaces, punctuation and apostrophes.",
            ),
            Self::Contrast => (
                ResponseSpec::ChoiceId {
                    options: vec![
                        ChoiceOption {
                            id: "negative".into(),
                            label: "Mira did not fold the map yesterday.".into(),
                        },
                        ChoiceOption {
                            id: "positive".into(),
                            label: "Mira folded the map yesterday.".into(),
                        },
                    ],
                },
                "Both complete sentences are supplied; only the declared contrast is tested, not unaided production.",
            ),
            Self::Recall => (
                ResponseSpec::SelfReport,
                "Function and exclusions are supplied. Retrospective self-report only; no validator or objective result.",
            ),
        };
        TaskContract {
            revision: 1,
            response_spec,
            validator_id: match self {
                Self::Typed | Self::Contrast => Some(format!("{}/validator-v1", self.id())),
                Self::Recall => None,
            },
            attribution: grammar::ATTRIBUTION.into(),
            limitations: format!("{} {supplied}", grammar::LIMITATIONS),
        }
    }

    fn package_task(self, key: KnowledgeKey) -> PackageTask {
        let (cue, answer, label) = match self {
            Self::Typed => (
                "Complete the negative past sentence with the missing words only: Mira ___ the map yesterday. (not / fold)",
                "did not fold / didn't fold",
                "Negative past formation",
            ),
            Self::Contrast => (
                "Choose the sentence saying the map-folding did not happen yesterday.",
                "Mira did not fold the map yesterday.",
                "Negative past contrast",
            ),
            Self::Recall => (
                "Recall the construction for negating an ordinary past event, excluding be and modals.",
                "Use did not or didn't followed by the base verb.",
                "Retrospective construction recall",
            ),
        };
        PackageTask {
            probe: ReviewProbe {
                id: self.id(),
                contract_version: 1,
                direction: ReviewDirection::Focused,
                cue: cue.into(),
                answer: answer.into(),
                targets: vec![ReviewTarget {
                    id: "answer".into(),
                    label: label.into(),
                    mnemonic: None,
                    key: Some(key),
                }],
                supplied: vec![],
                required_media: None,
            },
            task: self.contract(),
        }
    }
}

pub(super) fn generate(value: Value) -> Result<Value, String> {
    let input: TaskInput = serde_json::from_value(value).map_err(|error| error.to_string())?;
    input.validate(PACKAGE).map_err(|error| error.to_string())?;
    if input.target_id != grammar::TARGET {
        return Err("Unsupported English grammar target".into());
    }
    if input.eligible_keys.iter().any(|key| {
        !Task::ALL
            .iter()
            .any(|task| task.capability() == key.capability)
    }) {
        return Err("Unsupported English grammar capability".into());
    }
    let tasks = Task::ALL
        .into_iter()
        .filter_map(|task| {
            input
                .eligible_keys
                .iter()
                .find(|key| key.capability == task.capability())
                .map(|key| task.package_task(key.clone()))
        })
        .collect();
    serde_json::to_value(TaskOutput {
        contract_version: 2,
        tasks,
    })
    .map_err(|error| error.to_string())
}

pub(super) fn validate(value: Value) -> Result<Value, String> {
    let input: ValidationInput =
        serde_json::from_value(value).map_err(|error| error.to_string())?;
    input.validate(PACKAGE).map_err(|error| error.to_string())?;
    let task = Task::ALL
        .into_iter()
        .find(|task| task.id() == input.task_id)
        .ok_or("Unknown English grammar task")?;
    let contract = task.contract();
    if input.task_revision != contract.revision
        || contract.validator_id.as_deref() != Some(input.validator_id.as_str())
    {
        return Err("Unknown English grammar task revision or validator".into());
    }
    input
        .response
        .validate(&contract.response_spec)
        .map_err(|error| error.to_string())?;
    let (result, reason) = match (&task, &input.response) {
        (Task::Typed, TaskResponse::TypedText { text }) => {
            // Normalize a separate value: the native capture retains the raw input.
            let normalized = text
                .trim_matches([' ', '\t', '\n', '\r'])
                .to_ascii_lowercase();
            match normalized.as_str() {
                "did not fold" | "didn't fold" => (ValidationResult::Accepted, "finite_match"),
                "did not folded" | "does not fold" => {
                    (ValidationResult::Rejected, "listed_contrast")
                }
                _ => (ValidationResult::Unassessed, "outside_finite_validator"),
            }
        }
        (Task::Contrast, TaskResponse::ChoiceId { id }) => {
            // ResponseSpec has already rejected IDs outside the declared options.
            if id == "negative" {
                (ValidationResult::Accepted, "choice_match")
            } else {
                (ValidationResult::Rejected, "choice_mismatch")
            }
        }
        (Task::Typed, TaskResponse::ChoiceId { .. })
        | (Task::Contrast, TaskResponse::TypedText { .. })
        | (Task::Recall, TaskResponse::TypedText { .. } | TaskResponse::ChoiceId { .. }) => {
            return Err("Unsupported English grammar response kind".into());
        }
    };
    let output = ValidationOutput {
        contract_version: 1,
        task_id: input.task_id.clone(),
        task_revision: input.task_revision,
        validator_id: input.validator_id.clone(),
        outcomes: vec![ValidationOutcome {
            target_id: "answer".into(),
            result,
            reason: reason.into(),
        }],
    };
    output
        .validate(&input, &["answer"])
        .map_err(|error| error.to_string())?;
    serde_json::to_value(output).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
