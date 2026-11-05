use crate::{
    analysis::{AnalysisInput, AnalysisSource},
    execution::{Cancellation, Failure},
    guest::{LanguageAction, Prepared},
    Runtime,
};
use mlearn_core::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[cfg(test)]
#[path = "conversation_tests.rs"]
mod tests;

impl Runtime {
    pub(super) fn prepare_conversation(
        &mut self,
        command: ConversationCommand,
        cancellation: Cancellation,
    ) -> Result<Prepared, Failure> {
        match command {
            ConversationCommand::AnalyzeMessageSource { source } => {
                cancellation.check()?;
                let (conversation, message) = self.validate_message_anchor(&source, false)?;
                let key = format!(
                    "{}|frozen-message|{}|{}|{}",
                    conversation.id.0, message.id.0, message.revision, message.content_revision
                );
                let input = self.analysis_input(
                    AnalysisSource::Conversation {
                        conversation,
                        package_version: source.package_version.clone(),
                        messages: vec![message],
                        original: Some(source),
                    },
                    key,
                )?;
                let package = input.package_id().to_owned();
                self.language_work(&package, LanguageAction::Analyze(input), cancellation)
            }
            ConversationCommand::AnalyzeVisibleMessages {
                conversation_id,
                messages,
            } => {
                cancellation.check()?;
                let input = self.conversation_analysis_input(&conversation_id, &messages)?;
                let package = input.package_id().to_owned();
                self.language_work(&package, LanguageAction::Analyze(input), cancellation)
            }
            // Long-lived native I/O belongs to RuntimeExecutor's generation
            // owner, never to the synchronous Runtime/guest lock.
            ConversationCommand::SendTurn { .. }
            | ConversationCommand::RetryGeneration { .. }
            | ConversationCommand::CancelGeneration { .. }
            | ConversationCommand::SetSessionCredential { .. }
            | ConversationCommand::Explain { .. } => Err(Failure::Operation(
                "This action requires the native generation execution owner".into(),
            )),
            command => Ok(Prepared::Immediate(Box::new(Response::Conversation {
                result: self.conversation_content(&command, false)?,
            }))),
        }
    }

    pub(super) fn conversation_content(
        &mut self,
        command: &ConversationCommand,
        credential_ready: bool,
    ) -> Result<ConversationResult, Failure> {
        if let ConversationCommand::CreateConversation { conversation, .. }
        | ConversationCommand::UpdateConversation { conversation, .. } = command
        {
            let package = self
                .installed
                .get(&conversation.package_id)
                .ok_or_else(|| Failure::Operation("Select an installed language package".into()))?;
            if !package
                .manifest
                .capabilities
                .iter()
                .any(|value| value == "text.analyze.v1")
            {
                return Err(Failure::Operation(
                    "The selected package does not analyze text".into(),
                ));
            }
        }
        if let ConversationCommand::SendTurn { turn } = command {
            for source in &turn.sources {
                self.validate_capture_source(source)?;
            }
        }
        if let ConversationCommand::Explain { source, .. } = command {
            self.validate_capture_source(source)?;
        }
        self.store
            .conversation_command(command, credential_ready)
            .map_err(|error| {
                let code = if matches!(error, mlearn_storage::StorageError::Conflict) {
                    "conflict"
                } else {
                    "invalid_conversation"
                };
                Failure::Protocol(code, error.to_string())
            })
    }

    fn conversation_analysis_input(
        &self,
        id: &ConversationId,
        references: &[MessageReference],
    ) -> Result<AnalysisInput, Failure> {
        if references.is_empty()
            || references.len() > 8
            || references
                .iter()
                .map(|item| &item.id.0)
                .collect::<BTreeSet<_>>()
                .len()
                != references.len()
        {
            return Err(Failure::Operation(
                "Choose 1–8 distinct visible messages".into(),
            ));
        }
        let conversation = self
            .store
            .read_conversation(id)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        if conversation.discarded {
            return Err(Failure::Operation(
                "This temporary Thread was discarded".into(),
            ));
        }
        let package_version = self
            .installed
            .get(&conversation.package_id)
            .ok_or_else(|| {
                Failure::Operation(
                    "Install the conversation's language package to inspect messages".into(),
                )
            })?
            .manifest
            .version
            .clone();
        let messages = references
            .iter()
            .map(|reference| {
                let message = self
                    .store
                    .read_conversation_message(&reference.id)
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                if message.conversation_id != *id
                    || message.revision != reference.revision
                    || message.status != ConversationContentStatus::Complete
                {
                    return Err(Failure::Operation(
                        "Message changed; refresh its analysis".into(),
                    ));
                }
                Ok(message)
            })
            .collect::<Result<Vec<_>, Failure>>()?;
        if messages
            .iter()
            .map(|message| message.text.len())
            .sum::<usize>()
            > 8192
        {
            return Err(Failure::Operation(
                "Visible-message analysis exceeds 8 KiB".into(),
            ));
        }
        let identities = messages
            .iter()
            .map(|message| (&message.id, message.revision, &message.content_revision))
            .collect::<Vec<_>>();
        let encoded = serde_json::to_vec(&identities)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let key = format!("{}|messages|{:x}", id.0, Sha256::digest(encoded));
        self.analysis_input(
            AnalysisSource::Conversation {
                conversation,
                package_version,
                messages,
                original: None,
            },
            key,
        )
    }

    pub(super) fn validate_message_anchor(
        &self,
        anchor: &SourceAnchor,
        capture: bool,
    ) -> Result<(Conversation, ConversationMessage), Failure> {
        let SourceLocator::Message {
            conversation_id,
            message_id,
            message_revision,
            context_start,
            selection_start,
            selection_end,
        } = &anchor.locator
        else {
            return Err(Failure::Operation(
                "Expected a message source location".into(),
            ));
        };
        let conversation = self
            .store
            .read_conversation(conversation_id)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let message = self
            .store
            .read_message_version(message_id, *message_revision)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let context = usize::try_from(*context_start)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let start = usize::try_from(*selection_start)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let end = usize::try_from(*selection_end)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let original = context
            .checked_add(anchor.text.len())
            .and_then(|end| message.text.get(context..end));
        if anchor.source_id != conversation_id.0
            || message.conversation_id != *conversation_id
            || message.content_revision != anchor.content_revision
            || original != Some(anchor.text.as_str())
            || start >= end
            || anchor.text.get(start..end).is_none()
            || message.status != ConversationContentStatus::Complete
        {
            return Err(Failure::Operation(
                "The original message selection is unavailable".into(),
            ));
        }
        if capture {
            let current = self
                .store
                .read_conversation_message(message_id)
                .map_err(|error| Failure::Operation(error.to_string()))?;
            let package = self.installed.get(&anchor.package_id).ok_or_else(|| {
                Failure::Operation("The message language package is unavailable".into())
            })?;
            if conversation.discarded
                || conversation.package_id != anchor.package_id
                || package.manifest.version != anchor.package_version
                || current.revision != message.revision
                || current.content_revision != message.content_revision
                || current.status != ConversationContentStatus::Complete
            {
                return Err(Failure::Operation(
                    "Message context changed; inspect it again before capture".into(),
                ));
            }
        }
        Ok((conversation, message))
    }
}
