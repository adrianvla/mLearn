//! Native-owned Review admission, exposure and retrospective self-report.
use crate::{AuthoredMediaId, KnowledgeKey, MaterialId, SourceAnchor};
use serde::{Deserialize, Serialize};

macro_rules! identity {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
        #[serde(transparent)]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        pub struct $name(pub String);
    };
}
identity!(ReviewSessionId);
identity!(ReviewEncounterId);
identity!(ReviewAttemptId);
identity!(ReviewWorkId);

macro_rules! record {
    ($name:ident { $($(#[$attr:meta])* $field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        pub struct $name { $($(#[$attr])* pub $field: $ty),* }
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum AttemptQuality {
    Missed,
    Struggled,
    Fluent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ResponseMethod {
    Remembered,
    WorkedOut,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ReviewDirection {
    Written,
    Focused,
    Audio,
}

record!(ReviewTarget {
    id: String,
    label: String,
    mnemonic: Option<String>,
    key: Option<KnowledgeKey>
});

record!(ReviewProbe {
    id: String,
    contract_version: u32,
    direction: ReviewDirection,
    cue: String,
    answer: String,
    targets: Vec<ReviewTarget>,
    supplied: Vec<KnowledgeKey>,
    required_media: Option<AuthoredMediaId>
});

// Private resumable content. Never returned as the question projection.
record!(ReviewAdmission {
    work_id: ReviewWorkId,
    material_id: MaterialId,
    material_revision: u32,
    package_id: String,
    package_version: String,
    package_revision: String,
    probe: ReviewProbe,
    source: Option<SourceAnchor>,
    scheduler_version: u32
});

record!(PracticeItem {
    material_id: MaterialId,
    source: Option<SourceAnchor>
});

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ReviewMode {
    Continuous,
    Finite { limit: u32 },
    Practice { items: Vec<PracticeItem> },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ReviewSessionState {
    Active,
    Paused,
    Complete,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ReviewDelivery {
    NotRequired,
    Pending,
    Started,
    Completed,
    Interrupted,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ReviewAssistance {
    Inspector,
    Source,
    PriorDisclosure,
    RepeatedExposure,
}

record!(ReviewConditions {
    revealed: bool,
    exposure_count: u32,
    assistance: Vec<ReviewAssistance>,
    delivery: ReviewDelivery
});

// Answer is absent until Reveal is durably committed, including accessibility.
record!(ReviewEncounter {
    id: ReviewEncounterId,
    work_id: ReviewWorkId,
    material_id: MaterialId,
    material_revision: u32,
    package_id: String,
    package_version: String,
    package_revision: String,
    probe_id: String,
    probe_contract_version: u32,
    direction: ReviewDirection,
    cue: String,
    answer: Option<String>,
    targets: Vec<ReviewTarget>,
    supplied: Vec<KnowledgeKey>,
    required_media: Option<AuthoredMediaId>,
    source: Option<SourceAnchor>,
    conditions: ReviewConditions,
    correction: bool
});

record!(ReviewSession {
    id: ReviewSessionId,
    revision: u32,
    mode: ReviewMode,
    state: ReviewSessionState,
    completed: u32,
    total: Option<u32>,
    encounter: Option<ReviewEncounter>,
    can_undo: bool,
    message: Option<String>
});

record!(ReviewStart {
    command_id: String,
    session_id: ReviewSessionId,
    mode: ReviewMode
});

record!(ReviewMutation {
    command_id: String,
    session_id: ReviewSessionId,
    expected_revision: u32
});

record!(ReviewGrade {
    target_id: String,
    quality: Option<AttemptQuality>,
    method: ResponseMethod,
    easy: bool
});

record!(ReviewResponse {
    encounter_id: ReviewEncounterId,
    grades: Vec<ReviewGrade>
});

/// Command identity covers the complete operation and payload, not just its ID.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ReviewCommand {
    Start {
        start: ReviewStart,
    },
    Next {
        mutation: ReviewMutation,
    },
    Reveal {
        mutation: ReviewMutation,
        #[serde(rename = "encounterId")]
        encounter_id: ReviewEncounterId,
    },
    Delivery {
        mutation: ReviewMutation,
        #[serde(rename = "encounterId")]
        encounter_id: ReviewEncounterId,
        delivery: ReviewDelivery,
    },
    Assistance {
        mutation: ReviewMutation,
        #[serde(rename = "encounterId")]
        encounter_id: ReviewEncounterId,
        assistance: ReviewAssistance,
    },
    Submit {
        mutation: ReviewMutation,
        response: ReviewResponse,
    },
    Undo {
        mutation: ReviewMutation,
    },
    Correct {
        mutation: ReviewMutation,
        response: ReviewResponse,
    },
    Pause {
        mutation: ReviewMutation,
    },
    Resume {
        mutation: ReviewMutation,
    },
}

record!(ReviewCommit {
    command_id: String,
    committed_revision: u32,
    session: ReviewSession
});

record!(ReviewSchedule {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    due_at: i64,
    interval_seconds: u32,
    revision: u32,
    owner_attempt: Option<ReviewAttemptId>
});

record!(ReviewDueMaterial {
    material: crate::Material,
    schedules: Vec<(String, ReviewSchedule)>
});
