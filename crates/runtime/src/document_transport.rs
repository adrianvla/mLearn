//! Execution-independent, read-only access to registered document images.
use crate::Runtime;
use mlearn_core::DocumentResourceLocation;
use std::path::Path;

impl Runtime {
    pub fn document_resource_reader(
        &self,
    ) -> Result<
        impl Fn(&str, &str) -> Result<DocumentResourceLocation, String> + Send + 'static + use<>,
        String,
    > {
        let reader = mlearn_storage::SourceReader::open(&self.root.join("profile.sqlite3"))
            .map_err(|error| error.to_string())?;
        let root = self.root.clone();
        Ok(move |source_id: &str, resource_id: &str| {
            let source = reader
                .document(source_id)
                .map_err(|error| error.to_string())?
                .ok_or("Document source is unavailable")?;
            let mut location = reader
                .document_resource(source_id, resource_id)
                .map_err(|error| error.to_string())?
                .ok_or("Document image is unavailable")?;
            if source.id != source_id
                || location.source_id != source_id
                || location.resource_id != resource_id
                || !matches!(
                    location.mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml"
                )
                || location.byte_length == 0
                || location.byte_length > 2 * 1024 * 1024
            {
                return Err("Document resource is not a bounded registered image".into());
            }
            let stored = Path::new(&location.path);
            let name = stored
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("Invalid document image path")?;
            let digest = name
                .strip_prefix(&format!("{source_id}-"))
                .and_then(|name| name.strip_suffix(".bin"))
                .ok_or("Invalid document image filename")?;
            if digest.len() != 64
                || !digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                || source.content_revision.len() != 64
                || !source
                    .content_revision
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                || stored.parent().and_then(Path::file_name)
                    != Some(std::ffi::OsStr::new(&source.content_revision))
                || stored
                    .parent()
                    .and_then(Path::parent)
                    .and_then(Path::file_name)
                    != Some(std::ffi::OsStr::new("document-assets"))
            {
                return Err("Invalid document image identity".into());
            }
            // Ignore old mobile-container/profile roots, retaining only admitted identity.
            let directory = root.join("document-assets").join(&source.content_revision);
            let path = directory.join(name);
            for item in [root.join("document-assets"), directory, path.clone()] {
                if std::fs::symlink_metadata(item)
                    .map_err(|error| error.to_string())?
                    .file_type()
                    .is_symlink()
                {
                    return Err("Document image cannot be a symbolic link".into());
                }
            }
            let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
            if !metadata.is_file() || metadata.len() != u64::from(location.byte_length) {
                return Err("Document image bytes changed or are unavailable".into());
            }
            location.path = path
                .to_str()
                .ok_or("Invalid document image path")?
                .to_owned();
            Ok(location)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_core::*;
    use mlearn_language_host::CodePolicy;
    use mlearn_storage::ProfileStore;
    use sha2::{Digest, Sha256};

    #[test]
    fn registered_images_follow_profile_relocation_without_execution_owner_access() {
        // Given an actual registry, old profile paths, and source-owned image bytes.
        let root = tempfile::tempdir().unwrap();
        let runtime =
            Runtime::open(root.path(), CodePolicy::DesktopDownloaded, None, vec![]).unwrap();
        let source_id = format!("document-{}", "a".repeat(64));
        let revision = "b".repeat(64);
        let bytes = br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>"#;
        let name = format!("{source_id}-{:x}.bin", Sha256::digest(bytes));
        let directory = root.path().join("document-assets").join(&revision);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(&name);
        std::fs::write(&path, bytes).unwrap();
        let record = DocumentRecord {
            id: source_id.clone(),
            title: "Registered source".into(),
            document_path: format!("/old-profile/documents/{revision}.{source_id}.epub"),
            content_revision: revision.clone(),
            parser_revision: "reader-1".into(),
            format: DocumentFormat::Epub,
            package_id: "package".into(),
            package_version: "1".into(),
            position: None,
            appearance: Default::default(),
            progression: None,
            total_blocks: 1,
            total_pages: 0,
            fidelity: vec![],
        };
        let source_location = DocumentResourceLocation {
            source_id: source_id.clone(),
            resource_id: "chapter.xhtml".into(),
            path: record.document_path.clone(),
            mime_type: "application/epub+zip".into(),
            byte_length: 3,
        };
        let image = DocumentResourceLocation {
            source_id: source_id.clone(),
            resource_id: "OPS/image.svg".into(),
            path: format!("/old-profile/document-assets/{revision}/{name}"),
            mime_type: "image/svg+xml".into(),
            byte_length: u32::try_from(bytes.len()).unwrap(),
        };
        let block = DocumentBlock {
            resource: "chapter.xhtml".into(),
            id: "image-block".into(),
            kind: "image".into(),
            text: String::new(),
            readings: vec![],
            image: Some(DocumentImage {
                resource_id: image.resource_id.clone(),
                alt: String::new(),
            }),
            page: None,
            writing_mode: None,
        };
        ProfileStore::open(&root.path().join("profile.sqlite3"))
            .unwrap()
            .import_document(&record, &[block], &[], &[source_location, image.clone()])
            .unwrap();
        let reader = runtime.document_resource_reader().unwrap();
        let execution = std::sync::Mutex::new(runtime);
        let _busy = execution.lock().unwrap();

        // When the host resolves while execution is held, on an independent worker.
        let (send, receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            send.send(reader(&source_id, &image.resource_id)).unwrap();
            reader
        });
        let resolved = receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
            .unwrap();
        let reader = worker.join().unwrap();

        // Then relocation succeeds and the registry rejects non-images and unknown IDs.
        assert_eq!(Path::new(&resolved.path), path);
        assert_eq!(resolved.mime_type, "image/svg+xml");
        assert!(reader(&record.id, "chapter.xhtml").is_err());
        assert!(reader(&record.id, "unregistered.svg").is_err());
        assert!(reader("missing-source", "OPS/image.svg").is_err());
        std::fs::write(path, b"changed").unwrap();
        assert!(reader(&record.id, "OPS/image.svg").is_err());
    }
}
