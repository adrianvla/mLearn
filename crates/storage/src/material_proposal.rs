use crate::{
    ProfileStore, StorageError,
    material::{create_in_transaction, update_in_transaction},
    material_read::read_material,
    material_validation::{bounded, content},
};
use mlearn_core::*;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) fn migrate(db: &Connection) -> Result<(), StorageError> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS material_proposals(
            id TEXT PRIMARY KEY,package_id TEXT NOT NULL,pending INTEGER NOT NULL,
            document TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS material_proposals_scope ON material_proposals(package_id,pending,id);
         CREATE INDEX IF NOT EXISTS material_proposals_pending ON material_proposals(pending,id);
         CREATE TABLE IF NOT EXISTS material_proposal_receipts(
            command_id TEXT PRIMARY KEY,digest BLOB NOT NULL,proposal_id TEXT NOT NULL,
            document TEXT NOT NULL);
         PRAGMA user_version=18;",
    )?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct Receipt {
    revision: u32,
    acceptance: Option<MaterialProposalAcceptance>,
}

fn read(db: &Connection, id: &MaterialProposalId) -> Result<MaterialProposal, StorageError> {
    bounded(&id.0, 128)?;
    let document: String = db.query_row(
        "SELECT document FROM material_proposals WHERE id=?1",
        [&id.0],
        |row| crate::document_validation::json(row, 0, 131072),
    )?;
    Ok(serde_json::from_str(&document)?)
}

fn previous(
    db: &Connection,
    command: &str,
    digest: &[u8],
) -> Result<Option<MaterialProposalReceipt>, StorageError> {
    let value: Option<(Vec<u8>, String, String)> = db.query_row(
        "SELECT digest,proposal_id,document FROM material_proposal_receipts WHERE command_id=?1",
        [command], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;
    value
        .map(|(old, id, document)| {
            if old != digest {
                return Err(StorageError::Invalid(
                    "Proposal command identity reused for different content".into(),
                ));
            }
            let receipt: Receipt = serde_json::from_str(&document)?;
            Ok(MaterialProposalReceipt {
                command_id: command.into(),
                proposal: read(db, &MaterialProposalId(id))?,
                committed_revision: receipt.revision,
                acceptance: receipt.acceptance,
            })
        })
        .transpose()
}

fn persist(
    db: &Connection,
    command: &str,
    digest: &[u8],
    proposal: MaterialProposal,
    acceptance: Option<MaterialProposalAcceptance>,
) -> Result<MaterialProposalReceipt, StorageError> {
    let pending = matches!(proposal.state, MaterialProposalState::Pending);
    db.execute(
        "INSERT INTO material_proposals VALUES(?1,?2,?3,?4)
         ON CONFLICT(id) DO UPDATE SET pending=excluded.pending,document=excluded.document",
        params![
            proposal.id.0,
            proposal.content.package_id,
            pending,
            serde_json::to_string(&proposal)?
        ],
    )?;
    db.execute(
        "INSERT INTO material_proposal_receipts VALUES(?1,?2,?3,?4)",
        params![
            command,
            digest,
            proposal.id.0,
            serde_json::to_string(&Receipt {
                revision: proposal.revision,
                acceptance: acceptance.clone(),
            })?
        ],
    )?;
    Ok(MaterialProposalReceipt {
        command_id: command.into(),
        committed_revision: proposal.revision,
        proposal,
        acceptance,
    })
}

fn draft(value: &MaterialContent, replaces: bool) -> Result<(), StorageError> {
    let encoded = content(value)?;
    if value.source.is_none() && !replaces || !value.attachments.is_empty() || encoded.len() > 65536
    {
        return Err(StorageError::Invalid(
            "A proposal needs bounded source-grounded text; media remains owned by its source or existing Material".into(),
        ));
    }
    if !replaces
        && value
            .source
            .as_ref()
            .is_some_and(|source| source.package_id != value.package_id)
    {
        return Err(StorageError::Invalid(
            "Proposal source belongs to another language package".into(),
        ));
    }
    Ok(())
}

pub(super) fn suggest(
    db: &Connection,
    command: &MaterialSuggestion,
    generation: Option<&GenerationId>,
) -> Result<MaterialProposalReceipt, StorageError> {
    bounded(&command.command_id, 128)?;
    let payload = match generation {
        None => serde_json::to_vec(&("suggest", command))?,
        Some(id) => serde_json::to_vec(&("generated", command, id))?,
    };
    let digest = Sha256::digest(payload);
    if let Some(receipt) = previous(db, &command.command_id, &digest)? {
        return Ok(receipt);
    }
    draft(&command.content, command.replaces.is_some())?;
    if let Some(reference) = &command.replaces {
        let original = read_material(db, &reference.id)?;
        if original.revision != reference.revision {
            return Err(StorageError::Conflict);
        }
        let mut identity = original.content;
        identity.attachments.clear();
        identity.phrase.clone_from(&command.content.phrase);
        identity.reading.clone_from(&command.content.reading);
        identity.meaning.clone_from(&command.content.meaning);
        identity.context.clone_from(&command.content.context);
        identity.notes.clone_from(&command.content.notes);
        identity.examples.clone_from(&command.content.examples);
        if identity != command.content {
            return Err(StorageError::Invalid(
                "A replacement proposal cannot change source or dictionary identity".into(),
            ));
        }
    }
    let count: u32 = db.query_row(
        "SELECT COUNT(*) FROM material_proposals WHERE pending=1",
        [],
        |row| row.get(0),
    )?;
    if count >= 128 {
        return Err(StorageError::Invalid(
            "Review pending Material proposals before adding more".into(),
        ));
    }
    let proposal = MaterialProposal {
        id: MaterialProposalId(format!(
            "proposal-{:x}",
            Sha256::digest(command.command_id.as_bytes())
        )),
        revision: 1,
        content: command.content.clone(),
        replaces: command.replaces.clone(),
        generation_id: generation.cloned(),
        state: MaterialProposalState::Pending,
    };
    persist(db, &command.command_id, &digest, proposal, None)
}

impl ProfileStore {
    pub fn material_proposal(
        &self,
        id: &MaterialProposalId,
    ) -> Result<MaterialProposal, StorageError> {
        read(&self.connection, id)
    }

    pub fn material_proposal_suggestion_receipt(
        &self,
        command: &MaterialSuggestion,
    ) -> Result<Option<MaterialProposalReceipt>, StorageError> {
        bounded(&command.command_id, 128)?;
        let digest = Sha256::digest(serde_json::to_vec(&("suggest", command))?);
        previous(&self.connection, &command.command_id, &digest)
    }

    pub fn suggest_material(
        &mut self,
        command: &MaterialSuggestion,
    ) -> Result<MaterialProposalReceipt, StorageError> {
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let receipt = suggest(&tx, command, None)?;
        tx.commit()?;
        Ok(receipt)
    }

    pub fn material_proposal_review_receipt(
        &self,
        command: &MaterialProposalReview,
    ) -> Result<Option<MaterialProposalReceipt>, StorageError> {
        bounded(&command.command_id, 128)?;
        let digest = Sha256::digest(serde_json::to_vec(&("review", command))?);
        previous(&self.connection, &command.command_id, &digest)
    }

    pub fn review_material_proposal(
        &mut self,
        command: &MaterialProposalReview,
    ) -> Result<MaterialProposalReceipt, StorageError> {
        bounded(&command.command_id, 128)?;
        let digest = Sha256::digest(serde_json::to_vec(&("review", command))?);
        let tx = self
            .connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(receipt) = previous(&tx, &command.command_id, &digest)? {
            return Ok(receipt);
        }
        let mut proposal = read(&tx, &command.id)?;
        if proposal.revision != command.expected_revision
            || !matches!(proposal.state, MaterialProposalState::Pending)
        {
            return Err(StorageError::Conflict);
        }
        let acceptance = match &command.decision {
            MaterialProposalDecision::Edit { patch } => {
                patch.apply_to(&mut proposal.content);
                draft(&proposal.content, proposal.replaces.is_some())?;
                None
            }
            MaterialProposalDecision::Reject => {
                proposal.state = MaterialProposalState::Rejected;
                None
            }
            MaterialProposalDecision::Accept { distinct } => {
                let write_id = format!(
                    "proposal-accept:{:x}",
                    Sha256::digest(command.command_id.as_bytes())
                );
                let outcome = match &proposal.replaces {
                    Some(reference) => {
                        if *distinct {
                            return Err(StorageError::Invalid(
                                "A replacement updates its original Material, not a distinct copy"
                                    .into(),
                            ));
                        }
                        let original = read_material(&tx, &reference.id)?;
                        let mut content = proposal.content.clone();
                        content.attachments = original.content.attachments;
                        update_in_transaction(
                            &tx,
                            &MaterialEdit {
                                command_id: write_id,
                                id: reference.id.clone(),
                                expected_revision: reference.revision,
                                content,
                                excluded: original.excluded,
                                media_imports: Vec::new(),
                            },
                            &[],
                        )?
                    }
                    None => create_in_transaction(
                        &tx,
                        &MaterialCreate {
                            command_id: write_id,
                            content: proposal.content.clone(),
                            distinct: *distinct,
                            media_imports: Vec::new(),
                        },
                        &[],
                    )?,
                };
                Some(match outcome {
                    MaterialWriteResult::Saved {
                        material,
                        reused,
                        committed_revision,
                    } => {
                        proposal.state = MaterialProposalState::Accepted {
                            material_id: material.id.clone(),
                            committed_revision,
                        };
                        MaterialProposalAcceptance::Saved {
                            material_id: material.id,
                            committed_revision,
                            reused,
                        }
                    }
                    MaterialWriteResult::Duplicate { items } => {
                        MaterialProposalAcceptance::Duplicate {
                            material_ids: items.into_iter().map(|item| item.id).collect(),
                        }
                    }
                })
            }
        };
        proposal.revision = proposal
            .revision
            .checked_add(1)
            .ok_or_else(|| StorageError::Invalid("Proposal revision exhausted".into()))?;
        let receipt = persist(&tx, &command.command_id, &digest, proposal, acceptance)?;
        tx.commit()?;
        Ok(receipt)
    }

    pub fn material_proposals(
        &self,
        query: &MaterialProposalQuery,
    ) -> Result<MaterialProposalPage, StorageError> {
        if let Some(id) = &query.after {
            bounded(&id.0, 128)?;
        }
        if let Some(package) = &query.package_id {
            bounded(package, 512)?;
        }
        let mut statement = self.connection.prepare(
            "SELECT document FROM material_proposals
             WHERE (?1 IS NULL OR id>?1) AND (?2 IS NULL OR package_id=?2)
             AND (?3=0 OR pending=1) ORDER BY id LIMIT 13",
        )?;
        let rows = statement.query_map(
            params![
                query.after.as_ref().map(|id| &id.0),
                query.package_id,
                query.pending_only
            ],
            |row| crate::document_validation::json(row, 0, 131072),
        )?;
        let mut items: Vec<MaterialProposal> = Vec::new();
        let mut bytes = 0;
        let mut next = None;
        for row in rows {
            let document = row?;
            if items.len() >= 12 || bytes + document.len() > 196608 {
                next = items.last().map(|item| item.id.clone());
                break;
            }
            bytes += document.len();
            items.push(serde_json::from_str(&document)?);
        }
        Ok(MaterialProposalPage { items, next })
    }
}
