use crate::{StorageError, document_validation::json};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

pub(super) fn content_revision(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

pub(super) fn now_ms() -> Result<f64, StorageError> {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| invalid("System clock predates the Unix epoch"))?;
    Ok(elapsed.as_secs_f64() * 1000.0)
}

impl crate::ProfileStore {
    pub fn read_conversation_message(
        &self,
        key: &MessageId,
    ) -> Result<ConversationMessage, StorageError> {
        message(&self.connection, key)
    }

    pub fn read_conversation(&self, key: &ConversationId) -> Result<Conversation, StorageError> {
        conversation(&self.connection, key)
    }

    /// Frozen source text for Capture/Return, independently of current content.
    /// Authored revisions and completed responses survive edit/delete/discard.
    pub fn read_message_version(
        &self,
        key: &MessageId,
        revision: u32,
    ) -> Result<ConversationMessage, StorageError> {
        id(&key.0)?;
        let data = self.connection.query_row(
            "SELECT data FROM conversation_message_versions WHERE message_id=?1 AND revision=?2",
            params![key.0, revision],
            |r| json(r, 0, 32768),
        )?;
        let value: ConversationMessage = serde_json::from_str(&data)?;
        validate_message(&value)?;
        if value.id != *key || value.revision != revision {
            return Err(invalid("Stored message version identity mismatch"));
        }
        Ok(value)
    }
}

pub(super) fn invalid(message: &str) -> StorageError {
    StorageError::Invalid(message.into())
}

pub(super) fn text(value: &str, max: usize) -> Result<(), StorageError> {
    if value.len() > max || value.contains('\0') {
        return Err(invalid(
            "Conversation field exceeds its bound or contains NUL",
        ));
    }
    Ok(())
}

pub(super) fn id(value: &str) -> Result<(), StorageError> {
    text(value, 128)?;
    if value.trim().is_empty() || value.chars().any(char::is_control) {
        return Err(invalid("Invalid conversation identity"));
    }
    Ok(())
}

pub(super) fn next(revision: u32) -> Result<u32, StorageError> {
    revision
        .checked_add(1)
        .ok_or_else(|| invalid("Conversation revision exhausted"))
}

pub(super) fn contact(db: &Connection, key: &ContactId) -> Result<Contact, StorageError> {
    id(&key.0)?;
    let data = db.query_row(
        "SELECT data FROM conversation_contacts WHERE id=?1",
        [&key.0],
        |r| json(r, 0, 12288),
    )?;
    let value: Contact = serde_json::from_str(&data)?;
    validate_contact(&value)?;
    if value.id != *key {
        return Err(invalid("Stored contact identity mismatch"));
    }
    Ok(value)
}

pub(super) fn validate_contact(value: &Contact) -> Result<(), StorageError> {
    id(&value.id.0)?;
    text(&value.name, 256)?;
    text(&value.description, 8192)?;
    if value.name.trim().is_empty() {
        return Err(invalid("Contact name is required"));
    }
    Ok(())
}

pub(super) fn conversation(
    db: &Connection,
    key: &ConversationId,
) -> Result<Conversation, StorageError> {
    id(&key.0)?;
    let data = db.query_row(
        "SELECT data FROM conversations WHERE id=?1",
        [&key.0],
        |r| json(r, 0, 8192),
    )?;
    let value: Conversation = serde_json::from_str(&data)?;
    validate_conversation(&value)?;
    if value.id != *key {
        return Err(invalid("Stored conversation identity mismatch"));
    }
    Ok(value)
}

pub(super) fn validate_conversation(value: &Conversation) -> Result<(), StorageError> {
    id(&value.id.0)?;
    id(&value.package_id)?;
    text(&value.title, 256)?;
    text(&value.purpose, 4096)?;
    if value.participants.is_empty() || value.participants.len() > CONVERSATION_PARTICIPANT_LIMIT {
        return Err(invalid("Conversation requires one to eight participants"));
    }
    if value.kind == ConversationKind::Direct && value.participants.len() != 1 {
        return Err(invalid("Direct conversations require exactly one contact"));
    }
    for (index, participant) in value.participants.iter().enumerate() {
        id(&participant.0)?;
        if value.participants[..index].contains(participant) {
            return Err(invalid("Duplicate conversation participant"));
        }
    }
    Ok(())
}

pub(super) fn live_conversation(
    db: &Connection,
    key: &ConversationId,
    expected: u32,
) -> Result<Conversation, StorageError> {
    let value = conversation(db, key)?;
    if value.discarded {
        return Err(invalid("Conversation was discarded"));
    }
    if value.revision != expected {
        return Err(StorageError::Conflict);
    }
    Ok(value)
}

pub(super) fn draft(
    db: &Connection,
    key: &ConversationId,
) -> Result<ConversationDraft, StorageError> {
    let owner = conversation(db, key)?;
    if owner.discarded {
        return Err(invalid("Conversation was discarded"));
    }
    let data: Option<String> = db
        .query_row(
            "SELECT data FROM conversation_drafts WHERE conversation_id=?1",
            [&key.0],
            |r| json(r, 0, 16384),
        )
        .optional()?;
    let value = match data {
        Some(data) => serde_json::from_str(&data)?,
        None => ConversationDraft {
            conversation_id: key.clone(),
            revision: 0,
            text: String::new(),
            reply_to: None,
        },
    };
    text(&value.text, CONVERSATION_TEXT_BYTES)?;
    if value.conversation_id != *key {
        return Err(invalid("Stored draft identity mismatch"));
    }
    Ok(value)
}

pub(super) fn message(
    db: &Connection,
    key: &MessageId,
) -> Result<ConversationMessage, StorageError> {
    id(&key.0)?;
    let data = db.query_row(
        "SELECT data FROM conversation_messages WHERE id=?1",
        [&key.0],
        |r| json(r, 0, 32768),
    )?;
    let value: ConversationMessage = serde_json::from_str(&data)?;
    validate_message(&value)?;
    if value.id != *key {
        return Err(invalid("Stored message identity mismatch"));
    }
    Ok(value)
}

pub(super) fn validate_sources(sources: &[SourceAnchor]) -> Result<(), StorageError> {
    if sources.len() > 4 || serde_json::to_vec(sources)?.len() > 8192 {
        return Err(invalid("Conversation source context exceeds bound"));
    }
    // Existence, selection and shared source semantics are checked by runtime.
    Ok(())
}

pub(super) fn validate_message(value: &ConversationMessage) -> Result<(), StorageError> {
    id(&value.id.0)?;
    id(&value.conversation_id.0)?;
    text(&value.text, CONVERSATION_TEXT_BYTES)?;
    if value.content_revision != content_revision(&value.text) {
        return Err(invalid("Stored message text hash mismatch"));
    }
    timestamp(value.created_at_ms)?;
    validate_sources(&value.sources)?;
    if let Some(participant) = &value.participant_id {
        id(&participant.0)?;
    }
    if let Some(generation) = &value.generation_id {
        id(&generation.0)?;
    }
    if let Some(reply) = &value.reply_to {
        id(&reply.id.0)?;
    }
    Ok(())
}

pub(super) fn check_reply(
    db: &Connection,
    owner: &ConversationId,
    reference: &Option<MessageReference>,
) -> Result<(), StorageError> {
    if let Some(reference) = reference {
        let value = message(db, &reference.id)?;
        if value.conversation_id != *owner
            || value.revision != reference.revision
            || value.status != ConversationContentStatus::Complete
        {
            return Err(StorageError::Conflict);
        }
    }
    Ok(())
}

pub(super) fn write_message(
    db: &Connection,
    value: &ConversationMessage,
) -> Result<(), StorageError> {
    validate_message(value)?;
    db.execute("INSERT INTO conversation_messages(id,conversation_id,sequence,data) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![value.id.0, value.conversation_id.0, value.sequence, serde_json::to_string(value)?])?;
    if matches!(
        value.status,
        ConversationContentStatus::Complete | ConversationContentStatus::Deleted
    ) {
        db.execute(
            "INSERT INTO conversation_message_versions VALUES(?1,?2,?3) ON CONFLICT(message_id,revision) DO NOTHING",
            params![value.id.0, value.revision, serde_json::to_string(&value)?],
        )?;
    }
    Ok(())
}

pub(super) fn generation(
    db: &Connection,
    key: &GenerationId,
) -> Result<ConversationGeneration, StorageError> {
    id(&key.0)?;
    let data = db.query_row(
        "SELECT data FROM conversation_generations WHERE id=?1",
        [&key.0],
        |r| json(r, 0, 8192),
    )?;
    let value: ConversationGeneration = serde_json::from_str(&data)?;
    if value.id != *key {
        return Err(invalid("Stored generation identity mismatch"));
    }
    id(&value.conversation_id.0)?;
    id(&value.user_message_id.0)?;
    id(&value.assistant_message_id.0)?;
    if let Some(error) = &value.error {
        text(error, 2048)?;
    }
    if let Some(at) = value.started_at_ms {
        timestamp(at)?;
    }
    if let Some(at) = value.finished_at_ms {
        timestamp(at)?;
    }
    Ok(value)
}

pub(super) fn write_generation(
    db: &Connection,
    value: &ConversationGeneration,
) -> Result<(), StorageError> {
    db.execute(
        "UPDATE conversation_generations SET data=?2,active=?3 WHERE id=?1",
        params![
            value.id.0,
            serde_json::to_string(value)?,
            active(value.status)
        ],
    )?;
    Ok(())
}

pub(super) const fn active(status: GenerationStatus) -> bool {
    match status {
        GenerationStatus::Pending | GenerationStatus::Streaming => true,
        GenerationStatus::Complete
        | GenerationStatus::Failed
        | GenerationStatus::Cancelled
        | GenerationStatus::Interrupted
        | GenerationStatus::Invalidated => false,
    }
}

pub(super) fn timestamp(value: f64) -> Result<(), StorageError> {
    if !value.is_finite() || value < 0.0 {
        return Err(invalid("Invalid generation timestamp"));
    }
    Ok(())
}

pub(super) fn messages(
    db: &Connection,
    owner: &ConversationId,
    before: Option<u32>,
    query: &str,
) -> Result<ConversationMessagePage, StorageError> {
    id(&owner.0)?;
    text(query, 256)?;
    let current = conversation(db, owner)?;
    if current.discarded {
        return Err(invalid("Conversation was discarded"));
    }
    let mut statement = db.prepare("SELECT id FROM conversation_messages WHERE conversation_id=?1 AND (?2 IS NULL OR sequence<?2) AND instr(lower(json_extract(data,'$.text')),lower(?3))>0 ORDER BY sequence DESC LIMIT 41")?;
    let keys = statement
        .query_map(params![owner.0, before, query], |r| {
            Ok(MessageId(json(r, 0, 128)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let more = keys.len() > CONVERSATION_MESSAGE_LIMIT;
    let mut items = Vec::new();
    let mut bytes = 0;
    let mut truncated = more;
    for key in keys.iter().take(CONVERSATION_MESSAGE_LIMIT) {
        let item = message(db, key)?;
        bytes += serde_json::to_vec(&item)?.len();
        if bytes > 320 * 1024 {
            truncated = true;
            break;
        }
        items.push(item);
    }
    let next = if truncated {
        items.last().map(|m| m.sequence)
    } else {
        None
    };
    Ok(ConversationMessagePage { items, next })
}

pub(super) fn participants(
    db: &Connection,
    owner: &Conversation,
) -> Result<Vec<Contact>, StorageError> {
    owner
        .participants
        .iter()
        .map(|key| contact(db, key))
        .collect()
}

pub(super) fn context(
    db: &Connection,
    owner: &Conversation,
    before: Option<u32>,
) -> Result<(Vec<ConversationMessage>, bool), StorageError> {
    let page = messages(db, &owner.id, before, "")?;
    let mut result = Vec::new();
    let mut bytes = 0;
    let mut truncated = page.next.is_some();
    for item in page.items {
        if item.status != ConversationContentStatus::Complete {
            continue;
        }
        bytes += serde_json::to_vec(&item)?.len();
        if result.len() == 20 || bytes > CONVERSATION_CONTEXT_BYTES {
            truncated = true;
            break;
        }
        result.push(item);
    }
    result.reverse();
    Ok((result, truncated))
}

pub(super) fn settings(
    db: &Connection,
    ready: bool,
) -> Result<ConversationProviderSettings, StorageError> {
    let data = db.query_row(
        "SELECT data FROM conversation_provider WHERE id=1",
        [],
        |r| json(r, 0, 8192),
    )?;
    let mut value: ConversationProviderSettings = serde_json::from_str(&data)?;
    endpoint(&value.endpoint)?;
    text(&value.model, 256)?;
    value.session_credential_ready = ready;
    Ok(value)
}

pub(super) fn endpoint(value: &str) -> Result<(), StorageError> {
    text(value, 2048)?;
    if !value.is_empty()
        && (!(value.starts_with("https://") || value.starts_with("http://"))
            || value.contains(['@', '?', '#'])
            || value.chars().any(char::is_whitespace))
    {
        return Err(invalid(
            "Provider endpoint must be HTTP(S), without credentials, query or fragment",
        ));
    }
    Ok(())
}
