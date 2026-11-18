//! One speech provider contract shared by Inspector, Review and conversation calls.
//! Audio stays bounded; credentials never enter settings, receipts or traces.
use crate::{ConversationMessage, MessageReference};
use serde::{Deserialize, Serialize};

pub const SPEECH_TEXT_BYTES: usize = 2048;
pub const SPEECH_AUDIO_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SpeechSettings {
    pub revision: u32,
    /// OpenAI-compatible base URL (for example a local speech server).
    pub endpoint: String,
    pub synthesis_model: String,
    pub transcription_model: String,
    pub voice: String,
    pub session_credential_ready: bool,
}

/// What was actually heard of a spoken reply. An interrupted reply was not fully delivered.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SpeechDelivery {
    pub delivered_chars: u32,
    pub interrupted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum SpeechCommand {
    ReadSettings,
    SaveSettings {
        command_id: String,
        expected_revision: u32,
        endpoint: String,
        synthesis_model: String,
        transcription_model: String,
        voice: String,
    },
    SetSessionCredential {
        credential: Option<String>,
    },
    Synthesize {
        text: String,
        voice: Option<String>,
    },
    Transcribe {
        /// Base64 audio of one utterance.
        audio: String,
        mime: String,
    },
    RecordDelivery {
        command_id: String,
        message: MessageReference,
        delivery: SpeechDelivery,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum SpeechResult {
    Settings {
        settings: SpeechSettings,
    },
    /// Base64 audio and the model/voice that actually produced it.
    Audio {
        audio: String,
        mime: String,
        model: String,
        voice: String,
    },
    Transcript {
        text: String,
        model: String,
    },
    Delivery {
        message: ConversationMessage,
    },
}
