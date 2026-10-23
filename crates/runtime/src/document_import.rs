use crate::{
    document_projection::{DocumentProjection, number, project},
    document_recovery::DocumentJournal,
    execution::{Cancellation, Failure},
    source_file,
};
use mlearn_core::{DocumentFormat, DocumentResourceLocation};
use mlearn_document_parser as parser;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) const INPUT_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn io_error(error: std::io::Error) -> Failure {
    Failure::Operation(format!("Document file operation failed: {error}"))
}

pub(super) struct PreparedDocument {
    pub projection: DocumentProjection,
    staging: tempfile::TempDir,
    journal: DocumentJournal,
    published: Vec<PathBuf>,
    committed: bool,
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), Failure> {
    let mut file = fs::File::create(path).map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}

pub(super) fn prepare(
    root: &Path,
    selected: &str,
    package_id: &str,
    package_version: &str,
    cancellation: &Cancellation,
) -> Result<PreparedDocument, Failure> {
    cancellation.check()?;
    if selected.len() > 4096 {
        return Err(Failure::Operation(
            "Document path exceeds admission bounds".into(),
        ));
    }
    let path = fs::canonicalize(selected).map_err(io_error)?;
    let metadata = fs::metadata(&path).map_err(io_error)?;
    if !metadata.is_file()
        || metadata.len()
            > u64::try_from(INPUT_BYTES).map_err(|error| Failure::Operation(error.to_string()))?
    {
        return Err(Failure::Operation(
            "Select an ordinary document of at most 8 MiB".into(),
        ));
    }
    let (format, extension) = match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("txt") => (parser::Format::Text, "txt"),
        Some("epub") => (parser::Format::Epub, "epub"),
        Some("pdf") => (parser::Format::Pdf, "pdf"),
        _ => {
            return Err(Failure::Operation(
                "Select a UTF-8 TXT, EPUB or PDF document".into(),
            ));
        }
    };
    let mut file = fs::File::open(&path).map_err(io_error)?;
    let mut bytes = Vec::new();
    let mut buffer = [0; 65536];
    loop {
        cancellation.check()?;
        let count = file.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        if bytes.len().saturating_add(count) > INPUT_BYTES {
            return Err(Failure::Operation(
                "Document exceeds the 8 MiB input limit".into(),
            ));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let parsed = parser::parse_cancellable(
        &bytes,
        format,
        parser::Limits::default(),
        &parser::ParseControl {
            cancellation: cancellation.value.clone(),
            epoch: cancellation.epoch,
        },
    )
    .map_err(|error| match error {
        parser::Error::Cancelled => Failure::Cancelled,
        error => Failure::Operation(error.to_string()),
    })?;
    cancellation.check()?;
    let identity = format!(
        "{extension}:{}:{}",
        parsed.content_revision, parsed.parser_revision
    );
    let id = format!("document-{:x}", Sha256::digest(identity.as_bytes()));
    let journal = DocumentJournal {
        version: 1,
        source_id: id.clone(),
        revision: parsed.content_revision.clone(),
        format: match format {
            parser::Format::Text => DocumentFormat::Text,
            parser::Format::Epub => DocumentFormat::Epub,
            parser::Format::Pdf => DocumentFormat::Pdf,
        },
        images: parsed
            .images
            .iter()
            .map(|image| format!("{:x}", Sha256::digest(&image.bytes)))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect(),
    };
    let source_path = journal.source_path(root)?;
    let title = path
        .file_name()
        .ok_or_else(|| Failure::Operation("Document filename is missing".into()))?
        .to_string_lossy()
        .into_owned();
    let mut projection = project(
        &parsed,
        id.clone(),
        title,
        &source_path,
        package_id,
        package_version,
    )?;
    let mut resources = BTreeMap::new();
    for block in &projection.blocks {
        resources
            .entry(block.resource.clone())
            .or_insert(DocumentResourceLocation {
                source_id: id.clone(),
                resource_id: block.resource.clone(),
                path: source_path.to_string_lossy().into_owned(),
                mime_type: match format {
                    parser::Format::Text => "text/plain",
                    parser::Format::Epub => "application/epub+zip",
                    parser::Format::Pdf => "application/pdf",
                }
                .into(),
                byte_length: number(bytes.len())?,
            });
    }
    let staging_root = root.join("document-staging");
    fs::create_dir_all(&staging_root).map_err(io_error)?;
    let staging = tempfile::Builder::new()
        .prefix("import-")
        .tempdir_in(staging_root)
        .map_err(io_error)?;
    write(&staging.path().join("source"), &bytes)?;
    for image in &parsed.images {
        cancellation.check()?;
        let digest = format!("{:x}", Sha256::digest(&image.bytes));
        write(&staging.path().join(&digest), &image.bytes)?;
        let location = DocumentResourceLocation {
            source_id: id.clone(),
            resource_id: image.resource.clone(),
            path: journal
                .image_path(root, &digest)?
                .to_string_lossy()
                .into_owned(),
            mime_type: image.media_type.clone(),
            byte_length: number(image.bytes.len())?,
        };
        if resources.insert(image.resource.clone(), location).is_some() {
            return Err(Failure::Operation(
                "Image and source resource identities conflict".into(),
            ));
        }
    }
    projection.resources = resources.into_values().collect();
    write(
        &staging.path().join("journal.pending"),
        &serde_json::to_vec(&journal).map_err(|error| Failure::Operation(error.to_string()))?,
    )?;
    fs::rename(
        staging.path().join("journal.pending"),
        staging.path().join("journal.json"),
    )
    .map_err(io_error)?;
    fs::File::open(staging.path())
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;
    Ok(PreparedDocument {
        projection,
        staging,
        journal,
        published: Vec::new(),
        committed: false,
    })
}

impl PreparedDocument {
    pub fn publish(&mut self, root: &Path, cancellation: &Cancellation) -> Result<(), Failure> {
        let files = std::iter::once((
            self.staging.path().join("source"),
            self.journal.source_path(root)?,
        ))
        .chain(
            self.journal
                .images
                .iter()
                .map(|digest| {
                    Ok((
                        self.staging.path().join(digest),
                        self.journal.image_path(root, digest)?,
                    ))
                })
                .collect::<Result<Vec<_>, Failure>>()?,
        );
        for (temporary, destination) in files {
            cancellation.check()?;
            fs::create_dir_all(
                destination
                    .parent()
                    .ok_or_else(|| Failure::Operation("Missing document resource parent".into()))?,
            )
            .map_err(io_error)?;
            // Android app policy denies hard links, including inside the app's
            // own data directory. Use its atomic no-replace rename instead;
            // existing immutable imports still reach the same byte check.
            #[cfg(target_os = "android")]
            let publication = rustix::fs::renameat_with(
                rustix::fs::CWD, &temporary, rustix::fs::CWD, &destination,
                rustix::fs::RenameFlags::NOREPLACE,
            ).map_err(std::io::Error::from);
            #[cfg(not(target_os = "android"))]
            let publication = fs::hard_link(&temporary, &destination);
            match publication {
                Ok(()) => self.published.push(destination),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let existing = fs::symlink_metadata(&destination).map_err(io_error)?;
                    if !existing.is_file()
                        || existing.len() != fs::metadata(&temporary).map_err(io_error)?.len()
                        || source_file::revision(
                            &temporary,
                            &cancellation.value,
                            cancellation.epoch,
                        )? != source_file::revision(
                            &destination,
                            &cancellation.value,
                            cancellation.epoch,
                        )?
                    {
                        return Err(Failure::Operation(
                            "Existing document bytes conflict; saved source is unchanged".into(),
                        ));
                    }
                }
                Err(error) => return Err(Failure::Operation(format!("Document publication failed: {error}"))),
            }
        }
        cancellation.check()
    }
    pub fn committed(&mut self) {
        self.committed = true;
    }
}

impl Drop for PreparedDocument {
    fn drop(&mut self) {
        if !self.committed {
            let mut rollback_failed = false;
            for path in &self.published {
                if let Err(error) = fs::remove_file(path)
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    rollback_failed = true;
                    eprintln!("Document import rollback failed: {error}");
                }
            }
            // Keep the bounded journal if filesystem cleanup failed. Startup
            // recovery must still know which uncommitted files belong to us.
            if rollback_failed {
                self.staging.disable_cleanup(true);
            }
        }
    }
}
