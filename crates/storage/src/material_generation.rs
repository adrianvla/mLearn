use crate::{
    ProfileStore, StorageError,
    conversation::{assistant, persist_conversation},
    conversation_read::{generation, id, invalid, message, text},
    material_read::read_material,
};
use mlearn_core::*;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize)]
struct Batch {
    command_id: String,
    replaces: Option<MaterialReference>,
    label: String,
    maximum: u8,
    collected: bool,
    proposal_ids: Vec<MaterialProposalId>,
    errors: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Input {
    instruction: String,
    maximum: u8,
    seed: MaterialContent,
    response_format: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Candidate {
    quote: String,
    #[serde(default)]
    occurrence: usize,
    reading: String,
    meaning: String,
    notes: String,
    examples: Vec<String>,
}

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS material_generations(
            id TEXT PRIMARY KEY REFERENCES conversation_generations(id),document TEXT NOT NULL);
         PRAGMA user_version=19;",
    )?;
    Ok(())
}

fn selection(source: &SourceAnchor) -> (u32, u32) {
    match &source.locator {
        SourceLocator::Video {
            selection_start,
            selection_end,
            ..
        }
        | SourceLocator::Document {
            selection_start,
            selection_end,
            ..
        }
        | SourceLocator::Image {
            selection_start,
            selection_end,
            ..
        }
        | SourceLocator::Message {
            selection_start,
            selection_end,
            ..
        } => (*selection_start, *selection_end),
    }
}

fn selected(source: &SourceAnchor) -> Result<&str, StorageError> {
    let (start, end) = selection(source);
    source
        .text
        .get(
            usize::try_from(start).map_err(|_| invalid("Invalid selection start"))?
                ..usize::try_from(end).map_err(|_| invalid("Invalid selection end"))?,
        )
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid("Choose a nonempty UTF-8 source selection"))
}

pub(super) fn admit(
    db: &Connection,
    command: &MaterialGenerationStart,
) -> Result<ConversationGeneration, StorageError> {
    id(&command.command_id)?;
    text(&command.instruction, 2048)?;
    if !(1..=8).contains(&command.maximum) {
        return Err(invalid("Request 1–8 Material proposals"));
    }
    let (mut seed, replaces, sources) = match &command.basis {
        MaterialGenerationBasis::Source { source } => (
            MaterialContent {
                package_id: source.package_id.clone(),
                target_id: None,
                package_revision: None,
                sense: None,
                phrase: selected(source)?.into(),
                reading: String::new(),
                meaning: String::new(),
                context: source.text.clone(),
                notes: String::new(),
                examples: Vec::new(),
                source: Some(source.clone()),
                attachments: Vec::new(),
            },
            None,
            vec![source.clone()],
        ),
        MaterialGenerationBasis::Material { material } => {
            let original = read_material(db, &material.id)?;
            if original.revision != material.revision {
                return Err(StorageError::Conflict);
            }
            (original.content, Some(material.clone()), Vec::new())
        }
    };
    seed.attachments.clear();
    crate::material_validation::content(&seed)?;
    let input = Input {
        instruction: command.instruction.clone(), maximum: command.maximum, seed: seed.clone(),
        response_format: "Return only newline-delimited JSON objects with quote, occurrence (zero-based), reading, meaning, notes and examples (array of strings). Each quote must occur literally in the selected source text. For existing Material use its exact phrase and occurrence 0. Do not invent dictionary IDs, source coordinates, learner evidence or proficiency. Each line is an independent editable proposal, not an accepted change.".into(),
    };
    let input = serde_json::to_string(&input)?;
    if input.len() > CONVERSATION_TEXT_BYTES {
        return Err(invalid(
            "Generation input exceeds 8 KiB; choose a smaller source excerpt or authored item",
        ));
    }
    let participant = assistant(db)?;
    let digest = format!("{:x}", Sha256::digest(command.command_id.as_bytes()));
    let owner = Conversation {
        id: ConversationId(format!("material-thread-{digest}")), revision: 1,
        kind: ConversationKind::Thread, title: "Material proposals".into(),
        purpose: "Propose source-grounded authored Material as newline-delimited JSON for explicit learner review. No tools or learner assessment.".into(),
        package_id: seed.package_id, participants: vec![participant.clone()], discarded: false,
    };
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM conversations WHERE id=?1)",
        [&owner.id.0],
        |row| row.get(0),
    )?;
    if exists {
        return Err(StorageError::Conflict);
    }
    persist_conversation(db, &owner)?;
    let generation = crate::conversation_generation::admit(
        db,
        &ConversationTurn {
            command_id: command.command_id.clone(),
            conversation_id: owner.id,
            expected_revision: owner.revision,
            user_message_id: MessageId(format!("material-user-{digest}")),
            assistant_message_id: MessageId(format!("material-answer-{digest}")),
            generation_id: GenerationId(format!("material-generation-{digest}")),
            participant_id: participant,
            text: input,
            reply_to: None,
            sources,
        },
    )?;
    let batch = Batch {
        command_id: command.command_id.clone(),
        replaces,
        label: seed.phrase,
        maximum: command.maximum,
        collected: false,
        proposal_ids: Vec::new(),
        errors: Vec::new(),
    };
    db.execute(
        "INSERT INTO material_generations VALUES(?1,?2)",
        params![generation.id.0, serde_json::to_string(&batch)?],
    )?;
    Ok(generation)
}

fn batch(db: &Connection, key: &GenerationId) -> Result<Batch, StorageError> {
    id(&key.0)?;
    let data: String = db.query_row(
        "SELECT document FROM material_generations WHERE id=?1",
        [&key.0],
        |row| crate::document_validation::json(row, 0, 16384),
    )?;
    Ok(serde_json::from_str(&data)?)
}

fn seed(db: &Connection, value: &ConversationGeneration) -> Result<MaterialContent, StorageError> {
    let input: Input = serde_json::from_str(&message(db, &value.user_message_id)?.text)?;
    Ok(input.seed)
}

fn report(db: &Connection, key: &GenerationId) -> Result<MaterialGenerationReport, StorageError> {
    let batch = batch(db, key)?;
    Ok(MaterialGenerationReport {
        command_id: batch.command_id,
        generation: generation(db, key)?,
        label: batch.label,
        maximum: batch.maximum,
        collected: batch.collected,
        proposal_ids: batch.proposal_ids,
        errors: batch.errors,
    })
}

pub(super) fn copy_retry(
    db: &Connection,
    previous: &GenerationId,
    next: &GenerationId,
) -> Result<(), StorageError> {
    let exists: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM material_generations WHERE id=?1)",
        [&previous.0],
        |row| row.get(0),
    )?;
    if exists {
        let mut batch = batch(db, previous)?;
        batch.collected = false;
        batch.proposal_ids.clear();
        batch.errors.clear();
        db.execute(
            "INSERT INTO material_generations VALUES(?1,?2)",
            params![next.0, serde_json::to_string(&batch)?],
        )?;
    }
    Ok(())
}

fn candidate(
    seed: &MaterialContent,
    replaces: bool,
    candidate: Candidate,
) -> Result<MaterialContent, StorageError> {
    let mut content = seed.clone();
    content.reading = candidate.reading;
    content.meaning = candidate.meaning;
    content.notes = candidate.notes;
    content.examples = candidate.examples;
    if replaces {
        if candidate.quote != seed.phrase || candidate.occurrence != 0 {
            return Err(invalid("Generated replacement changed its original phrase"));
        }
    } else {
        if candidate.quote.trim().is_empty() || candidate.quote.len() > 2048 {
            return Err(invalid("Generated quote is empty or exceeds its bound"));
        }
        let source = content
            .source
            .as_mut()
            .ok_or_else(|| invalid("Missing original source"))?;
        let text = selected(source)?;
        let (offset, quote) = text
            .match_indices(&candidate.quote)
            .nth(candidate.occurrence)
            .ok_or_else(|| {
                invalid("Generated quote does not identify an occurrence in the selected source")
            })?;
        let (origin, _) = selection(source);
        let start = origin
            .checked_add(u32::try_from(offset).map_err(|_| invalid("Quote offset exceeds range"))?)
            .ok_or_else(|| invalid("Quote offset exceeds range"))?;
        let end = start
            .checked_add(u32::try_from(quote.len()).map_err(|_| invalid("Quote exceeds range"))?)
            .ok_or_else(|| invalid("Quote exceeds range"))?;
        match &mut source.locator {
            SourceLocator::Video {
                selection_start,
                selection_end,
                ..
            }
            | SourceLocator::Document {
                selection_start,
                selection_end,
                ..
            }
            | SourceLocator::Image {
                selection_start,
                selection_end,
                ..
            }
            | SourceLocator::Message {
                selection_start,
                selection_end,
                ..
            } => {
                *selection_start = start;
                *selection_end = end;
            }
        }
        content.phrase = candidate.quote;
    }
    Ok(content)
}

impl ProfileStore {
    pub fn material_generation_basis(
        &self,
        key: &GenerationId,
    ) -> Result<Option<MaterialGenerationBasis>, StorageError> {
        id(&key.0)?;
        let exists: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM material_generations WHERE id=?1)",
            [&key.0],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(None);
        }
        let batch = batch(&self.connection, key)?;
        Ok(Some(match batch.replaces {
            Some(material) => MaterialGenerationBasis::Material { material },
            None => MaterialGenerationBasis::Source {
                source: seed(&self.connection, &generation(&self.connection, key)?)?
                    .source
                    .ok_or_else(|| invalid("Generated proposals lost their original source"))?,
            },
        }))
    }

    pub fn material_generation(
        &self,
        key: &GenerationId,
    ) -> Result<MaterialGenerationReport, StorageError> {
        report(&self.connection, key)
    }

    pub fn material_generations(
        &self,
        after: Option<&GenerationId>,
    ) -> Result<MaterialGenerationPage, StorageError> {
        if let Some(key) = after {
            id(&key.0)?;
        }
        let mut statement = self.connection.prepare(
            "SELECT id FROM material_generations WHERE (?1 IS NULL OR id>?1) ORDER BY id LIMIT 13",
        )?;
        let keys = statement
            .query_map([after.map(|key| &key.0)], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let items = keys
            .iter()
            .take(12)
            .map(|key| report(&self.connection, &GenerationId(key.clone())))
            .collect::<Result<Vec<_>, _>>()?;
        let next = if keys.len() > 12 {
            items.last().map(|item| item.generation.id.clone())
        } else {
            None
        };
        Ok(MaterialGenerationPage { items, next })
    }

    pub fn collect_material_generation(
        &mut self,
        key: &GenerationId,
    ) -> Result<MaterialGenerationReport, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut batch = batch(&tx, key)?;
        if batch.collected {
            return report(&tx, key);
        }
        let generation = generation(&tx, key)?;
        match generation.status {
            GenerationStatus::Complete
            | GenerationStatus::Failed
            | GenerationStatus::Interrupted => {}
            GenerationStatus::Pending
            | GenerationStatus::Streaming
            | GenerationStatus::Cancelled
            | GenerationStatus::Invalidated => {
                return Err(invalid(
                    "Only finished, failed or interrupted generation can produce reviewable drafts",
                ));
            }
        }
        let seed = seed(&tx, &generation)?;
        if let Some(reference) = &batch.replaces {
            if read_material(&tx, &reference.id)?.revision != reference.revision {
                return Err(StorageError::Conflict);
            }
        }
        let response = message(&tx, &generation.assistant_message_id)?;
        for (index, line) in response
            .text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .enumerate()
        {
            if index >= usize::from(batch.maximum) {
                batch
                    .errors
                    .push("The provider returned more candidates than requested".into());
                break;
            }
            let parsed = match serde_json::from_str::<Candidate>(line) {
                Ok(value) => value,
                Err(_) => {
                    batch
                        .errors
                        .push(format!("Candidate {}: invalid generated JSON", index + 1));
                    continue;
                }
            };
            let proposed = candidate(&seed, batch.replaces.is_some(), parsed).and_then(|content| {
                crate::material_proposal::suggest(
                    &tx,
                    &MaterialSuggestion {
                        command_id: format!(
                            "native:material:{:x}",
                            Sha256::digest(format!("{}:{index}", key.0))
                        ),
                        content,
                        replaces: batch.replaces.clone(),
                    },
                    Some(key),
                )
            });
            match proposed {
                Ok(receipt) => batch.proposal_ids.push(receipt.proposal.id),
                Err(StorageError::Invalid(error)) => batch.errors.push(format!(
                    "Candidate {}: {}",
                    index + 1,
                    error.chars().take(256).collect::<String>()
                )),
                Err(error) => return Err(error),
            }
        }
        if batch.proposal_ids.is_empty() && batch.errors.is_empty() {
            batch
                .errors
                .push("The provider returned no complete proposals".into());
        }
        batch.collected = true;
        tx.execute(
            "UPDATE material_generations SET document=?2 WHERE id=?1",
            params![key.0, serde_json::to_string(&batch)?],
        )?;
        let result = report(&tx, key)?;
        tx.commit()?;
        Ok(result)
    }
}
