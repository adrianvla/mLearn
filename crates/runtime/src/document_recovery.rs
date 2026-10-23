use crate::{Runtime, document_import::io_error, execution::Failure};
use mlearn_core::DocumentFormat;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct DocumentJournal {
    pub version: u32,
    pub source_id: String,
    pub revision: String,
    pub format: DocumentFormat,
    pub images: Vec<String>,
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl DocumentJournal {
    fn validate(&self) -> Result<(), Failure> {
        if self.version != 1
            || !self.source_id.strip_prefix("document-").is_some_and(digest)
            || !digest(&self.revision)
            || self.images.len() > 128
            || !self.images.iter().all(|value| digest(value))
        {
            return Err(Failure::Operation(
                "Invalid document recovery journal identity".into(),
            ));
        }
        Ok(())
    }
    pub fn source_path(&self, root: &Path) -> Result<PathBuf, Failure> {
        self.validate()?;
        let extension = match self.format {
            DocumentFormat::Text => "txt",
            DocumentFormat::Epub => "epub",
            DocumentFormat::Pdf => "pdf",
        };
        Ok(root
            .join("documents")
            .join(format!("{}.{}.{extension}", self.revision, self.source_id)))
    }
    pub fn image_path(&self, root: &Path, image: &str) -> Result<PathBuf, Failure> {
        self.validate()?;
        if !digest(image) {
            return Err(Failure::Operation("Invalid document image identity".into()));
        }
        Ok(root
            .join("document-assets")
            .join(&self.revision)
            .join(format!("{}-{image}.bin", self.source_id)))
    }
}

impl Runtime {
    pub(super) fn recover_document_files(&self) -> Result<(), Failure> {
        let entries = match fs::read_dir(self.root.join("document-staging")) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(io_error(error)),
        };
        for entry in entries.take(64) {
            let entry = entry.map_err(io_error)?;
            if !entry.file_type().map_err(io_error)?.is_dir()
                || !entry.file_name().to_string_lossy().starts_with("import-")
            {
                return Err(Failure::Operation(
                    "Unexpected document staging entry".into(),
                ));
            }
            let journal = entry.path().join("journal.json");
            match fs::File::open(journal) {
                Ok(file) => {
                    let mut bytes = Vec::new();
                    file.take(65537).read_to_end(&mut bytes).map_err(io_error)?;
                    if bytes.len() > 65536 {
                        return Err(Failure::Operation(
                            "Document recovery journal exceeds bounds".into(),
                        ));
                    }
                    let journal: DocumentJournal = match serde_json::from_slice(&bytes) {
                        Ok(journal) => journal,
                        Err(error) if error.is_eof() => {
                            // Older importers wrote this file in place. An
                            // interrupted write precedes all file publication.
                            fs::remove_dir_all(entry.path()).map_err(io_error)?;
                            continue;
                        }
                        Err(error) => {
                            return Err(Failure::Operation(format!(
                                "Invalid document recovery journal: {error}"
                            )));
                        }
                    };
                    journal.validate()?;
                    if self
                        .store
                        .document(&journal.source_id)
                        .map_err(|error| Failure::Operation(error.to_string()))?
                        .is_none()
                    {
                        let paths = std::iter::once(journal.source_path(&self.root)?).chain(
                            journal
                                .images
                                .iter()
                                .map(|image| journal.image_path(&self.root, image))
                                .collect::<Result<Vec<_>, _>>()?,
                        );
                        for path in paths {
                            match fs::remove_file(path) {
                                Ok(()) => {}
                                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                                Err(error) => return Err(io_error(error)),
                            }
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(io_error(error)),
            }
            fs::remove_dir_all(entry.path()).map_err(io_error)?;
        }
        Ok(())
    }
}
