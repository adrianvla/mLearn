use crate::{
    document_projection::{DocumentProjection, number, project},
    document_recovery::DocumentJournal,
    execution::{Cancellation, Failure},
    source_file,
};
use mlearn_core::{
    DocumentAppearance, DocumentBlock, DocumentFormat, DocumentImage, DocumentNavigation,
    DocumentPosition, DocumentRecord, DocumentResourceLocation,
};
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

/// Own the same staged publication and recovery path as text/EPUB/PDF imports.
pub(super) fn prepare_images(
    root: &Path,
    selected: &[String],
    title: &str,
    package_id: &str,
    package_version: &str,
    cancellation: &Cancellation,
) -> Result<PreparedDocument, Failure> {
    if selected.is_empty() || selected.len() > 128 || title.trim().is_empty() || title.len() > 4096
    {
        return Err(Failure::Operation(
            "Select 1–128 images and a bounded collection title".into(),
        ));
    }
    let selection_count = selected.len();
    let mut paths = Vec::new();
    for selected in selected {
        cancellation.check()?;
        if selected.len() > 4096 {
            return Err(Failure::Operation(
                "Image path exceeds admission bounds".into(),
            ));
        }
        let path = fs::canonicalize(selected).map_err(io_error)?;
        if path.is_dir() {
            if selection_count != 1 {
                return Err(Failure::Operation(
                    "Select one folder or an ordered list of image files".into(),
                ));
            }
            for (index, entry) in fs::read_dir(&path).map_err(io_error)?.enumerate() {
                cancellation.check()?;
                if index >= 4096 {
                    return Err(Failure::Operation(
                        "Image folder exceeds the 4096-entry scan bound".into(),
                    ));
                }
                let entry = entry.map_err(io_error)?;
                if !entry.file_type().map_err(io_error)?.is_file() {
                    continue;
                }
                let extension = entry
                    .path()
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if ["png", "jpg", "jpeg", "gif", "webp"].contains(&extension.as_str()) {
                    paths.push(entry.path());
                    if paths.len() > 128 {
                        return Err(Failure::Operation(
                            "Image folder exceeds 128 source pages".into(),
                        ));
                    }
                }
            }
            paths.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
        } else {
            paths.push(path);
        }
    }
    if paths.is_empty() || paths.len() > 128 {
        return Err(Failure::Operation(
            "Image collection has no supported pages or exceeds 128 pages".into(),
        ));
    }
    let staging_root = root.join("document-staging");
    fs::create_dir_all(&staging_root).map_err(io_error)?;
    let staging = tempfile::Builder::new()
        .prefix("import-")
        .tempdir_in(staging_root)
        .map_err(io_error)?;
    let mut manifest = Vec::new();
    let mut total = 0usize;
    for path in paths {
        cancellation.check()?;
        let metadata = fs::metadata(&path).map_err(io_error)?;
        if !metadata.is_file()
            || metadata.len()
                > u64::try_from(INPUT_BYTES)
                    .map_err(|error| Failure::Operation(error.to_string()))?
        {
            return Err(Failure::Operation(
                "Each selected original image must be at most 8 MiB".into(),
            ));
        }
        let mut bytes = Vec::new();
        fs::File::open(&path)
            .map_err(io_error)?
            .take(
                u64::try_from(INPUT_BYTES + 1)
                    .map_err(|error| Failure::Operation(error.to_string()))?,
            )
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        total = total.saturating_add(bytes.len());
        if bytes.len() > INPUT_BYTES || total > 64 * 1024 * 1024 {
            return Err(Failure::Operation(
                "Image collection exceeds its per-page or 64 MiB aggregate limit".into(),
            ));
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            "image/jpeg"
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            "image/gif"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return Err(Failure::Operation(
                "Select actual PNG, JPEG, GIF or WebP image bytes".into(),
            ));
        };
        let digest = format!("{:x}", Sha256::digest(&bytes));
        write(&staging.path().join(&digest), &bytes)?;
        manifest.push((digest, mime.to_owned(), number(bytes.len())?));
    }
    cancellation.check()?;
    let bytes =
        serde_json::to_vec(&manifest).map_err(|error| Failure::Operation(error.to_string()))?;
    let revision = format!("{:x}", Sha256::digest(&bytes));
    let id = format!(
        "document-{:x}",
        Sha256::digest(format!("images:{revision}:images-1"))
    );
    let journal = DocumentJournal {
        version: 1,
        source_id: id.clone(),
        revision: revision.clone(),
        format: DocumentFormat::Images,
        images: manifest
            .iter()
            .map(|(digest, _, _)| digest.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect(),
    };
    let source_path = journal.source_path(root)?;
    let mut blocks = Vec::new();
    let mut resources = Vec::new();
    let mut contents = Vec::new();
    for (index, (digest, mime, byte_length)) in manifest.into_iter().enumerate() {
        let resource = format!("image-{index}");
        let position = DocumentPosition {
            parser_revision: "images-1".into(),
            resource: resource.clone(),
            block_id: resource.clone(),
            offset: 0,
        };
        blocks.push(DocumentBlock {
            resource: resource.clone(),
            id: resource.clone(),
            kind: "image".into(),
            text: String::new(),
            readings: vec![],
            image: Some(DocumentImage {
                resource_id: resource.clone(),
                alt: String::new(),
            }),
            page: Some(number(index)?),
            writing_mode: None,
        });
        contents.push(DocumentNavigation {
            label: format!("Page {}", index + 1),
            position,
        });
        resources.push(DocumentResourceLocation {
            source_id: id.clone(),
            resource_id: resource,
            path: journal
                .image_path(root, &digest)?
                .to_string_lossy()
                .into_owned(),
            mime_type: mime,
            byte_length,
        });
    }
    let projection = DocumentProjection {
        record: DocumentRecord {
            id,
            title: title.into(),
            document_path: source_path.to_string_lossy().into_owned(),
            content_revision: revision,
            parser_revision: "images-1".into(),
            format: DocumentFormat::Images,
            package_id: package_id.into(),
            package_version: package_version.into(),
            position: None,
            appearance: DocumentAppearance::default(),
            progression: None,
            total_blocks: number(blocks.len())?,
            total_pages: number(blocks.len())?,
            fidelity: vec![],
        },
        blocks,
        contents,
        resources,
    };
    write(&staging.path().join("source"), &bytes)?;
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
        published: vec![],
        committed: false,
    })
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
                rustix::fs::CWD,
                &temporary,
                rustix::fs::CWD,
                &destination,
                rustix::fs::RenameFlags::NOREPLACE,
            )
            .map_err(std::io::Error::from);
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
                Err(error) => {
                    return Err(Failure::Operation(format!(
                        "Document publication failed: {error}"
                    )));
                }
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
