//! Package task and executed-validation wire contracts; no linguistic grading in core.
use super::{KnowledgeKey, ReviewProbe};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fmt};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskError {
    Contract,
    Identity,
    Response,
    Outcomes,
}

impl fmt::Display for TaskError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Contract => "Unsupported or invalid learning task contract",
            Self::Identity => "Learning task identity does not match its package or scope",
            Self::Response => "Response does not match the admitted learning task",
            Self::Outcomes => "Validation outcomes do not match the admitted target rows",
        })
    }
}

impl std::error::Error for TaskError {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChoiceOption {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResponseSpec {
    SelfReport,
    TypedText {
        #[serde(rename = "maxBytes")]
        max_bytes: u32,
    },
    ChoiceId {
        options: Vec<ChoiceOption>,
    },
}

impl ResponseSpec {
    /// Check the bounded response shape without deciding linguistic correctness.
    ///
    /// # Errors
    /// Returns [`TaskError::Contract`] for an unusable response specification.
    pub fn validate(&self) -> Result<(), TaskError> {
        let valid = match self {
            Self::SelfReport => true,
            Self::TypedText { max_bytes } => (1..=2048).contains(max_bytes),
            Self::ChoiceId { options } => {
                let mut ids = BTreeSet::new();
                (2..=8).contains(&options.len())
                    && options.iter().all(|option| {
                        bounded(&option.id, 256)
                            && bounded(&option.label, 2048)
                            && ids.insert(&option.id)
                    })
            }
        };
        valid.then_some(()).ok_or(TaskError::Contract)
    }
}

/// Raw learner input. Normalization and correctness belong to the selected package.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TaskResponse {
    TypedText { text: String },
    ChoiceId { id: String },
}

impl TaskResponse {
    /// Accept only input supported by the immutable admitted response specification.
    ///
    /// # Errors
    /// Returns an error for malformed specifications, mismatched kinds or out-of-bound input.
    pub fn validate(&self, specification: &ResponseSpec) -> Result<(), TaskError> {
        specification.validate()?;
        let valid = match (self, specification) {
            (Self::TypedText { text }, ResponseSpec::TypedText { max_bytes }) => {
                u32::try_from(text.len()).is_ok_and(|bytes| bytes <= *max_bytes)
            }
            (Self::ChoiceId { id }, ResponseSpec::ChoiceId { options }) => {
                options.iter().any(|option| option.id == *id)
            }
            (Self::TypedText { .. }, ResponseSpec::SelfReport | ResponseSpec::ChoiceId { .. })
            | (Self::ChoiceId { .. }, ResponseSpec::SelfReport | ResponseSpec::TypedText { .. }) => {
                false
            }
        };
        valid.then_some(()).ok_or(TaskError::Response)
    }
}

/// Answer-bearing rules remain private to the package, not in this descriptor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskContract {
    pub revision: u32,
    pub response_spec: ResponseSpec,
    pub validator_id: Option<String>,
    pub attribution: String,
    pub limitations: String,
}

impl TaskContract {
    /// Require executed validators for typed/choice work, never for retrospective recall.
    ///
    /// # Errors
    /// Returns [`TaskError::Contract`] for a missing, misleading or unbounded descriptor.
    pub fn validate(&self) -> Result<(), TaskError> {
        self.response_spec.validate()?;
        let validator_matches = match &self.response_spec {
            ResponseSpec::SelfReport => self.validator_id.is_none(),
            ResponseSpec::TypedText { .. } | ResponseSpec::ChoiceId { .. } => self
                .validator_id
                .as_ref()
                .is_some_and(|id| bounded(id, 256)),
        };
        (self.revision > 0
            && validator_matches
            && bounded(&self.attribution, 4096)
            && bounded(&self.limitations, 4096))
        .then_some(())
        .ok_or(TaskError::Contract)
    }
}

/// V2 retains the existing cue/target contract rather than creating another probe model.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageTask {
    pub probe: ReviewProbe,
    pub task: TaskContract,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskInput {
    pub contract_version: u32,
    pub package_id: String,
    pub package_revision: String,
    pub target_id: String,
    pub eligible_keys: Vec<KnowledgeKey>,
}

impl TaskInput {
    /// Scope a package-owned target without manufacturing an authored Material.
    ///
    /// # Errors
    /// Returns an error for unsupported contracts, foreign identity or widened/duplicate scope.
    pub fn validate(&self, package: &str) -> Result<(), TaskError> {
        if self.contract_version != 2 {
            return Err(TaskError::Contract);
        }
        let mut keys = BTreeSet::new();
        (self.package_id == package
            && bounded(&self.package_id, 512)
            && bounded(&self.package_revision, 512)
            && bounded(&self.target_id, 512)
            && (1..=32).contains(&self.eligible_keys.len())
            && self.eligible_keys.iter().all(|key| {
                key.package_id == self.package_id
                    && key.target_id == self.target_id
                    && bounded(&key.capability, 512)
                    && keys.insert(&key.capability)
            }))
        .then_some(())
        .ok_or(TaskError::Identity)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskOutput {
    pub contract_version: u32,
    pub tasks: Vec<PackageTask>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidationInput {
    pub contract_version: u32,
    pub package_id: String,
    pub package_revision: String,
    pub task_id: String,
    pub task_revision: u32,
    pub validator_id: String,
    pub response: TaskResponse,
}

impl ValidationInput {
    /// Check the invocation envelope; the package still resolves the actual task and validator.
    ///
    /// # Errors
    /// Returns an error for unsupported contracts, invalid identity or excessive response input.
    pub fn validate(&self, package: &str) -> Result<(), TaskError> {
        if self.contract_version != 1 {
            return Err(TaskError::Contract);
        }
        if self.package_id != package
            || !bounded(&self.package_id, 512)
            || !bounded(&self.package_revision, 512)
            || !bounded(&self.task_id, 256)
            || self.task_revision == 0
            || !bounded(&self.validator_id, 256)
        {
            return Err(TaskError::Identity);
        }
        let valid = match &self.response {
            TaskResponse::TypedText { text } => text.len() <= 2048,
            TaskResponse::ChoiceId { id } => bounded(id, 256),
        };
        valid.then_some(()).ok_or(TaskError::Response)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationResult {
    Accepted,
    Rejected,
    Unassessed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidationOutcome {
    /// The admitted probe row ID, not an independently supplied Knowledge identity.
    pub target_id: String,
    pub result: ValidationResult,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidationOutput {
    pub contract_version: u32,
    pub task_id: String,
    pub task_revision: u32,
    pub validator_id: String,
    pub outcomes: Vec<ValidationOutcome>,
}

impl ValidationOutput {
    /// Bind actual validator output to exactly the admitted tested rows.
    ///
    /// # Errors
    /// Returns an error for mismatched identity, missing/duplicate/extra rows or oversized reasons.
    pub fn validate(&self, input: &ValidationInput, tested_rows: &[&str]) -> Result<(), TaskError> {
        if self.contract_version != 1
            || self.task_id != input.task_id
            || self.task_revision != input.task_revision
            || self.validator_id != input.validator_id
        {
            return Err(TaskError::Identity);
        }
        let mut rows = BTreeSet::new();
        ((1..=32).contains(&tested_rows.len())
            && self.outcomes.len() == tested_rows.len()
            && self.outcomes.iter().all(|outcome| {
                bounded(&outcome.target_id, 256)
                    && bounded(&outcome.reason, 256)
                    && tested_rows.contains(&outcome.target_id.as_str())
                    && rows.insert(outcome.target_id.as_str())
            }))
        .then_some(())
        .ok_or(TaskError::Outcomes)
    }
}

fn bounded(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.len() <= maximum
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scope_input_rejects_foreign_and_duplicate_capabilities() {
        // Given exact keys for one authenticated package target.
        let value = json!({"contractVersion":2,"packageId":"pkg","packageRevision":"r1",
            "targetId":"grammar:one","eligibleKeys":[
                {"packageId":"pkg","targetId":"grammar:one","capability":"pkg:form"}]});
        let mut cases = vec![(value.clone(), true)];
        let mut foreign = value.clone();
        foreign["eligibleKeys"][0]["targetId"] = json!("grammar:other");
        cases.push((foreign, false));
        let mut duplicate = value;
        duplicate["eligibleKeys"]
            .as_array_mut()
            .unwrap()
            .push(json!({"packageId":"pkg","targetId":"grammar:one","capability":"pkg:form"}));
        cases.push((duplicate, false));
        // When accepting each scope at the package boundary.
        let accepted: Vec<_> = cases
            .iter()
            .map(|(value, _)| {
                serde_json::from_value::<TaskInput>(value.clone())
                    .unwrap()
                    .validate("pkg")
                    .is_ok()
            })
            .collect();
        // Then target membership cannot broaden or duplicate a capability.
        assert_eq!(accepted, vec![true, false, false]);
    }

    #[test]
    fn responses_preserve_raw_utf8_and_enforce_the_admitted_shape() {
        // Given raw input at the byte limit and a two-option task.
        let raw = format!("{}\u{e9}", " \u{e9}".repeat(682));
        let response = TaskResponse::TypedText { text: raw.clone() };
        let choices = ResponseSpec::ChoiceId {
            options: vec![
                ChoiceOption {
                    id: "a".into(),
                    label: "First".into(),
                },
                ChoiceOption {
                    id: "b".into(),
                    label: "Second".into(),
                },
            ],
        };
        // When parsing and checking actual learner input.
        let restored: TaskResponse =
            serde_json::from_value(serde_json::to_value(&response).unwrap()).unwrap();
        let valid = restored.validate(&ResponseSpec::TypedText { max_bytes: 2048 });
        let wrong_kind = restored.validate(&choices);
        let unknown_choice = TaskResponse::ChoiceId { id: "other".into() }.validate(&choices);
        let oversized = TaskResponse::TypedText {
            text: format!("{raw}x"),
        }
        .validate(&ResponseSpec::TypedText { max_bytes: 2048 });
        // Then no normalization or unsupported answer can cross the boundary.
        assert_eq!(restored, TaskResponse::TypedText { text: raw });
        assert!(valid.is_ok());
        assert_eq!(wrong_kind, Err(TaskError::Response));
        assert_eq!(unknown_choice, Err(TaskError::Response));
        assert_eq!(oversized, Err(TaskError::Response));
        assert!(
            serde_json::from_value::<TaskResponse>(json!({
                "kind":"typed_text","text":"answer","accepted":true
            }))
            .is_err()
        );
    }

    #[test]
    fn self_report_cannot_claim_an_executed_validator() {
        // Given a retrospective task carrying a forged validator identity.
        let task = TaskContract {
            revision: 1,
            response_spec: ResponseSpec::SelfReport,
            validator_id: Some("validator".into()),
            attribution: "Original package content".into(),
            limitations: "Retrospective self-report only".into(),
        };
        // When validating its declared measurement method.
        let result = task.validate();
        // Then it cannot be admitted as validated recall.
        assert_eq!(result, Err(TaskError::Contract));
    }

    #[test]
    fn validator_output_cannot_replace_or_omit_admitted_rows() {
        // Given an invocation and its two actual tested row identities.
        let input: ValidationInput = serde_json::from_value(json!({
            "contractVersion":1,"packageId":"pkg","packageRevision":"r1",
            "taskId":"task","taskRevision":1,"validatorId":"validator",
            "response":{"kind":"typed_text","text":"answer"}
        }))
        .unwrap();
        let output = |rows: &[&str]| ValidationOutput {
            contract_version: 1,
            task_id: "task".into(),
            task_revision: 1,
            validator_id: "validator".into(),
            outcomes: rows
                .iter()
                .map(|id| ValidationOutcome {
                    target_id: (*id).into(),
                    result: ValidationResult::Unassessed,
                    reason: "outside_finite_validator".into(),
                })
                .collect(),
        };
        // When matching output against admitted rows rather than renderer identities.
        let accepted: Vec<_> = [
            output(&["one", "two"]),
            output(&["one"]),
            output(&["one", "one"]),
            output(&["one", "foreign"]),
        ]
        .iter()
        .map(|value| value.validate(&input, &["one", "two"]).is_ok())
        .collect();
        // Then exactly one outcome per declared row is required.
        assert_eq!(accepted, vec![true, false, false, false]);
    }
}
