use crate::{ProfileStore, StorageError, conversation::persist_conversation, conversation_read::*};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

fn unused_message(db: &Connection, key: &MessageId) -> Result<(), StorageError> {
    id(&key.0)?;
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM conversation_messages WHERE id=?1)",
        [&key.0],
        |r| r.get(0),
    )?;
    if exists {
        return Err(invalid("Message identity already exists"));
    }
    Ok(())
}

fn available(
    db: &Connection,
    owner: &Conversation,
    key: &GenerationId,
) -> Result<(), StorageError> {
    id(&key.0)?;
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM conversation_generations WHERE id=?1 OR (conversation_id=?2 AND active=1))", params![key.0, owner.id.0], |r| r.get(0))?;
    if exists {
        return Err(invalid(
            "Generation identity exists or conversation already has active work",
        ));
    }
    Ok(())
}

fn sequence(db: &Connection, owner: &ConversationId) -> Result<u32, StorageError> {
    let sequence: u32 = db.query_row(
        "SELECT COALESCE(MAX(sequence),0) FROM conversation_messages WHERE conversation_id=?1",
        [&owner.0],
        |r| r.get(0),
    )?;
    next(sequence)
}

fn create_generation(
    db: &Connection,
    owner: &mut Conversation,
    user: &ConversationMessage,
    assistant: &MessageId,
    key: &GenerationId,
    participant: &ContactId,
    retry_of: Option<GenerationId>,
) -> Result<ConversationGeneration, StorageError> {
    let value = ConversationGeneration {
        id: key.clone(),
        conversation_id: owner.id.clone(),
        conversation_revision: next(owner.revision)?,
        user_message_id: user.id.clone(),
        assistant_message_id: assistant.clone(),
        retry_of,
        status: GenerationStatus::Pending,
        started_at_ms: None,
        finished_at_ms: None,
        error: None,
    };
    let provisional = ConversationMessage {
        id: assistant.clone(),
        conversation_id: owner.id.clone(),
        sequence: sequence(db, &owner.id)?,
        revision: 1,
        role: ConversationRole::Assistant,
        participant_id: Some(participant.clone()),
        reply_to: Some(MessageReference {
            id: user.id.clone(),
            revision: user.revision,
        }),
        text: String::new(),
        content_revision: content_revision(""),
        created_at_ms: now_ms()?,
        status: ConversationContentStatus::Pending,
        generation_id: Some(key.clone()),
        sources: Vec::new(),
    };
    write_message(db, &provisional)?;
    db.execute(
        "INSERT INTO conversation_generations(id,conversation_id,data,active) VALUES(?1,?2,?3,1)",
        params![key.0, owner.id.0, serde_json::to_string(&value)?],
    )?;
    for person in participants(db, owner)? {
        db.execute(
            "INSERT INTO conversation_generation_contacts VALUES(?1,?2,?3)",
            params![key.0, person.id.0, person.revision],
        )?;
    }
    owner.revision = value.conversation_revision;
    persist_conversation(db, owner)?;
    Ok(value)
}

pub(super) fn admit(
    db: &Connection,
    turn: &ConversationTurn,
) -> Result<ConversationGeneration, StorageError> {
    let mut owner = live_conversation(db, &turn.conversation_id, turn.expected_revision)?;
    available(db, &owner, &turn.generation_id)?;
    unused_message(db, &turn.user_message_id)?;
    unused_message(db, &turn.assistant_message_id)?;
    if turn.user_message_id == turn.assistant_message_id {
        return Err(invalid("User and response identities must differ"));
    }
    text(&turn.text, CONVERSATION_TEXT_BYTES)?;
    validate_sources(&turn.sources)?;
    if turn.text.trim().is_empty() || !owner.participants.contains(&turn.participant_id) {
        return Err(invalid(
            "Turn needs text and an actual conversation participant",
        ));
    }
    check_reply(db, &owner.id, &turn.reply_to)?;
    let (mut inputs, _) = context(db, &owner, None)?;
    // A reply outside the recent window is an actual input, not just a label.
    if let Some(reply) = &turn.reply_to {
        if !inputs.iter().any(|v| v.id == reply.id) {
            inputs.insert(0, message(db, &reply.id)?);
        }
    }
    let user = ConversationMessage {
        id: turn.user_message_id.clone(),
        conversation_id: owner.id.clone(),
        sequence: sequence(db, &owner.id)?,
        revision: 1,
        role: ConversationRole::User,
        participant_id: None,
        reply_to: turn.reply_to.clone(),
        text: turn.text.clone(),
        content_revision: content_revision(&turn.text),
        created_at_ms: now_ms()?,
        status: ConversationContentStatus::Complete,
        generation_id: None,
        sources: turn.sources.clone(),
    };
    inputs.push(user.clone());
    while serde_json::to_vec(&inputs)?.len() > CONVERSATION_CONTEXT_BYTES {
        let removable = inputs.iter().position(|input| {
            input.id != user.id
                && !turn
                    .reply_to
                    .as_ref()
                    .is_some_and(|reply| reply.id == input.id)
        });
        match removable {
            Some(index) => {
                inputs.remove(index);
            }
            None => return Err(invalid("Turn and explicit reply context exceed 64 KiB")),
        }
    }
    write_message(db, &user)?;
    let value = create_generation(
        db,
        &mut owner,
        &user,
        &turn.assistant_message_id,
        &turn.generation_id,
        &turn.participant_id,
        None,
    )?;
    for input in inputs {
        db.execute(
            "INSERT INTO conversation_generation_inputs VALUES(?1,?2,?3)",
            params![value.id.0, input.id.0, input.revision],
        )?;
    }
    Ok(value)
}

pub(super) fn retry(
    db: &Connection,
    retry: &ConversationRetry,
) -> Result<ConversationGeneration, StorageError> {
    let previous = generation(db, &retry.previous_generation_id)?;
    match previous.status {
        GenerationStatus::Failed | GenerationStatus::Cancelled | GenerationStatus::Interrupted => {}
        GenerationStatus::Pending
        | GenerationStatus::Streaming
        | GenerationStatus::Complete
        | GenerationStatus::Invalidated => {
            return Err(invalid(
                "Only failed, cancelled or interrupted generations can be retried",
            ));
        }
    }
    let mut owner = live_conversation(db, &previous.conversation_id, retry.expected_revision)?;
    available(db, &owner, &retry.generation_id)?;
    unused_message(db, &retry.assistant_message_id)?;
    // Verify the actual original inputs rather than silently substituting new text.
    generation_context(db, &previous.id, false)?;
    let user = message(db, &previous.user_message_id)?;
    let old_assistant = message(db, &previous.assistant_message_id)?;
    let participant = old_assistant
        .participant_id
        .ok_or_else(|| invalid("Generation response has no participant"))?;
    if !owner.participants.contains(&participant) {
        return Err(StorageError::Conflict);
    }
    let value = create_generation(
        db,
        &mut owner,
        &user,
        &retry.assistant_message_id,
        &retry.generation_id,
        &participant,
        Some(previous.id.clone()),
    )?;
    db.execute("INSERT INTO conversation_generation_inputs SELECT ?1,message_id,revision FROM conversation_generation_inputs WHERE generation_id=?2", params![value.id.0, previous.id.0])?;
    crate::material_generation::copy_retry(db, &previous.id, &value.id)?;
    Ok(value)
}

pub(super) fn cancel(
    db: &Connection,
    key: &GenerationId,
) -> Result<ConversationGeneration, StorageError> {
    let mut value = generation(db, key)?;
    if active(value.status) {
        value.status = GenerationStatus::Cancelled;
        let mut response = message(db, &value.assistant_message_id)?;
        response.status = ConversationContentStatus::Cancelled;
        write_message(db, &response)?;
        write_generation(db, &value)?;
    }
    Ok(value)
}

// A recursive dependency walk invalidates derived outputs, never later authored
// records. SQLite performs the walk; no history is materialized in native memory.
fn invalidate(db: &Connection, seed: &str, key: &str) -> Result<(), StorageError> {
    let recursive = format!(
        "WITH RECURSIVE affected(id) AS (
         {seed}
         UNION SELECT i.generation_id FROM affected a
         JOIN conversation_generations g ON g.id=a.id
         JOIN conversation_generation_inputs i ON i.message_id=json_extract(g.data,'$.assistantMessageId'))
         "
    );
    db.execute(&format!("{recursive} UPDATE conversation_messages SET data=json_set(data,'$.status','invalidated','$.revision',json_extract(data,'$.revision')+1) WHERE json_extract(data,'$.generationId') IN (SELECT id FROM affected) AND json_extract(data,'$.status') NOT IN ('invalidated','deleted')"), [key])?;
    db.execute(&format!("{recursive} UPDATE conversation_generations SET active=0,data=json_set(data,'$.status','invalidated') WHERE id IN (SELECT id FROM affected)"), [key])?;
    Ok(())
}

pub(super) fn invalidate_message(db: &Connection, key: &MessageId) -> Result<(), StorageError> {
    invalidate(
        db,
        "SELECT generation_id AS id FROM conversation_generation_inputs WHERE message_id=?1
         UNION SELECT id FROM conversation_generations WHERE active=1 AND conversation_id=
             (SELECT conversation_id FROM conversation_messages WHERE id=?1)",
        &key.0,
    )
}

pub(super) fn invalidate_contact(db: &Connection, key: &ContactId) -> Result<(), StorageError> {
    invalidate(
        db,
        "SELECT generation_id AS id FROM conversation_generation_contacts WHERE contact_id=?1",
        &key.0,
    )
}

pub(super) fn invalidate_conversation(
    db: &Connection,
    key: &ConversationId,
) -> Result<(), StorageError> {
    invalidate(
        db,
        "SELECT id FROM conversation_generations WHERE conversation_id=?1",
        &key.0,
    )
}

fn input_references(
    db: &Connection,
    key: &GenerationId,
) -> Result<Vec<MessageReference>, StorageError> {
    let mut statement = db.prepare("SELECT message_id,revision FROM conversation_generation_inputs WHERE generation_id=?1 ORDER BY (SELECT sequence FROM conversation_messages WHERE id=message_id) LIMIT 23")?;
    let inputs = statement
        .query_map([&key.0], |r| {
            Ok(MessageReference {
                id: MessageId(crate::document_validation::json(r, 0, 128)?),
                revision: r.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if inputs.len() > 22 {
        return Err(invalid("Stored generation input list exceeds bound"));
    }
    Ok(inputs)
}

fn generation_context(
    db: &Connection,
    key: &GenerationId,
    require_active: bool,
) -> Result<GenerationContext, StorageError> {
    let value = generation(db, key)?;
    let owner = conversation(db, &value.conversation_id)?;
    if owner.discarded
        || (require_active
            && (!active(value.status) || owner.revision != value.conversation_revision))
    {
        return Err(StorageError::Conflict);
    }
    let references = input_references(db, key)?;
    let mut messages = Vec::new();
    for reference in references {
        let input = message(db, &reference.id)?;
        if input.conversation_id != owner.id
            || input.revision != reference.revision
            || input.status != ConversationContentStatus::Complete
        {
            return Err(StorageError::Conflict);
        }
        messages.push(input);
    }
    if !messages.iter().any(|v| v.id == value.user_message_id)
        || serde_json::to_vec(&messages)?.len() > CONVERSATION_CONTEXT_BYTES
    {
        return Err(invalid(
            "Stored generation context is missing or exceeds bound",
        ));
    }
    let people = participants(db, &owner)?;
    for person in &people {
        let expected: Option<u32> = db.query_row("SELECT revision FROM conversation_generation_contacts WHERE generation_id=?1 AND contact_id=?2", params![key.0, person.id.0], |r| r.get(0)).optional()?;
        if expected != Some(person.revision) {
            return Err(StorageError::Conflict);
        }
    }
    // This says whether older complete content was omitted, without loading it.
    let truncated = db.query_row("SELECT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id=?1 AND m.sequence<=(SELECT sequence FROM conversation_messages WHERE id=?2) AND json_extract(m.data,'$.status')='complete' AND NOT EXISTS(SELECT 1 FROM conversation_generation_inputs i WHERE i.generation_id=?3 AND i.message_id=m.id))", params![owner.id.0, value.user_message_id.0, value.id.0], |r| r.get(0))?;
    Ok(GenerationContext {
        generation: value,
        conversation: owner,
        participants: people,
        messages,
        truncated,
    })
}

fn worker_receipt(
    db: &Connection,
    command: &str,
    key: &GenerationId,
    payload: &[u8],
) -> Result<bool, StorageError> {
    id(command)?;
    id(&key.0)?;
    let content_exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM conversation_receipts WHERE command_id=?1)",
        [command],
        |r| r.get(0),
    )?;
    if content_exists {
        return Err(invalid(
            "Command identity belongs to a conversation content action",
        ));
    }
    let digest = Sha256::digest(payload).to_vec();
    let previous: Option<(Vec<u8>, String)> = db
        .query_row(
            "SELECT digest,generation_id FROM conversation_worker_receipts WHERE command_id=?1",
            [command],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((old, owner)) = previous {
        if old != digest || owner != key.0 {
            return Err(invalid(
                "Worker command identity reused for different contents",
            ));
        }
        return Ok(true);
    }
    db.execute(
        "INSERT INTO conversation_worker_receipts VALUES(?1,?2,?3)",
        params![command, digest, key.0],
    )?;
    Ok(false)
}

fn append_trace(
    db: &Connection,
    key: &GenerationId,
    kind: ConversationTraceKind,
    content: &str,
    at_ms: f64,
) -> Result<(), StorageError> {
    timestamp(at_ms)?;
    text(content, 131072)?;
    let (mut sequence, mut bytes): (u32, usize) = db.query_row("SELECT trace_sequence,(SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) FROM conversation_traces WHERE generation_id=?1) FROM conversation_generations WHERE id=?1", [&key.0], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if bytes + content.len() > 256 * 1024 || sequence > 1024 {
        return Err(invalid("Generation execution trace budget exhausted"));
    }
    let latest: Option<f64> = db.query_row("SELECT json_extract(data,'$.atMs') FROM conversation_traces WHERE generation_id=?1 ORDER BY sequence DESC LIMIT 1", [&key.0], |r| r.get(0)).optional()?;
    if latest.is_some_and(|latest| at_ms < latest) {
        return Err(invalid("Generation timestamps are not monotonic"));
    }
    // UTF-8 byte chunks; the concatenation is exactly the supplied actual text.
    let mut remaining = content;
    loop {
        let mut boundary = remaining.len().min(1024);
        while !remaining.is_char_boundary(boundary) {
            boundary -= 1;
        }
        let (chunk, rest) = remaining.split_at(boundary);
        sequence = next(sequence)?;
        let row = ConversationTraceRow {
            sequence,
            kind,
            content: chunk.into(),
            at_ms,
        };
        let encoded = serde_json::to_string(&row)?;
        bytes += encoded.len();
        if bytes > 256 * 1024 || sequence > 1024 {
            return Err(invalid("Generation execution trace budget exhausted"));
        }
        db.execute(
            "INSERT INTO conversation_traces VALUES(?1,?2,?3)",
            params![key.0, sequence, encoded],
        )?;
        remaining = rest;
        if remaining.is_empty() {
            break;
        }
    }
    db.execute(
        "UPDATE conversation_generations SET trace_sequence=?2 WHERE id=?1",
        params![key.0, sequence],
    )?;
    Ok(())
}

pub(super) fn trace(
    db: &Connection,
    key: &GenerationId,
    after: Option<u32>,
) -> Result<ConversationTracePage, StorageError> {
    let value = generation(db, key)?;
    let mut stmt = db.prepare("SELECT data FROM conversation_traces WHERE generation_id=?1 AND (?2 IS NULL OR sequence>?2) ORDER BY sequence LIMIT 41")?;
    let data = stmt
        .query_map(params![key.0, after], |r| {
            crate::document_validation::json(r, 0, 8192)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let more = data.len() > 40;
    let mut items = Vec::new();
    for data in data.into_iter().take(40) {
        let row: ConversationTraceRow = serde_json::from_str(&data)?;
        text(&row.content, 4096)?;
        timestamp(row.at_ms)?;
        items.push(row);
    }
    let next = if more {
        items.last().map(|v| v.sequence)
    } else {
        None
    };
    Ok(ConversationTracePage {
        generation: value,
        inputs: input_references(db, key)?,
        items,
        next,
    })
}

impl ProfileStore {
    pub fn conversation_generation_context(
        &self,
        key: &GenerationId,
    ) -> Result<GenerationContext, StorageError> {
        let tx = self.connection.unchecked_transaction()?;
        let context = generation_context(&tx, key, true)?;
        tx.commit()?;
        Ok(context)
    }

    pub fn record_conversation_request(
        &mut self,
        record: &GenerationRequestRecord,
    ) -> Result<ConversationGeneration, StorageError> {
        timestamp(record.started_at_ms)?;
        text(&record.prompt, CONVERSATION_CONTEXT_BYTES)?;
        text(&record.request, 131072)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let payload = serde_json::to_vec(&("request", record))?;
        if worker_receipt(&tx, &record.command_id, &record.generation_id, &payload)? {
            return generation(&tx, &record.generation_id);
        }
        let mut value = generation_context(&tx, &record.generation_id, true)?.generation;
        if value.status != GenerationStatus::Pending {
            return Err(StorageError::Conflict);
        }
        append_trace(
            &tx,
            &value.id,
            ConversationTraceKind::Prompt,
            &record.prompt,
            record.started_at_ms,
        )?;
        append_trace(
            &tx,
            &value.id,
            ConversationTraceKind::Request,
            &record.request,
            record.started_at_ms,
        )?;
        value.status = GenerationStatus::Streaming;
        value.started_at_ms = Some(record.started_at_ms);
        write_generation(&tx, &value)?;
        tx.commit()?;
        Ok(value)
    }

    pub fn append_conversation_delta(
        &mut self,
        delta: &GenerationDelta,
    ) -> Result<ConversationGeneration, StorageError> {
        timestamp(delta.at_ms)?;
        text(&delta.text, 1024)?;
        if delta.text.is_empty() {
            return Err(invalid("Empty generation delta"));
        }
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let payload = serde_json::to_vec(&("delta", delta))?;
        if worker_receipt(&tx, &delta.command_id, &delta.generation_id, &payload)? {
            return generation(&tx, &delta.generation_id);
        }
        let value = generation_context(&tx, &delta.generation_id, true)?.generation;
        if value.status != GenerationStatus::Streaming {
            return Err(StorageError::Conflict);
        }
        let previous: u32 = tx.query_row(
            "SELECT delta_sequence FROM conversation_generations WHERE id=?1",
            [&value.id.0],
            |r| r.get(0),
        )?;
        if delta.sequence != next(previous)? {
            return Err(StorageError::Conflict);
        }
        let mut response = message(&tx, &value.assistant_message_id)?;
        if response.text.len() + delta.text.len() > CONVERSATION_TEXT_BYTES {
            return Err(invalid("Generated response exceeds 8 KiB"));
        }
        response.text.push_str(&delta.text);
        response.content_revision = content_revision(&response.text);
        response.status = ConversationContentStatus::Partial;
        write_message(&tx, &response)?;
        append_trace(
            &tx,
            &value.id,
            ConversationTraceKind::Delta,
            &delta.text,
            delta.at_ms,
        )?;
        tx.execute(
            "UPDATE conversation_generations SET delta_sequence=?2 WHERE id=?1",
            params![value.id.0, delta.sequence],
        )?;
        tx.commit()?;
        Ok(value)
    }

    pub fn finish_conversation_generation(
        &mut self,
        finish: &GenerationFinish,
    ) -> Result<ConversationGeneration, StorageError> {
        timestamp(finish.finished_at_ms)?;
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let payload = serde_json::to_vec(&("finish", finish))?;
        if payload.len() > 16384 {
            return Err(invalid("Generation completion exceeds bound"));
        }
        if worker_receipt(&tx, &finish.command_id, &finish.generation_id, &payload)? {
            return generation(&tx, &finish.generation_id);
        }
        let mut value = generation_context(&tx, &finish.generation_id, true)?.generation;
        if value
            .started_at_ms
            .is_some_and(|started| finish.finished_at_ms < started)
        {
            return Err(invalid("Generation finished before it started"));
        }
        let mut response = message(&tx, &value.assistant_message_id)?;
        match &finish.outcome {
            GenerationOutcome::Complete { response: actual } => {
                text(actual, CONVERSATION_TEXT_BYTES)?;
                if value.status != GenerationStatus::Streaming
                    || actual.trim().is_empty()
                    || (!response.text.is_empty() && response.text != *actual)
                {
                    return Err(invalid(
                        "Completion does not match the actual streamed response",
                    ));
                }
                append_trace(
                    &tx,
                    &value.id,
                    ConversationTraceKind::Response,
                    actual,
                    finish.finished_at_ms,
                )?;
                response.text.clone_from(actual);
                response.status = ConversationContentStatus::Complete;
                value.status = GenerationStatus::Complete;
            }
            GenerationOutcome::Failed { error } => {
                text(error, 2048)?;
                append_trace(
                    &tx,
                    &value.id,
                    ConversationTraceKind::Error,
                    error,
                    finish.finished_at_ms,
                )?;
                response.status = ConversationContentStatus::Failed;
                value.status = GenerationStatus::Failed;
                value.error = Some(error.clone());
            }
            GenerationOutcome::Cancelled => {
                response.status = ConversationContentStatus::Cancelled;
                value.status = GenerationStatus::Cancelled;
            }
        }
        value.finished_at_ms = Some(finish.finished_at_ms);
        response.content_revision = content_revision(&response.text);
        write_message(&tx, &response)?;
        write_generation(&tx, &value)?;
        tx.commit()?;
        Ok(value)
    }

    /// Call once on native runtime startup, before admitting workers. Opening a
    /// second store connection must not interrupt another connection's live job.
    pub fn interrupt_conversation_generations(&mut self) -> Result<u32, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute("UPDATE conversation_messages SET data=json_set(data,'$.status','interrupted') WHERE json_extract(data,'$.generationId') IN (SELECT id FROM conversation_generations WHERE active=1)", [])?;
        let count = tx.execute("UPDATE conversation_generations SET active=0,data=json_set(data,'$.status','interrupted') WHERE active=1", [])?;
        tx.commit()?;
        u32::try_from(count)
            .map_err(|_| invalid("Interrupted generation count exceeds native range"))
    }
}
