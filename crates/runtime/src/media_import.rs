use crate::{Runtime, execution::Failure, material_media::asset_path};
use crate::{
    media_file::{copy_asset, same_bytes},
    media_recovery::MediaJournal,
};
use mlearn_core::{
    MaterialAttachment, MaterialCreate, MaterialEdit, MaterialMediaImport, MaterialMediaKind,
    MaterialWriteResult, MediaSegment,
};
use mlearn_storage::PreparedAuthoredMedia;
use std::{fs, io::Write, path::PathBuf};

const IMPORT_BYTES: u64 = 256 * 1024 * 1024;

pub(super) struct PreparedFiles {
    pub directory: Option<PathBuf>,
    pub media: Vec<PreparedAuthoredMedia>,
}

impl Runtime {
    pub(super) fn write_material_create(
        &mut self,
        command: &MaterialCreate,
    ) -> Result<MaterialWriteResult, Failure> {
        if let Some(receipt) = self
            .store
            .material_create_receipt(command)
            .map_err(|e| Failure::Operation(e.to_string()))?
        {
            return Ok(receipt);
        }
        self.validate_attachment_origins(&command.content.attachments, &[])?;
        let prepared = self.prepare_media_files(&command.media_imports)?;
        let result = self
            .store
            .create_material_prepared(command, &prepared.media)
            .map_err(|e| Failure::Operation(e.to_string()));
        self.finish_media_write(prepared, result)
    }

    pub(super) fn write_material_edit(
        &mut self,
        command: &MaterialEdit,
    ) -> Result<MaterialWriteResult, Failure> {
        if let Some(receipt) = self
            .store
            .material_edit_receipt(command)
            .map_err(|e| Failure::Operation(e.to_string()))?
        {
            return Ok(receipt);
        }
        let current = self
            .store
            .material(&command.id)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        if current.revision != command.expected_revision {
            return Err(Failure::Protocol(
                "conflict",
                "Material changed elsewhere; reload before saving".into(),
            ));
        }
        self.validate_attachment_origins(
            &command.content.attachments,
            &current.content.attachments,
        )?;
        let prepared = self.prepare_media_files(&command.media_imports)?;
        let result = self
            .store
            .update_material_prepared(command, &prepared.media)
            .map_err(|error| match error {
                mlearn_storage::StorageError::Conflict => Failure::Protocol(
                    "conflict",
                    "Material changed elsewhere; reload before saving".into(),
                ),
                error => Failure::Operation(error.to_string()),
            });
        self.finish_media_write(prepared, result)
    }

    fn prepare_media_files(
        &self,
        imports: &[MaterialMediaImport],
    ) -> Result<PreparedFiles, Failure> {
        if imports.is_empty() {
            return Ok(PreparedFiles {
                directory: None,
                media: Vec::new(),
            });
        }
        if imports.len() > 8 {
            return Err(Failure::Operation(
                "Material supports at most eight media attachments".into(),
            ));
        }
        let staging = self.root.join("material-staging");
        fs::create_dir_all(&staging).map_err(io_failure)?;
        // Only this canonical execution owner writes media. Recovery is bounded,
        // and a saved asset catalog row protects bytes even after replacement.
        self.recover_material_media()?;
        let directory = tempfile::Builder::new()
            .prefix("capture-")
            .tempdir_in(&staging)
            .map_err(io_failure)?;
        let mut prepared = Vec::new();
        let mut publications = Vec::new();
        let mut total = 0u64;
        for (index, import) in imports.iter().enumerate() {
            self.validate_media_import(import)?;
            let temporary = directory.path().join(format!("{index}.part"));
            let (mut media, bytes) = copy_asset(import, &temporary)?;
            total = total
                .checked_add(bytes)
                .ok_or_else(|| Failure::Operation("Media size overflow".into()))?;
            if total > IMPORT_BYTES {
                return Err(Failure::Operation("Combined media exceeds 256 MiB".into()));
            }
            if let Some(existing) = self
                .store
                .find_authored_media(&media.id)
                .map_err(|e| Failure::Operation(e.to_string()))?
            {
                if existing.kind != media.kind
                    || existing.mime_type != media.mime_type
                    || existing.byte_length != media.byte_length
                {
                    return Err(Failure::Operation(
                        "Existing media metadata conflicts with these bytes".into(),
                    ));
                }
                media = existing;
            }
            publications.push((temporary, asset_path(&self.root, &media)?));
            prepared.push(PreparedAuthoredMedia {
                media,
                segment: import.segment.clone(),
            });
        }
        let journal = MediaJournal {
            version: 1,
            media: prepared.iter().map(|p| p.media.clone()).collect(),
        };
        let mut file =
            fs::File::create(directory.path().join("journal.part")).map_err(io_failure)?;
        file.write_all(
            &serde_json::to_vec(&journal).map_err(|e| Failure::Operation(e.to_string()))?,
        )
        .map_err(io_failure)?;
        file.sync_all().map_err(io_failure)?;
        drop(file);
        fs::rename(
            directory.path().join("journal.part"),
            directory.path().join("journal.json"),
        )
        .map_err(io_failure)?;
        fs::create_dir_all(self.root.join("authored")).map_err(io_failure)?;
        // Keep the recovery journal before publishing any durable filename.
        let directory = directory.keep();
        for (temporary, destination) in publications {
            if !same_bytes(&temporary, &destination)? {
                fs::rename(&temporary, &destination).map_err(io_failure)?;
            }
        }
        Ok(PreparedFiles {
            directory: Some(directory),
            media: prepared,
        })
    }

    fn validate_media_import(&self, import: &MaterialMediaImport) -> Result<(), Failure> {
        if import.path.is_empty()
            || import.path.len() > 4096
            || import.name.is_empty()
            || import.name.len() > 2048
            || import
                .name
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
        {
            return Err(Failure::Operation("Invalid media path or filename".into()));
        }
        if let Some(segment) = &import.segment {
            self.validate_media_origin(segment, import.kind)?;
        }
        Ok(())
    }

    fn validate_attachment_origins(
        &self,
        attachments: &[MaterialAttachment],
        previous: &[MaterialAttachment],
    ) -> Result<(), Failure> {
        if attachments.len() > 8 {
            return Err(Failure::Operation(
                "Material supports at most eight media attachments".into(),
            ));
        }
        for attachment in attachments {
            // Unchanged historical provenance must not prevent unrelated edits.
            if previous.contains(attachment) {
                continue;
            }
            if let Some(segment) = &attachment.segment {
                let media = self
                    .store
                    .authored_media(&attachment.media_id)
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                self.validate_media_origin(segment, media.kind)?;
            }
        }
        Ok(())
    }

    fn validate_media_origin(
        &self,
        segment: &MediaSegment,
        kind: MaterialMediaKind,
    ) -> Result<(), Failure> {
        let source = self.source_record(&segment.source_id)?;
        if source.media_revision != segment.content_revision
            || segment.end_ms < segment.start_ms
            || source.duration_ms == 0
            || segment.end_ms > source.duration_ms
            || kind != MaterialMediaKind::Image && segment.end_ms == segment.start_ms
        {
            return Err(Failure::Operation(
                "Media origin no longer matches its source".into(),
            ));
        }
        Ok(())
    }
}

pub(super) fn io_failure(error: std::io::Error) -> Failure {
    Failure::Operation(format!("Authored media operation failed: {error}"))
}
