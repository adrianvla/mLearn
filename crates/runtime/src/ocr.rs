//! One admitted host OCR action; storage owns immutable evidence and projections.
use crate::{
    Runtime,
    execution::{Cancellation, Failure},
};
use mlearn_core::*;
use std::{fs, path::Path};

fn storage(error: mlearn_storage::StorageError) -> Failure {
    match error {
        mlearn_storage::StorageError::Conflict => Failure::Protocol("conflict", error.to_string()),
        error => Failure::Operation(error.to_string()),
    }
}

impl Runtime {
    pub(super) fn required_ocr_page(
        &self,
        source: &str,
        resource: &str,
        revision: u32,
    ) -> Result<OcrPage, Failure> {
        self.store
            .ocr_page(source, resource, Some(revision))
            .map_err(storage)?
            .ok_or_else(|| Failure::Operation("The requested OCR revision is unavailable".into()))
    }

    pub(super) fn current_ocr_page(
        &self,
        source_id: &str,
        resource_id: &str,
    ) -> Result<Option<OcrPage>, Failure> {
        let mut page = self
            .store
            .ocr_page(source_id, resource_id, None)
            .map_err(storage)?;
        if let Some(current) = &page {
            let evidence = self
                .store
                .ocr_evidence(source_id, resource_id, current.ocr_revision)
                .map_err(storage)?;
            if let Some(projection) = evidence.package {
                let source = self.document_record(source_id)?;
                let valid = self
                    .installed
                    .get(&source.package_id)
                    .map(|package| {
                        Ok::<_, Failure>(
                            projection.package_id == source.package_id
                                && projection.package_version == source.package_version
                                && projection.package_revision == package.revision()?,
                        )
                    })
                    .transpose()?
                    .unwrap_or(false);
                if !valid {
                    page = self
                        .store
                        .ocr_base_page(source_id, resource_id)
                        .map_err(storage)?;
                }
            }
        }
        Ok(page)
    }

    pub(super) fn image_page_location(
        &self,
        source_id: &str,
        resource_id: &str,
        cancellation: &Cancellation,
    ) -> Result<ImagePageLocation, Failure> {
        let descriptor = self
            .store
            .image_page_for_resource(source_id, resource_id)
            .map_err(storage)?;
        let source = self.document_record(source_id)?;
        let registered = self
            .store
            .document_resource(source_id, resource_id)
            .map_err(storage)?
            .ok_or_else(|| Failure::Operation("Image page resource is unavailable".into()))?;
        if registered.byte_length == 0 || registered.byte_length > 8 * 1024 * 1024 {
            return Err(Failure::Operation(
                "Original image/PDF exceeds the 8 MiB input bound".into(),
            ));
        }
        let (path, revision, page_index) = match source.format {
            DocumentFormat::Pdf => (
                std::path::PathBuf::from(&source.document_path),
                source.content_revision.clone(),
                Some(descriptor.page_index),
            ),
            DocumentFormat::Images => {
                if !matches!(
                    registered.mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/gif" | "image/webp"
                ) {
                    return Err(Failure::Operation(
                        "Registered source is not a supported raster image".into(),
                    ));
                }
                let stored = Path::new(&registered.path);
                let name = stored
                    .file_name()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| Failure::Operation("Invalid registered image path".into()))?;
                let digest = name
                    .strip_prefix(&format!("{source_id}-"))
                    .and_then(|value| value.strip_suffix(".bin"))
                    .filter(|value| {
                        value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
                    })
                    .ok_or_else(|| {
                        Failure::Operation("Invalid registered image identity".into())
                    })?;
                if stored.parent().and_then(Path::file_name)
                    != Some(std::ffi::OsStr::new(&source.content_revision))
                    || stored
                        .parent()
                        .and_then(Path::parent)
                        .and_then(Path::file_name)
                        != Some(std::ffi::OsStr::new("document-assets"))
                {
                    return Err(Failure::Operation(
                        "Invalid registered image directory".into(),
                    ));
                }
                (
                    self.root
                        .join("document-assets")
                        .join(&source.content_revision)
                        .join(name),
                    digest.into(),
                    None,
                )
            }
            DocumentFormat::Text | DocumentFormat::Epub => {
                return Err(Failure::Operation(
                    "This document has no raster source pages".into(),
                ));
            }
        };
        let parent = path
            .parent()
            .ok_or_else(|| Failure::Operation("Image source parent is unavailable".into()))?;
        for item in [parent, path.as_path()] {
            if fs::symlink_metadata(item)
                .map_err(|error| Failure::Operation(error.to_string()))?
                .file_type()
                .is_symlink()
            {
                return Err(Failure::Operation(
                    "Registered image/PDF cannot be a symbolic link".into(),
                ));
            }
        }
        let metadata =
            fs::metadata(&path).map_err(|error| Failure::Operation(error.to_string()))?;
        if !metadata.is_file()
            || metadata.len() != u64::from(registered.byte_length)
            || crate::source_file::revision(&path, &cancellation.value, cancellation.epoch)?
                != revision
        {
            return Err(Failure::Operation(
                "Original image/PDF bytes changed; saved OCR is preserved".into(),
            ));
        }
        Ok(ImagePageLocation {
            source_id: source_id.into(),
            content_revision: source.content_revision,
            resource_id: resource_id.into(),
            path: path.to_string_lossy().into_owned(),
            mime_type: registered.mime_type,
            page_index,
        })
    }

    pub(super) fn ocr_request(
        &mut self,
        request: Request,
        cancellation: &Cancellation,
    ) -> Result<Response, Failure> {
        cancellation.check()?;
        // Global source cancellation invalidates the outstanding native callback,
        // without holding a runtime or guest lock during native inference.
        if let Some((id, epoch)) = &self.ocr_admission
            && *epoch != cancellation.epoch
        {
            self.store.cancel_ocr(id).map_err(storage)?;
            self.ocr_admission = None;
        }
        match request {
            Request::ImagePage {
                source_id,
                page_index,
            } => Ok(Response::ImagePage {
                page: self
                    .store
                    .image_page(&source_id, page_index)
                    .map_err(storage)?,
            }),
            Request::ImageReaderSettings { source_id } => Ok(Response::ImageReaderSettings {
                settings: self
                    .store
                    .image_reader_settings(&source_id)
                    .map_err(storage)?,
                source_id,
            }),
            Request::SaveImageReaderSettings {
                source_id,
                settings,
            } => {
                self.store
                    .save_image_reader_settings(&source_id, &settings)
                    .map_err(storage)?;
                Ok(Response::ImageReaderSettings {
                    source_id,
                    settings,
                })
            }
            Request::ImagePageLocation {
                source_id,
                resource_id,
            } => Ok(Response::ImagePageLocation {
                location: self.image_page_location(&source_id, &resource_id, cancellation)?,
            }),
            Request::ReadOcr {
                source_id,
                resource_id,
                ocr_revision,
            } => {
                self.document_record(&source_id)?;
                let page = match ocr_revision {
                    Some(revision) => self
                        .store
                        .ocr_page(&source_id, &resource_id, Some(revision))
                        .map_err(storage)?,
                    None => self.current_ocr_page(&source_id, &resource_id)?,
                };
                Ok(Response::OcrCached { page })
            }
            Request::OcrEvidence {
                source_id,
                resource_id,
                ocr_revision,
            } => Ok(Response::OcrEvidence {
                evidence: self
                    .store
                    .ocr_evidence(&source_id, &resource_id, ocr_revision)
                    .map_err(storage)?,
            }),
            Request::OcrRecovery { request } => Ok(Response::OcrRecovery {
                recovery: self.store.ocr_recovery(&request).map_err(storage)?,
            }),
            Request::PlanOcr { request } => {
                let location = self.image_page_location(
                    &request.source_id,
                    &request.resource_id,
                    cancellation,
                )?;
                if location.content_revision != request.content_revision {
                    return Err(Failure::Operation("Image source revision changed".into()));
                }
                let plan = OcrPlan {
                    request_id: request.request_id.clone(),
                    source_id: request.source_id.clone(),
                    content_revision: request.content_revision.clone(),
                    resource_id: request.resource_id.clone(),
                    path: location.path,
                    mime_type: location.mime_type,
                    page_index: location.page_index,
                    crop: request.crop.clone(),
                    provider_id: request.provider_id.clone(),
                    recognition_languages: request.recognition_languages.clone(),
                };
                let plan = self.store.plan_ocr(&request, &plan).map_err(storage)?;
                self.ocr_admission = Some((request.request_id, cancellation.epoch));
                Ok(Response::OcrPlan { plan })
            }
            Request::CompleteOcr { result } => {
                let outcome = (|| {
                    let plan = self.store.ocr_plan(&result.request_id).map_err(storage)?;
                    self.image_page_location(&plan.source_id, &plan.resource_id, cancellation)?;
                    cancellation.check()?;
                    self.store.complete_ocr(&result).map_err(storage)
                })();
                // Validation/provider failures release admission too. A retry is
                // a fresh action, never an unbounded pending job.
                if outcome.is_err() {
                    self.store.cancel_ocr(&result.request_id).map_err(storage)?;
                }
                if self
                    .ocr_admission
                    .as_ref()
                    .is_some_and(|(id, _)| id == &result.request_id)
                {
                    self.ocr_admission = None;
                }
                Ok(Response::OcrPage { page: outcome? })
            }
            Request::CancelOcr { request_id } => {
                self.store.cancel_ocr(&request_id).map_err(storage)?;
                if self
                    .ocr_admission
                    .as_ref()
                    .is_some_and(|(id, _)| id == &request_id)
                {
                    self.ocr_admission = None;
                }
                Ok(Response::OcrCancelled { request_id })
            }
            Request::CorrectOcr { correction } => {
                self.image_page_location(
                    &correction.source_id,
                    &correction.resource_id,
                    cancellation,
                )?;
                let page = self.store.correct_ocr(&correction).map_err(storage)?;
                Ok(Response::OcrPage { page })
            }
            _ => Err(Failure::Protocol(
                "invalid_ocr",
                "Not an OCR source action".into(),
            )),
        }
    }
}
