use crate::{
    Runtime,
    execution::Failure,
    material_media::asset_path,
    media_import::{PreparedFiles, io_failure},
};
use mlearn_core::{AuthoredMedia, MaterialWriteResult};
use std::{fs, io::Read, path::Path};

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct MediaJournal {
    pub version: u32,
    pub media: Vec<AuthoredMedia>,
}

impl Runtime {
    pub(super) fn recover_material_media(&self) -> Result<(), Failure> {
        let staging = self.root.join("material-staging");
        let entries = match fs::read_dir(staging) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(io_failure(error)),
        };
        for entry in entries.take(64) {
            let entry = entry.map_err(io_failure)?;
            if !entry.file_type().map_err(io_failure)?.is_dir()
                || !entry.file_name().to_string_lossy().starts_with("capture-")
            {
                return Err(Failure::Operation("Unexpected media staging entry".into()));
            }
            self.recover_media_directory(&entry.path())?;
        }
        Ok(())
    }

    pub(super) fn finish_media_write(
        &self,
        prepared: PreparedFiles,
        result: Result<MaterialWriteResult, Failure>,
    ) -> Result<MaterialWriteResult, Failure> {
        if let Some(directory) = prepared.directory
            && let Err(cleanup) = self.recover_media_directory(&directory)
        {
            return Err(Failure::Operation(match result {
                Ok(_) => format!(
                    "Material is saved; temporary media cleanup failed: {cleanup}. Retry safely to recover its receipt."
                ),
                Err(error) => format!("{error}; temporary media cleanup also failed: {cleanup}"),
            }));
        }
        result
    }

    pub(super) fn recover_media_directory(&self, directory: &Path) -> Result<(), Failure> {
        let journal = directory.join("journal.json");
        match fs::File::open(&journal) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(65537)
                    .read_to_end(&mut bytes)
                    .map_err(io_failure)?;
                if bytes.len() > 65536 {
                    return Err(Failure::Operation(
                        "Media recovery journal exceeds bounds".into(),
                    ));
                }
                let journal: MediaJournal = serde_json::from_slice(&bytes).map_err(|e| {
                    Failure::Operation(format!("Invalid media recovery journal: {e}"))
                })?;
                if journal.version != 1 || journal.media.len() > 8 {
                    return Err(Failure::Operation(
                        "Unsupported media recovery journal".into(),
                    ));
                }
                for media in journal.media {
                    if self
                        .store
                        .find_authored_media(&media.id)
                        .map_err(|e| Failure::Operation(e.to_string()))?
                        .is_none()
                    {
                        match fs::remove_file(asset_path(&self.root, &media)?) {
                            Ok(()) => {}
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                            Err(e) => return Err(io_failure(e)),
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_failure(e)),
        }
        fs::remove_dir_all(directory).map_err(io_failure)
    }
}
