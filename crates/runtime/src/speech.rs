//! Native speech transport: one OpenAI-compatible provider for synthesis and
//! transcription, shared by Inspector, Review and conversation calls. The provider
//! that actually ran is reported with every result; nothing falls back silently.
use crate::{Runtime, execution::Failure};
use base64::Engine;
use mlearn_core::{
    Response, SPEECH_AUDIO_BYTES, SPEECH_TEXT_BYTES, SpeechCommand, SpeechResult, SpeechSettings,
};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub(crate) struct SpeechOwner {
    // Session-only: never persisted, traced or returned.
    secret: Mutex<Option<String>>,
}

fn unavailable() -> Failure {
    Failure::Protocol(
        "speech_unavailable",
        "Set up a voice provider in Settings".into(),
    )
}

fn failed(message: &str) -> Failure {
    Failure::Protocol("speech_failed", message.into())
}

fn endpoint(settings: &SpeechSettings, path: &str, model: &str) -> Result<reqwest::Url, Failure> {
    if settings.endpoint.is_empty() || model.trim().is_empty() {
        return Err(unavailable());
    }
    let mut url = reqwest::Url::parse(&settings.endpoint).map_err(|_| unavailable())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(unavailable());
    }
    let joined = format!("{}/{path}", url.path().trim_end_matches('/'));
    url.set_path(&joined);
    Ok(url)
}

fn send(request: reqwest::RequestBuilder) -> Result<(String, Vec<u8>), Failure> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| Failure::Operation(error.to_string()))?;
    runtime.block_on(async move {
        let mut response = request
            .send()
            .await
            .map_err(|_| failed("The voice provider is unavailable"))?;
        if !response.status().is_success() {
            // Error bodies may echo credentials; only the status is kept.
            return Err(failed(&format!(
                "The voice provider rejected the request (HTTP {})",
                response.status().as_u16()
            )));
        }
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_owned();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| failed("The voice provider stopped responding"))?
        {
            if body.len() + chunk.len() > SPEECH_AUDIO_BYTES {
                return Err(failed("The voice provider response is too large"));
            }
            body.extend_from_slice(&chunk);
        }
        Ok((mime, body))
    })
}

fn client() -> Result<reqwest::Client, Failure> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| failed("The voice provider is unavailable"))
}

impl SpeechOwner {
    fn secret(&self) -> Result<Option<String>, Failure> {
        Ok(self
            .secret
            .lock()
            .map_err(|_| Failure::Operation("Speech lock poisoned".into()))?
            .clone())
    }

    fn settings(&self, runtime: &Arc<Mutex<Runtime>>) -> Result<SpeechSettings, Failure> {
        let ready = self.secret()?.is_some();
        runtime
            .lock()
            .map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?
            .store
            .speech_settings(ready)
            .map_err(|error| Failure::Protocol("invalid_speech", error.to_string()))
    }

    pub(crate) fn execute(
        &self,
        runtime: &Arc<Mutex<Runtime>>,
        command: SpeechCommand,
    ) -> Result<Response, Failure> {
        let result = match command {
            SpeechCommand::ReadSettings => SpeechResult::Settings {
                settings: self.settings(runtime)?,
            },
            command @ SpeechCommand::SaveSettings { .. } => {
                let ready = self.secret()?.is_some();
                let settings = runtime
                    .lock()
                    .map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?
                    .store
                    .save_speech_settings(&command, ready)
                    .map_err(storage_failure)?;
                SpeechResult::Settings { settings }
            }
            SpeechCommand::SetSessionCredential { credential } => {
                if credential.as_ref().is_some_and(|key| {
                    key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control)
                }) {
                    return Err(Failure::Protocol(
                        "invalid_speech",
                        "Enter a valid session key".into(),
                    ));
                }
                *self
                    .secret
                    .lock()
                    .map_err(|_| Failure::Operation("Speech lock poisoned".into()))? = credential;
                SpeechResult::Settings {
                    settings: self.settings(runtime)?,
                }
            }
            SpeechCommand::Synthesize { text, voice } => {
                if text.trim().is_empty() || text.len() > SPEECH_TEXT_BYTES {
                    return Err(Failure::Protocol(
                        "invalid_speech",
                        "Choose shorter text to speak".into(),
                    ));
                }
                let settings = self.settings(runtime)?;
                let voice = voice
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| settings.voice.clone());
                let url = endpoint(&settings, "audio/speech", &settings.synthesis_model)?;
                let body = serde_json::json!({
                    "model": settings.synthesis_model, "input": text, "voice": voice, "response_format": "wav",
                });
                let mut request = client()?
                    .post(url)
                    .header("content-type", "application/json")
                    .body(body.to_string());
                if let Some(secret) = self.secret()? {
                    request = request.bearer_auth(secret);
                }
                let (mime, audio) = send(request)?;
                if !mime.starts_with("audio/") || audio.is_empty() {
                    return Err(failed("The voice provider did not return audio"));
                }
                SpeechResult::Audio {
                    audio: base64::engine::general_purpose::STANDARD.encode(audio),
                    mime,
                    model: settings.synthesis_model,
                    voice,
                }
            }
            SpeechCommand::Transcribe { audio, mime } => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(audio.as_bytes())
                    .map_err(|_| {
                        Failure::Protocol(
                            "invalid_speech",
                            "The recording could not be read".into(),
                        )
                    })?;
                let extension = match mime.split(';').next().unwrap_or("") {
                    "audio/webm" => "webm",
                    "audio/ogg" => "ogg",
                    "audio/wav" | "audio/x-wav" => "wav",
                    "audio/mp4" | "audio/m4a" => "m4a",
                    _ => {
                        return Err(Failure::Protocol(
                            "invalid_speech",
                            "This recording format isn't supported".into(),
                        ));
                    }
                };
                if bytes.is_empty() || bytes.len() > SPEECH_AUDIO_BYTES {
                    return Err(Failure::Protocol(
                        "invalid_speech",
                        "The recording is empty or too long".into(),
                    ));
                }
                let settings = self.settings(runtime)?;
                let url = endpoint(
                    &settings,
                    "audio/transcriptions",
                    &settings.transcription_model,
                )?;
                let boundary = format!("mlearn-{}", uuid_like(&bytes));
                let mut body = Vec::with_capacity(bytes.len() + 512);
                body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{}\r\n", settings.transcription_model).as_bytes());
                body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"utterance.{extension}\"\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
                body.extend_from_slice(&bytes);
                body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
                let mut request = client()?
                    .post(url)
                    .header(
                        "content-type",
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(body);
                if let Some(secret) = self.secret()? {
                    request = request.bearer_auth(secret);
                }
                let (_, response) = send(request)?;
                #[derive(serde::Deserialize)]
                struct Transcript {
                    text: String,
                }
                let parsed: Transcript = serde_json::from_slice(&response)
                    .map_err(|_| failed("The voice provider returned an unreadable transcript"))?;
                if parsed.text.len() > mlearn_core::CONVERSATION_TEXT_BYTES {
                    return Err(failed("The transcript is too long"));
                }
                SpeechResult::Transcript {
                    text: parsed.text.trim().to_owned(),
                    model: settings.transcription_model,
                }
            }
            SpeechCommand::RecordDelivery {
                command_id,
                message,
                delivery,
            } => {
                let message = runtime
                    .lock()
                    .map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?
                    .store
                    .record_speech_delivery(&command_id, &message, delivery)
                    .map_err(storage_failure)?;
                SpeechResult::Delivery { message }
            }
        };
        Ok(Response::Speech { result })
    }
}

fn storage_failure(error: mlearn_storage::StorageError) -> Failure {
    let code = if matches!(error, mlearn_storage::StorageError::Conflict) {
        "conflict"
    } else {
        "invalid_speech"
    };
    Failure::Protocol(code, error.to_string())
}

fn uuid_like(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))[..24].to_owned()
}
