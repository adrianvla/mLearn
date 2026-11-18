//! Room continuity: who witnessed what, scenario/canon direction and deliberate
//! Thread integration. Memory is derived from authoritative messages on read, so
//! a correction or deletion never leaves a contradicting stored memory behind.
use crate::{ProfileStore, StorageError, conversation::persist_conversation, conversation_read::*};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversation_worlds(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=16384));
         PRAGMA user_version=22;",
    )?;
    Ok(())
}

/// Participants present now: they witness what is written at this moment.
pub(super) fn present(owner: &Conversation) -> Vec<ContactId> {
    owner
        .participants
        .iter()
        .filter(|person| !owner.absent.contains(person))
        .cloned()
        .collect()
}

pub(super) fn witnessed(message: &ConversationMessage, contact: &ContactId) -> bool {
    message.witnesses.is_empty()
        || message.witnesses.contains(contact)
        || message.participant_id.as_ref() == Some(contact)
}

pub(super) fn validate_world(value: &ConversationWorld) -> Result<(), StorageError> {
    id(&value.conversation_id.0)?;
    text(&value.scenario, ROOM_SCENARIO_BYTES)?;
    if value.canon.len() > ROOM_CANON_LIMIT {
        return Err(invalid("A Room keeps at most sixteen canon entries"));
    }
    for entry in &value.canon {
        text(&entry.text, ROOM_CANON_TEXT_BYTES)?;
        if entry.text.trim().is_empty() {
            return Err(invalid("Canon entries need text"));
        }
    }
    Ok(())
}

pub(super) fn world(
    db: &Connection,
    key: &ConversationId,
) -> Result<ConversationWorld, StorageError> {
    conversation(db, key)?;
    let data: Option<String> = db
        .query_row(
            "SELECT data FROM conversation_worlds WHERE conversation_id=?1",
            [&key.0],
            |r| crate::document_validation::json(r, 0, 16384),
        )
        .optional()?;
    let value = match data {
        Some(data) => serde_json::from_str(&data)?,
        None => ConversationWorld {
            conversation_id: key.clone(),
            revision: 0,
            scenario: String::new(),
            canon: Vec::new(),
            progress: 0,
        },
    };
    validate_world(&value)?;
    if value.conversation_id != *key {
        return Err(invalid("Stored world identity mismatch"));
    }
    Ok(value)
}

pub(super) fn save_world(
    db: &Connection,
    value: &ConversationWorld,
    expected: u32,
) -> Result<ConversationWorld, StorageError> {
    validate_world(value)?;
    live_conversation_any(db, &value.conversation_id)?;
    let previous = world(db, &value.conversation_id)?;
    if previous.revision != expected || value.revision != expected {
        return Err(StorageError::Conflict);
    }
    let mut saved = value.clone();
    saved.revision = next(expected)?;
    db.execute(
        "INSERT INTO conversation_worlds VALUES(?1,?2) ON CONFLICT(conversation_id) DO UPDATE SET data=excluded.data",
        params![saved.conversation_id.0, serde_json::to_string(&saved)?],
    )?;
    // Direction changed: work generated under the old direction is no longer current.
    crate::conversation_generation::invalidate_active(db, &saved.conversation_id)?;
    Ok(saved)
}

fn live_conversation_any(
    db: &Connection,
    key: &ConversationId,
) -> Result<Conversation, StorageError> {
    let value = conversation(db, key)?;
    if value.discarded {
        return Err(invalid("Conversation was discarded"));
    }
    Ok(value)
}

/// Scenario Director: a present participant the learner addressed by name, else
/// the present participant who spoke least recently.
pub(super) fn speaker(
    owner: &Conversation,
    people: &[Contact],
    recent: &[ConversationMessage],
) -> Option<ContactId> {
    let present = present(owner);
    if present.is_empty() {
        return None;
    }
    if let Some(last) = recent
        .iter()
        .rev()
        .find(|message| message.role == ConversationRole::User)
    {
        let said = last.text.to_lowercase();
        if let Some(person) = people.iter().find(|person| {
            present.contains(&person.id)
                && !person.name.trim().is_empty()
                && said.contains(&person.name.to_lowercase())
        }) {
            return Some(person.id.clone());
        }
    }
    present
        .iter()
        .min_by_key(|person| {
            recent
                .iter()
                .rposition(|message| message.participant_id.as_ref() == Some(person))
                .map_or(0, |index| index + 1)
        })
        .cloned()
}

pub(super) fn integrate(
    db: &Connection,
    command_id: &str,
    thread_id: &ConversationId,
    room_id: &ConversationId,
    expected: u32,
    references: &[MessageReference],
) -> Result<Conversation, StorageError> {
    let thread = live_conversation_any(db, thread_id)?;
    let mut room = live_conversation(db, room_id, expected)?;
    if thread.kind != ConversationKind::Thread || room.kind != ConversationKind::Room {
        return Err(invalid("Only a Thread can be integrated into a Room"));
    }
    if thread.package_id != room.package_id {
        return Err(invalid("Thread and Room use different languages"));
    }
    if references.is_empty() || references.len() > CONVERSATION_MESSAGE_LIMIT {
        return Err(invalid("Choose one to forty messages to integrate"));
    }
    // Integrated events are known to Room members who took part in the Thread.
    let witnesses = present(&room)
        .into_iter()
        .filter(|person| thread.participants.contains(person))
        .collect::<Vec<_>>();
    let mut sequence: u32 = db.query_row(
        "SELECT COALESCE(MAX(sequence),0) FROM conversation_messages WHERE conversation_id=?1",
        [&room.id.0],
        |r| r.get(0),
    )?;
    let mut selected = references
        .iter()
        .map(|reference| {
            let value = message(db, &reference.id)?;
            if value.conversation_id != thread.id
                || value.revision != reference.revision
                || value.status != ConversationContentStatus::Complete
            {
                return Err(StorageError::Conflict);
            }
            Ok(value)
        })
        .collect::<Result<Vec<_>, StorageError>>()?;
    selected.sort_by_key(|value| value.sequence);
    for source in selected {
        sequence = next(sequence)?;
        let digest = Sha256::digest(format!("{command_id}\u{0}{}", source.id.0).as_bytes());
        let copy = ConversationMessage {
            id: MessageId(format!("integrated-{digest:x}")),
            conversation_id: room.id.clone(),
            sequence,
            revision: 1,
            role: source.role,
            participant_id: source.participant_id.clone(),
            reply_to: None,
            text: source.text.clone(),
            content_revision: source.content_revision.clone(),
            created_at_ms: now_ms()?,
            status: ConversationContentStatus::Complete,
            generation_id: None,
            sources: source.sources.clone(),
            witnesses: witnesses.clone(),
            integrated_from: Some(MessageReference {
                id: source.id.clone(),
                revision: source.revision,
            }),
            delivery: None,
        };
        write_message(db, &copy)?;
    }
    room.revision = next(room.revision)?;
    persist_conversation(db, &room)?;
    Ok(room)
}

pub(super) fn memory(
    db: &Connection,
    owner: &ConversationId,
    contact: &ContactId,
    before: Option<u32>,
) -> Result<ConversationMessagePage, StorageError> {
    let current = live_conversation_any(db, owner)?;
    if !current.participants.contains(contact) {
        return Err(invalid("This person is not in the conversation"));
    }
    let mut cursor = before;
    let mut items = Vec::new();
    // Bounded scan: at most four message pages per request.
    for _ in 0..4 {
        let page = messages(db, owner, cursor, "")?;
        items.extend(page.items.into_iter().filter(|item| {
            item.status == ConversationContentStatus::Complete && witnessed(item, contact)
        }));
        cursor = page.next;
        if cursor.is_none() || items.len() >= CONVERSATION_MESSAGE_LIMIT {
            break;
        }
    }
    items.truncate(CONVERSATION_MESSAGE_LIMIT);
    let next = cursor.and(items.last().map(|item| item.sequence));
    Ok(ConversationMessagePage { items, next })
}

impl ProfileStore {
    pub fn conversation_world(
        &self,
        key: &ConversationId,
    ) -> Result<ConversationWorld, StorageError> {
        world(&self.connection, key)
    }
}
