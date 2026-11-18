//! Speech provider settings and what was actually heard of spoken replies.
use crate::{conversation_read::*, ProfileStore, StorageError};
use mlearn_core::*;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS speech_provider(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=8192));
         INSERT OR IGNORE INTO speech_provider VALUES(1,'{\"revision\":0,\"endpoint\":\"\",\"synthesisModel\":\"\",\"transcriptionModel\":\"\",\"voice\":\"\",\"sessionCredentialReady\":false}');
         CREATE TABLE IF NOT EXISTS speech_receipts(command_id TEXT PRIMARY KEY,digest BLOB NOT NULL);
         PRAGMA user_version=23;",
    )?;
    Ok(())
}

fn settings(db: &Connection, ready: bool) -> Result<SpeechSettings, StorageError> {
    let data = db.query_row("SELECT data FROM speech_provider WHERE id=1", [], |r| {
        crate::document_validation::json(r, 0, 8192)
    })?;
    let mut value: SpeechSettings = serde_json::from_str(&data)?;
    value.session_credential_ready = ready;
    Ok(value)
}

/// Returns true when this command identity was already applied with the same contents.
fn receipt(db: &Connection, command_id: &str, contents: &[u8]) -> Result<bool, StorageError> {
    id(command_id)?;
    let digest = Sha256::digest(contents).to_vec();
    let previous: Option<Vec<u8>> = db
        .query_row(
            "SELECT digest FROM speech_receipts WHERE command_id=?1",
            [command_id],
            |r| r.get(0),
        )
        .optional()?;
    match previous {
        Some(previous) if previous == digest => Ok(true),
        Some(_) => Err(invalid("Command identity reused for different contents")),
        None => {
            db.execute("INSERT INTO speech_receipts VALUES(?1,?2)", params![command_id, digest])?;
            Ok(false)
        }
    }
}

impl ProfileStore {
    pub fn speech_settings(&self, ready: bool) -> Result<SpeechSettings, StorageError> {
        settings(&self.connection, ready)
    }

    pub fn save_speech_settings(
        &mut self,
        command: &SpeechCommand,
        ready: bool,
    ) -> Result<SpeechSettings, StorageError> {
        let SpeechCommand::SaveSettings {
            command_id,
            expected_revision,
            endpoint: base,
            synthesis_model,
            transcription_model,
            voice,
        } = command
        else {
            return Err(invalid("Expected speech settings"));
        };
        if !base.is_empty() {
            endpoint(base)?;
        }
        for value in [synthesis_model, transcription_model, voice] {
            text(value, 256)?;
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if receipt(&tx, command_id, &serde_json::to_vec(command)?)? {
            return settings(&tx, ready);
        }
        let previous = settings(&tx, ready)?;
        if previous.revision != *expected_revision {
            return Err(StorageError::Conflict);
        }
        let saved = SpeechSettings {
            revision: next(*expected_revision)?,
            endpoint: base.clone(),
            synthesis_model: synthesis_model.clone(),
            transcription_model: transcription_model.clone(),
            voice: voice.clone(),
            session_credential_ready: false,
        };
        tx.execute(
            "UPDATE speech_provider SET data=?1 WHERE id=1",
            [serde_json::to_string(&saved)?],
        )?;
        tx.commit()?;
        Ok(SpeechSettings { session_credential_ready: ready, ..saved })
    }

    /// Records playback of a spoken reply. The text stays authoritative; only
    /// what the learner could have heard changes, so no generation is invalidated.
    pub fn record_speech_delivery(
        &mut self,
        command_id: &str,
        reference: &MessageReference,
        delivery: SpeechDelivery,
    ) -> Result<ConversationMessage, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let contents = serde_json::to_vec(&(reference, delivery))?;
        let replay = receipt(&tx, command_id, &contents)?;
        let mut value = message(&tx, &reference.id)?;
        if !replay {
            if value.revision != reference.revision
                || value.role != ConversationRole::Assistant
                || value.status != ConversationContentStatus::Complete
            {
                return Err(StorageError::Conflict);
            }
            let chars = u32::try_from(value.text.chars().count()).unwrap_or(u32::MAX);
            if delivery.delivered_chars > chars || !delivery.interrupted && delivery.delivered_chars != chars {
                return Err(invalid("Delivered speech does not match the reply"));
            }
            value.delivery = Some(delivery);
            write_message(&tx, &value)?;
        }
        tx.commit()?;
        Ok(value)
    }
}
