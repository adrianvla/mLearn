use crate::{
    Runtime,
    execution::{Cancellation, Failure},
    source_file,
};
use mlearn_core::*;
use std::path::Path;

impl Runtime {
    fn resolve_document_record(
        &self,
        mut source: DocumentRecord,
    ) -> Result<DocumentRecord, Failure> {
        let stored = Path::new(&source.document_path);
        let name = stored
            .file_name()
            .ok_or_else(|| Failure::Operation("Invalid imported document path".into()))?;
        if stored.parent().and_then(Path::file_name) != Some(std::ffi::OsStr::new("documents"))
            || !name
                .to_string_lossy()
                .starts_with(&format!("{}.", source.content_revision))
        {
            return Err(Failure::Operation(
                "Invalid imported document identity".into(),
            ));
        }
        // Source-owned imports follow the profile when a mobile container moves.
        source.document_path = self
            .root
            .join("documents")
            .join(name)
            .to_string_lossy()
            .into_owned();
        Ok(source)
    }
    pub(super) fn document_record(&self, id: &str) -> Result<DocumentRecord, Failure> {
        let source = self
            .store
            .document(id)
            .map_err(|error| Failure::Operation(error.to_string()))?
            .ok_or_else(|| Failure::Operation("Document source is unavailable".into()))?;
        self.resolve_document_record(source)
    }
    pub(super) fn document_window(
        &self,
        id: &str,
        position: Option<&DocumentPosition>,
    ) -> Result<DocumentWindow, Failure> {
        let mut window = self
            .store
            .document_window(id, position)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        window.source = self.resolve_document_record(window.source)?;
        Ok(window)
    }
    pub(super) fn document_request(
        &mut self,
        request: Request,
        cancellation: &Cancellation,
    ) -> Result<Response, Failure> {
        cancellation.check()?;
        match request {
            Request::ResumeDocument { source_id } => {
                let source = self.document_record(&source_id)?;
                if source_file::revision(
                    Path::new(&source.document_path),
                    &self.cancellation,
                    cancellation.epoch,
                )? != source.content_revision
                {
                    return Err(Failure::Operation("Document bytes changed; open them as a new source. Saved progress is preserved.".into()));
                }
                Ok(Response::Document {
                    window: self.document_window(&source_id, source.position.as_ref())?,
                })
            }
            Request::RecentDocuments => {
                let sources = self
                    .store
                    .recent_documents()
                    .map_err(|error| Failure::Operation(error.to_string()))?
                    .into_iter()
                    .map(|source| self.resolve_document_record(source))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(Response::Documents { sources })
            }
            Request::DocumentWindow {
                source_id,
                position,
            } => Ok(Response::Document {
                window: self.document_window(&source_id, position.as_ref())?,
            }),
            Request::DocumentContents { source_id, after } => Ok(Response::DocumentContents {
                page: self
                    .store
                    .document_contents(&source_id, after)
                    .map_err(|error| Failure::Operation(error.to_string()))?,
            }),
            Request::SearchDocument { query } => {
                let page = self.store.search_document(&query).map_err(|error| {
                    Failure::Protocol("invalid_document_search", error.to_string())
                })?;
                cancellation.check()?;
                Ok(Response::DocumentSearch { page })
            }
            Request::CheckpointDocument { checkpoint } => {
                let source = self
                    .store
                    .checkpoint_document(&checkpoint)
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                Ok(Response::Document {
                    window: self.document_window(&source.id, source.position.as_ref())?,
                })
            }
            Request::DocumentResource {
                source_id,
                resource_id,
            } => {
                let source = self.document_record(&source_id)?;
                let mut location = self
                    .store
                    .document_resource(&source_id, &resource_id)
                    .map_err(|error| Failure::Operation(error.to_string()))?
                    .ok_or_else(|| Failure::Operation("Document image is unavailable".into()))?;
                let stored = Path::new(&location.path);
                let name = stored
                    .file_name()
                    .ok_or_else(|| Failure::Operation("Invalid document resource path".into()))?;
                if stored.parent().and_then(Path::file_name)
                    != Some(std::ffi::OsStr::new(&source.content_revision))
                    || stored
                        .parent()
                        .and_then(Path::parent)
                        .and_then(Path::file_name)
                        != Some(std::ffi::OsStr::new("document-assets"))
                {
                    return Err(Failure::Operation(
                        "Invalid document resource identity".into(),
                    ));
                }
                location.path = self
                    .root
                    .join("document-assets")
                    .join(source.content_revision)
                    .join(name)
                    .to_string_lossy()
                    .into_owned();
                Ok(Response::DocumentResource { location })
            }
            _ => Err(Failure::Protocol(
                "invalid_document",
                "Not a document source action".into(),
            )),
        }
    }
}
