//! Bounded conversation content. Network, credentials, source validation and
//! linguistic analysis belong to the native runtime, not the content store.
use crate::{AnalyzedToken, KnowledgeProjection, SourceAnchor};
use serde::{Deserialize, Serialize};

pub const CONVERSATION_LIST_LIMIT: usize = 30;
pub const CONVERSATION_MESSAGE_LIMIT: usize = 40;
pub const CONVERSATION_TEXT_BYTES: usize = 8192;
pub const CONVERSATION_CONTEXT_BYTES: usize = 65536;
pub const CONVERSATION_PARTICIPANT_LIMIT: usize = 8;
pub const CONVERSATION_EXPLANATION_CONTACT_ID: &str = "mlearn.software-assistant";

macro_rules! identity {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
        #[serde(transparent)]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        pub struct $name(pub String);
    };
}
identity!(ContactId);
identity!(ConversationId);
identity!(MessageId);
identity!(GenerationId);

macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        pub struct $name { $(pub $field: $ty),* }
    };
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ConversationKind {
    Direct,
    #[default]
    Thread,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ConversationRole {
    User,
    Assistant,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ConversationContentStatus {
    Pending,
    Partial,
    Complete,
    Failed,
    Cancelled,
    Interrupted,
    Invalidated,
    Deleted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum GenerationStatus {
    Pending,
    Streaming,
    Complete,
    Failed,
    Cancelled,
    Interrupted,
    Invalidated,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ConversationTraceKind {
    Prompt,
    Request,
    Delta,
    Response,
    ToolCall,
    ToolResult,
    Error,
}

record!(Contact {
    id: ContactId,
    revision: u32,
    name: String,
    description: String,
    archived: bool,
});
record!(ContactPage { items: Vec<Contact>, next: Option<ContactId> });
record!(Conversation {
    id: ConversationId,
    revision: u32,
    kind: ConversationKind,
    title: String,
    purpose: String,
    package_id: String,
    participants: Vec<ContactId>,
    discarded: bool,
});
record!(ConversationPreview {
    conversation_id: ConversationId,
    message_id: MessageId,
    text: String,
    created_at_ms: f64,
    status: ConversationContentStatus,
});
record!(ConversationPage {
    items: Vec<Conversation>,
    previews: Vec<ConversationPreview>,
    next: Option<ConversationId>,
});
record!(ConversationDraft {
    conversation_id: ConversationId,
    revision: u32,
    text: String,
    reply_to: Option<MessageReference>,
});
record!(MessageReference {
    id: MessageId,
    revision: u32
});
record!(ConversationMessage {
    id: MessageId,
    conversation_id: ConversationId,
    sequence: u32,
    revision: u32,
    role: ConversationRole,
    participant_id: Option<ContactId>,
    reply_to: Option<MessageReference>,
    text: String,
    content_revision: String,
    created_at_ms: f64,
    status: ConversationContentStatus,
    generation_id: Option<GenerationId>,
    sources: Vec<SourceAnchor>,
});
// Sequence is a stable per-conversation key. Pages run newest to oldest;
// `before` is exclusive, including when a literal substring search is active.
record!(ConversationMessagePage { items: Vec<ConversationMessage>, next: Option<u32> });
record!(ConversationGeneration {
    id: GenerationId,
    conversation_id: ConversationId,
    conversation_revision: u32,
    user_message_id: MessageId,
    assistant_message_id: MessageId,
    retry_of: Option<GenerationId>,
    status: GenerationStatus,
    started_at_ms: Option<f64>,
    finished_at_ms: Option<f64>,
    error: Option<String>,
});
record!(GenerationContext {
    generation: ConversationGeneration,
    conversation: Conversation,
    participants: Vec<Contact>,
    messages: Vec<ConversationMessage>,
    truncated: bool,
});
record!(ConversationTraceRow {
    sequence: u32,
    kind: ConversationTraceKind,
    content: String,
    at_ms: f64,
});
record!(ConversationTracePage {
    generation: ConversationGeneration,
    inputs: Vec<MessageReference>,
    items: Vec<ConversationTraceRow>,
    next: Option<u32>,
});
record!(MessageAnalysis {
    message_id: MessageId,
    message_revision: u32,
    content_revision: String,
    text: String,
    tokens: Vec<AnalyzedToken>,
});
record!(MessageOccurrenceKnowledge {
    message_id: MessageId,
    token_start: u32,
    status: String,
});
record!(ConversationAnalysisBatch {
    conversation_id: ConversationId,
    package_id: String,
    package_version: String,
    package_revision: String,
    messages: Vec<MessageAnalysis>,
    knowledge: Vec<KnowledgeProjection>,
    annotations: Vec<MessageOccurrenceKnowledge>,
});
// Never contains a token. Runtime supplies the readiness bit for this session.
record!(ConversationProviderSettings {
    revision: u32,
    endpoint: String,
    model: String,
    session_credential_ready: bool,
});
record!(ConversationTurn {
    command_id: String,
    conversation_id: ConversationId,
    expected_revision: u32,
    user_message_id: MessageId,
    assistant_message_id: MessageId,
    generation_id: GenerationId,
    participant_id: ContactId,
    text: String,
    reply_to: Option<MessageReference>,
    sources: Vec<SourceAnchor>,
});
record!(ConversationRetry {
    command_id: String,
    generation_id: GenerationId,
    previous_generation_id: GenerationId,
    assistant_message_id: MessageId,
    expected_revision: u32,
});

// Runtime-only boundary. Content must be actual credential-free prompt/body,
// never headers. Each field is chunked into bounded inspectable trace rows.
record!(GenerationRequestRecord {
    command_id: String,
    generation_id: GenerationId,
    prompt: String,
    request: String,
    started_at_ms: f64,
});
record!(GenerationDelta {
    command_id: String,
    generation_id: GenerationId,
    sequence: u32,
    text: String,
    at_ms: f64,
});
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum GenerationOutcome {
    Complete { response: String },
    Failed { error: String },
    Cancelled,
}
record!(GenerationFinish {
    command_id: String,
    generation_id: GenerationId,
    outcome: GenerationOutcome,
    finished_at_ms: f64,
});

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ConversationCommand {
    ListContacts {
        after: Option<ContactId>,
        query: String,
        archived: Option<bool>,
    },
    GetContact {
        id: ContactId,
    },
    SaveContact {
        command_id: String,
        contact: Contact,
        expected_revision: u32,
    },
    ListConversations {
        after: Option<ConversationId>,
        query: String,
    },
    GetConversation {
        id: ConversationId,
    },
    CreateConversation {
        command_id: String,
        conversation: Conversation,
    },
    UpdateConversation {
        command_id: String,
        conversation: Conversation,
        expected_revision: u32,
    },
    DiscardConversation {
        command_id: String,
        id: ConversationId,
        expected_revision: u32,
    },
    ReadMessages {
        conversation_id: ConversationId,
        before: Option<u32>,
        query: String,
    },
    ReadDraft {
        conversation_id: ConversationId,
    },
    SaveDraft {
        command_id: String,
        draft: ConversationDraft,
        expected_revision: u32,
    },
    EditMessage {
        command_id: String,
        message: MessageReference,
        text: String,
    },
    DeleteMessage {
        command_id: String,
        message: MessageReference,
    },
    PrepareTurn {
        conversation_id: ConversationId,
        expected_revision: u32,
    },
    SendTurn {
        turn: ConversationTurn,
    },
    RetryGeneration {
        retry: ConversationRetry,
    },
    CancelGeneration {
        command_id: String,
        id: GenerationId,
    },
    ReadGeneration {
        id: GenerationId,
    },
    ReadTrace {
        id: GenerationId,
        after: Option<u32>,
    },
    ReadProviderSettings,
    SaveProviderSettings {
        command_id: String,
        expected_revision: u32,
        endpoint: String,
        model: String,
    },
    /// These actions are runtime-owned; storage rejects dispatch explicitly.
    SetSessionCredential {
        credential: Option<String>,
    },
    AnalyzeVisibleMessages {
        conversation_id: ConversationId,
        messages: Vec<MessageReference>,
    },
    AnalyzeMessageSource {
        source: SourceAnchor,
    },
    Explain {
        command_id: String,
        source: SourceAnchor,
        instruction: String,
    },
    GenerateMaterial {
        command: crate::MaterialGenerationStart,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ConversationResult {
    Contacts {
        page: ContactPage,
    },
    Contact {
        contact: Contact,
    },
    Conversations {
        page: ConversationPage,
    },
    Conversation {
        conversation: Conversation,
    },
    Messages {
        page: ConversationMessagePage,
    },
    Message {
        message: ConversationMessage,
    },
    Draft {
        draft: ConversationDraft,
    },
    Prepared {
        conversation: Conversation,
        participants: Vec<Contact>,
        messages: Vec<ConversationMessage>,
        truncated: bool,
    },
    Generation {
        generation: ConversationGeneration,
    },
    Trace {
        page: ConversationTracePage,
    },
    ProviderSettings {
        settings: ConversationProviderSettings,
    },
    CredentialReady {
        ready: bool,
    },
    Analysis {
        batch: ConversationAnalysisBatch,
    },
}
