use crate::{conversation_read::*, ProfileStore, StorageError};
use mlearn_core::*;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversation_contacts(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=12288));
         CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=8192),direct_key TEXT UNIQUE);
         CREATE TABLE IF NOT EXISTS conversation_participants(conversation_id TEXT NOT NULL REFERENCES conversations(id),contact_id TEXT NOT NULL REFERENCES conversation_contacts(id),PRIMARY KEY(conversation_id,contact_id));
         CREATE TABLE IF NOT EXISTS conversation_drafts(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=16384));
         CREATE TABLE IF NOT EXISTS conversation_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),sequence INTEGER NOT NULL,data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=32768),UNIQUE(conversation_id,sequence));
         CREATE TABLE IF NOT EXISTS conversation_message_versions(message_id TEXT NOT NULL REFERENCES conversation_messages(id),revision INTEGER NOT NULL,data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=32768),PRIMARY KEY(message_id,revision));
         CREATE TABLE IF NOT EXISTS conversation_generations(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=8192),active INTEGER NOT NULL CHECK(active IN (0,1)),delta_sequence INTEGER NOT NULL DEFAULT 0,trace_sequence INTEGER NOT NULL DEFAULT 0);
         CREATE UNIQUE INDEX IF NOT EXISTS conversation_one_active ON conversation_generations(conversation_id) WHERE active=1;
         CREATE TABLE IF NOT EXISTS conversation_generation_inputs(generation_id TEXT NOT NULL REFERENCES conversation_generations(id),message_id TEXT NOT NULL REFERENCES conversation_messages(id),revision INTEGER NOT NULL,PRIMARY KEY(generation_id,message_id));
         CREATE TABLE IF NOT EXISTS conversation_generation_contacts(generation_id TEXT NOT NULL REFERENCES conversation_generations(id),contact_id TEXT NOT NULL REFERENCES conversation_contacts(id),revision INTEGER NOT NULL,PRIMARY KEY(generation_id,contact_id));
         CREATE TABLE IF NOT EXISTS conversation_traces(generation_id TEXT NOT NULL REFERENCES conversation_generations(id),sequence INTEGER NOT NULL,data TEXT NOT NULL CHECK(length(CAST(data AS BLOB))<=8192),PRIMARY KEY(generation_id,sequence));
         CREATE TABLE IF NOT EXISTS conversation_receipts(command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,result TEXT NOT NULL CHECK(length(CAST(result AS BLOB))<=65536));
         CREATE TABLE IF NOT EXISTS conversation_worker_receipts(command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,generation_id TEXT NOT NULL REFERENCES conversation_generations(id));
         CREATE TABLE IF NOT EXISTS conversation_provider(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
         INSERT OR IGNORE INTO conversation_provider VALUES(1,'{\"revision\":0,\"endpoint\":\"\",\"model\":\"\",\"sessionCredentialReady\":false}');
         PRAGMA user_version=9;",
    )?;
    Ok(())
}

pub(super) fn persist_conversation(
    db: &Connection,
    value: &Conversation,
) -> Result<(), StorageError> {
    validate_conversation(value)?;
    let direct_key = match value.kind {
        ConversationKind::Direct if !value.discarded => Some(serde_json::to_string(&(
            &value.package_id,
            &value.participants[0],
        ))?),
        ConversationKind::Direct | ConversationKind::Thread => None,
    };
    db.execute("INSERT INTO conversations(id,data,direct_key) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data,direct_key=excluded.direct_key",
        params![value.id.0, serde_json::to_string(value)?, direct_key])?;
    db.execute(
        "DELETE FROM conversation_participants WHERE conversation_id=?1",
        [&value.id.0],
    )?;
    for key in &value.participants {
        contact(db, key)?;
        db.execute(
            "INSERT INTO conversation_participants VALUES(?1,?2)",
            params![value.id.0, key.0],
        )?;
    }
    Ok(())
}

fn command_identity(command: &ConversationCommand) -> Option<&str> {
    match command {
        ConversationCommand::SaveContact { command_id, .. }
        | ConversationCommand::CreateConversation { command_id, .. }
        | ConversationCommand::UpdateConversation { command_id, .. }
        | ConversationCommand::DiscardConversation { command_id, .. }
        | ConversationCommand::SaveDraft { command_id, .. }
        | ConversationCommand::EditMessage { command_id, .. }
        | ConversationCommand::DeleteMessage { command_id, .. }
        | ConversationCommand::CancelGeneration { command_id, .. }
        | ConversationCommand::SaveProviderSettings { command_id, .. }
        | ConversationCommand::Explain { command_id, .. } => Some(command_id),
        ConversationCommand::SendTurn { turn } => Some(&turn.command_id),
        ConversationCommand::RetryGeneration { retry } => Some(&retry.command_id),
        ConversationCommand::GenerateMaterial { command } => Some(&command.command_id),
        ConversationCommand::ListContacts { .. }
        | ConversationCommand::GetContact { .. }
        | ConversationCommand::ListConversations { .. }
        | ConversationCommand::GetConversation { .. }
        | ConversationCommand::ReadMessages { .. }
        | ConversationCommand::ReadDraft { .. }
        | ConversationCommand::PrepareTurn { .. }
        | ConversationCommand::ReadGeneration { .. }
        | ConversationCommand::ReadTrace { .. }
        | ConversationCommand::ReadProviderSettings
        | ConversationCommand::SetSessionCredential { .. }
        | ConversationCommand::AnalyzeVisibleMessages { .. }
        | ConversationCommand::AnalyzeMessageSource { .. } => None,
    }
}

impl ProfileStore {
    /// Only content operations are executed here. Runtime handles credentials,
    /// analysis, shared source validation and worker start/cancellation.
    pub fn conversation_command(
        &mut self,
        command: &ConversationCommand,
        session_credential_ready: bool,
    ) -> Result<ConversationResult, StorageError> {
        if matches!(
            command,
            ConversationCommand::SetSessionCredential { .. }
                | ConversationCommand::AnalyzeVisibleMessages { .. }
                | ConversationCommand::AnalyzeMessageSource { .. }
        ) {
            return Err(invalid(
                "Conversation action requires the native runtime owner",
            ));
        }
        let command_id = command_identity(command);
        let encoded = serde_json::to_vec(command)?;
        if encoded.len() > 65536 {
            return Err(invalid("Conversation command exceeds 64 KiB"));
        }
        let digest = Sha256::digest(&encoded).to_vec();
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(key) = command_id {
            id(key)?;
            let worker_exists: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM conversation_worker_receipts WHERE command_id=?1)",
                [key],
                |r| r.get(0),
            )?;
            if worker_exists {
                return Err(invalid(
                    "Command identity belongs to a generation worker action",
                ));
            }
            let previous: Option<(Vec<u8>, String)> = tx
                .query_row(
                    "SELECT digest,result FROM conversation_receipts WHERE command_id=?1",
                    [key],
                    |r| Ok((r.get(0)?, crate::document_validation::json(r, 1, 65536)?)),
                )
                .optional()?;
            if let Some((previous, data)) = previous {
                if previous != digest {
                    return Err(invalid("Command identity reused for different contents"));
                }
                let result: ConversationResult = serde_json::from_str(&data)?;
                // Receipts do not restart workers or resurrect old publication state.
                return refresh(&tx, result, session_credential_ready);
            }
        }
        let result = execute(&tx, command, session_credential_ready)?;
        if let Some(key) = command_id {
            let mut receipt = result.clone();
            if let ConversationResult::ProviderSettings { settings } = &mut receipt {
                settings.session_credential_ready = false;
            }
            tx.execute(
                "INSERT INTO conversation_receipts VALUES(?1,?2,?3)",
                params![key, digest, serde_json::to_string(&receipt)?],
            )?;
        }
        tx.commit()?;
        Ok(result)
    }
}

fn refresh(
    db: &Connection,
    result: ConversationResult,
    ready: bool,
) -> Result<ConversationResult, StorageError> {
    Ok(match result {
        ConversationResult::Contact { contact: value } => ConversationResult::Contact {
            contact: contact(db, &value.id)?,
        },
        ConversationResult::Conversation {
            conversation: value,
        } => ConversationResult::Conversation {
            conversation: conversation(db, &value.id)?,
        },
        ConversationResult::Message { message: value } => ConversationResult::Message {
            message: message(db, &value.id)?,
        },
        ConversationResult::Draft { draft: value } => ConversationResult::Draft {
            draft: draft(db, &value.conversation_id)?,
        },
        ConversationResult::Generation { generation: value } => ConversationResult::Generation {
            generation: generation(db, &value.id)?,
        },
        ConversationResult::ProviderSettings { .. } => ConversationResult::ProviderSettings {
            settings: settings(db, ready)?,
        },
        ConversationResult::Contacts { .. }
        | ConversationResult::Conversations { .. }
        | ConversationResult::Messages { .. }
        | ConversationResult::Prepared { .. }
        | ConversationResult::Trace { .. }
        | ConversationResult::CredentialReady { .. }
        | ConversationResult::Analysis { .. } => {
            return Err(invalid("Invalid conversation mutation receipt"));
        }
    })
}

fn execute(
    db: &Connection,
    command: &ConversationCommand,
    ready: bool,
) -> Result<ConversationResult, StorageError> {
    use ConversationCommand as C;
    use ConversationResult as R;
    Ok(match command {
        C::ListContacts {
            after,
            query,
            archived,
        } => {
            text(query, 256)?;
            if let Some(after) = after {
                id(&after.0)?;
            }
            let mut stmt = db.prepare("SELECT id FROM conversation_contacts WHERE (?1 IS NULL OR id>?1) AND (?2 IS NULL OR json_extract(data,'$.archived')=?2) AND instr(lower(json_extract(data,'$.name')||' '||json_extract(data,'$.description')),lower(?3))>0 ORDER BY id LIMIT 31")?;
            let keys = stmt
                .query_map(
                    params![after.as_ref().map(|v| &v.0), archived, query],
                    |r| Ok(ContactId(crate::document_validation::json(r, 0, 128)?)),
                )?
                .collect::<Result<Vec<_>, _>>()?;
            let items = keys
                .iter()
                .take(CONVERSATION_LIST_LIMIT)
                .map(|k| contact(db, k))
                .collect::<Result<Vec<_>, _>>()?;
            let next = if keys.len() > CONVERSATION_LIST_LIMIT {
                items.last().map(|v| v.id.clone())
            } else {
                None
            };
            R::Contacts {
                page: ContactPage { items, next },
            }
        }
        C::GetContact { id: key } => R::Contact {
            contact: contact(db, key)?,
        },
        C::SaveContact {
            contact: value,
            expected_revision,
            ..
        } => {
            validate_contact(value)?;
            let previous: Option<u32> = db
                .query_row(
                    "SELECT json_extract(data,'$.revision') FROM conversation_contacts WHERE id=?1",
                    [&value.id.0],
                    |r| r.get(0),
                )
                .optional()?;
            if previous.unwrap_or(0) != *expected_revision || value.revision != *expected_revision {
                return Err(StorageError::Conflict);
            }
            let mut saved = value.clone();
            saved.revision = next(*expected_revision)?;
            db.execute("INSERT INTO conversation_contacts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![saved.id.0, serde_json::to_string(&saved)?])?;
            crate::conversation_generation::invalidate_contact(db, &saved.id)?;
            R::Contact { contact: saved }
        }
        C::ListConversations { after, query } => {
            text(query, 256)?;
            if let Some(after) = after {
                id(&after.0)?;
            }
            // Keep the timestamp's original JSON number; SQL double-to-JSON
            // conversion otherwise rounds fractional milliseconds.
            let mut stmt = db.prepare("SELECT id, (SELECT json_object('conversationId',m.conversation_id,'messageId',m.id,'text',CASE WHEN json_extract(m.data,'$.status')='deleted' THEN '' ELSE substr(json_extract(m.data,'$.text'),1,160) END,'createdAtMs',json(m.data -> '$.createdAtMs'),'status',json_extract(m.data,'$.status')) FROM conversation_messages m WHERE m.conversation_id=conversations.id ORDER BY m.sequence DESC LIMIT 1) FROM conversations WHERE json_extract(data,'$.discarded')=0 AND (?1 IS NULL OR id>?1) AND (instr(lower(json_extract(data,'$.title')||' '||json_extract(data,'$.purpose')),lower(?2))>0 OR EXISTS(SELECT 1 FROM conversation_messages m WHERE m.conversation_id=conversations.id AND json_extract(m.data,'$.status')='complete' AND instr(lower(json_extract(m.data,'$.text')),lower(?2))>0)) ORDER BY id LIMIT 31")?;
            let keys = stmt
                .query_map(params![after.as_ref().map(|v| &v.0), query], |r| {
                    Ok((
                        ConversationId(crate::document_validation::json(r, 0, 128)?),
                        r.get::<_, Option<String>>(1)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let items = keys
                .iter()
                .take(CONVERSATION_LIST_LIMIT)
                .map(|(key, _)| conversation(db, key))
                .collect::<Result<Vec<_>, _>>()?;
            let previews = keys
                .iter()
                .take(CONVERSATION_LIST_LIMIT)
                .filter_map(|(_, preview)| preview.as_ref())
                .map(|preview| serde_json::from_str::<ConversationPreview>(preview))
                .collect::<Result<Vec<_>, _>>()?;
            let next = if keys.len() > CONVERSATION_LIST_LIMIT {
                items.last().map(|v| v.id.clone())
            } else {
                None
            };
            R::Conversations {
                page: ConversationPage {
                    items,
                    previews,
                    next,
                },
            }
        }
        C::GetConversation { id: key } => R::Conversation {
            conversation: conversation(db, key)?,
        },
        C::CreateConversation {
            conversation: value,
            ..
        } => {
            validate_conversation(value)?;
            if value.revision != 0 || value.discarded {
                return Err(invalid(
                    "New conversation must have revision zero and be live",
                ));
            }
            if value.kind == ConversationKind::Direct {
                let key = serde_json::to_string(&(&value.package_id, &value.participants[0]))?;
                let existing: Option<String> = db
                    .query_row(
                        "SELECT id FROM conversations WHERE direct_key=?1",
                        [key],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(key) = existing {
                    return Ok(R::Conversation {
                        conversation: conversation(db, &ConversationId(key))?,
                    });
                }
            }
            let exists: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM conversations WHERE id=?1)",
                [&value.id.0],
                |r| r.get(0),
            )?;
            if exists {
                return Err(StorageError::Conflict);
            }
            let mut saved = value.clone();
            saved.revision = 1;
            persist_conversation(db, &saved)?;
            R::Conversation {
                conversation: saved,
            }
        }
        C::UpdateConversation {
            conversation: value,
            expected_revision,
            ..
        } => {
            validate_conversation(value)?;
            let previous = live_conversation(db, &value.id, *expected_revision)?;
            if value.kind != previous.kind
                || value.package_id != previous.package_id
                || value.discarded
                || value.revision != *expected_revision
            {
                return Err(invalid("Conversation kind/package cannot be changed"));
            }
            let mut saved = value.clone();
            saved.revision = next(previous.revision)?;
            crate::conversation_generation::invalidate_conversation(db, &saved.id)?;
            persist_conversation(db, &saved)?;
            R::Conversation {
                conversation: saved,
            }
        }
        C::DiscardConversation {
            id: key,
            expected_revision,
            ..
        } => {
            let mut value = live_conversation(db, key, *expected_revision)?;
            if value.kind != ConversationKind::Thread {
                return Err(invalid("Only temporary Threads can be discarded"));
            }
            crate::conversation_generation::invalidate_conversation(db, key)?;
            value.discarded = true;
            value.revision = next(value.revision)?;
            persist_conversation(db, &value)?;
            db.execute(
                "DELETE FROM conversation_drafts WHERE conversation_id=?1",
                [&key.0],
            )?;
            // Dispose authored Thread content, not retained Material or evidence.
            db.execute("UPDATE conversation_messages SET data=json_set(data,'$.text','','$.contentRevision',?2,'$.status','deleted','$.revision',json_extract(data,'$.revision')+1,'$.sources',json('[]')) WHERE conversation_id=?1", params![key.0, content_revision("")])?;
            db.execute("DELETE FROM conversation_traces WHERE generation_id IN (SELECT id FROM conversation_generations WHERE conversation_id=?1)", [&key.0])?;
            R::Conversation {
                conversation: value,
            }
        }
        C::ReadMessages {
            conversation_id,
            before,
            query,
        } => R::Messages {
            page: messages(db, conversation_id, *before, query)?,
        },
        C::ReadDraft { conversation_id } => R::Draft {
            draft: draft(db, conversation_id)?,
        },
        C::SaveDraft {
            draft: value,
            expected_revision,
            ..
        } => {
            let previous = draft(db, &value.conversation_id)?;
            if previous.revision != *expected_revision || value.revision != *expected_revision {
                return Err(StorageError::Conflict);
            }
            text(&value.text, CONVERSATION_TEXT_BYTES)?;
            check_reply(db, &value.conversation_id, &value.reply_to)?;
            let mut saved = value.clone();
            saved.revision = next(previous.revision)?;
            db.execute("INSERT INTO conversation_drafts VALUES(?1,?2) ON CONFLICT(conversation_id) DO UPDATE SET data=excluded.data", params![saved.conversation_id.0, serde_json::to_string(&saved)?])?;
            R::Draft { draft: saved }
        }
        C::EditMessage {
            message: reference,
            text: content,
            ..
        } => {
            text(content, CONVERSATION_TEXT_BYTES)?;
            if content.trim().is_empty() {
                return Err(invalid("Edited message is empty"));
            }
            R::Message {
                message: mutate_message(db, reference, Some(content))?,
            }
        }
        C::DeleteMessage {
            message: reference, ..
        } => R::Message {
            message: mutate_message(db, reference, None)?,
        },
        C::PrepareTurn {
            conversation_id,
            expected_revision,
        } => {
            let owner = live_conversation(db, conversation_id, *expected_revision)?;
            let (messages, truncated) = context(db, &owner, None)?;
            let people = participants(db, &owner)?;
            R::Prepared {
                conversation: owner,
                participants: people,
                messages,
                truncated,
            }
        }
        C::SendTurn { turn } => R::Generation {
            generation: crate::conversation_generation::admit(db, turn)?,
        },
        C::RetryGeneration { retry } => R::Generation {
            generation: crate::conversation_generation::retry(db, retry)?,
        },
        C::CancelGeneration { id: key, .. } => R::Generation {
            generation: crate::conversation_generation::cancel(db, key)?,
        },
        C::ReadGeneration { id: key } => R::Generation {
            generation: generation(db, key)?,
        },
        C::ReadTrace { id: key, after } => R::Trace {
            page: crate::conversation_generation::trace(db, key, *after)?,
        },
        C::ReadProviderSettings => R::ProviderSettings {
            settings: settings(db, ready)?,
        },
        C::SaveProviderSettings {
            expected_revision,
            endpoint: value,
            model,
            ..
        } => {
            endpoint(value)?;
            text(model, 256)?;
            let previous = settings(db, ready)?;
            if previous.revision != *expected_revision {
                return Err(StorageError::Conflict);
            }
            let mut saved = ConversationProviderSettings {
                revision: next(*expected_revision)?,
                endpoint: value.clone(),
                model: model.clone(),
                session_credential_ready: false,
            };
            db.execute(
                "UPDATE conversation_provider SET data=?1 WHERE id=1",
                [serde_json::to_string(&saved)?],
            )?;
            saved.session_credential_ready = ready;
            R::ProviderSettings { settings: saved }
        }
        C::Explain {
            command_id,
            source,
            instruction,
        } => R::Generation {
            generation: admit_explanation(db, command_id, source, instruction)?,
        },
        C::GenerateMaterial { command } => R::Generation {
            generation: crate::material_generation::admit(db, command)?,
        },
        C::SetSessionCredential { .. }
        | C::AnalyzeVisibleMessages { .. }
        | C::AnalyzeMessageSource { .. } => {
            return Err(invalid(
                "Conversation action requires the native runtime owner",
            ));
        }
    })
}

fn admit_explanation(
    db: &Connection,
    command_id: &str,
    source: &SourceAnchor,
    instruction: &str,
) -> Result<ConversationGeneration, StorageError> {
    // Runtime has already validated source identity/selection and provider
    // readiness. Only related content is admitted in this receipt transaction.
    let participant = assistant(db)?;
    let digest = format!("{:x}", Sha256::digest(command_id.as_bytes()));
    let owner = Conversation {
        id: ConversationId(format!("explanation-{digest}")),
        revision: 1,
        kind: ConversationKind::Thread,
        title: "Explanation".into(),
        purpose: "Explain the linked source in response to the user's instruction.".into(),
        package_id: source.package_id.clone(),
        participants: vec![participant.clone()],
        discarded: false,
    };
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM conversations WHERE id=?1)",
        [&owner.id.0],
        |r| r.get(0),
    )?;
    if exists {
        return Err(StorageError::Conflict);
    }
    persist_conversation(db, &owner)?;
    crate::conversation_generation::admit(
        db,
        &ConversationTurn {
            command_id: command_id.into(),
            conversation_id: owner.id,
            expected_revision: owner.revision,
            user_message_id: MessageId(format!("explanation-user-{digest}")),
            assistant_message_id: MessageId(format!("explanation-response-{digest}")),
            generation_id: GenerationId(format!("explanation-generation-{digest}")),
            participant_id: participant,
            text: instruction.into(),
            reply_to: None,
            sources: vec![source.clone()],
        },
    )
}

pub(super) fn assistant(db: &Connection) -> Result<ContactId, StorageError> {
    let participant = ContactId(CONVERSATION_EXPLANATION_CONTACT_ID.into());
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM conversation_contacts WHERE id=?1)",
        [&participant.0],
        |r| r.get(0),
    )?;
    if exists {
        if contact(db, &participant)?.archived {
            return Err(invalid(
                "Restore the archived Assistant contact before requesting generation",
            ));
        }
    } else {
        let assistant = Contact {
            id: participant.clone(),
            revision: 1,
            name: "Assistant".into(),
            description: "Software assistant for contextual language explanations.".into(),
            archived: false,
        };
        db.execute(
            "INSERT INTO conversation_contacts VALUES(?1,?2)",
            params![participant.0, serde_json::to_string(&assistant)?],
        )?;
    }
    Ok(participant)
}

fn mutate_message(
    db: &Connection,
    reference: &MessageReference,
    content: Option<&str>,
) -> Result<ConversationMessage, StorageError> {
    let mut value = message(db, &reference.id)?;
    let mut owner = conversation(db, &value.conversation_id)?;
    if owner.discarded
        || value.revision != reference.revision
        || value.status == ConversationContentStatus::Deleted
    {
        return Err(StorageError::Conflict);
    }
    if matches!(
        value.status,
        ConversationContentStatus::Pending | ConversationContentStatus::Partial
    ) {
        return Err(invalid(
            "Cancel active generation before editing its provisional response",
        ));
    }
    // An explicit authored correction is independent of subsequent regeneration.
    value.generation_id = None;
    value.text = content.unwrap_or("").into();
    value.content_revision = content_revision(&value.text);
    value.status = if content.is_some() {
        ConversationContentStatus::Complete
    } else {
        ConversationContentStatus::Deleted
    };
    value.revision = next(value.revision)?;
    value.sources.clear();
    write_message(db, &value)?;
    crate::conversation_generation::invalidate_message(db, &value.id)?;
    owner.revision = next(owner.revision)?;
    persist_conversation(db, &owner)?;
    Ok(value)
}
