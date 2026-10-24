use crate::{
    Runtime,
    execution::{Cancellation, Failure},
};
use mlearn_core::*;

impl Runtime {
    pub(super) fn validate_image_anchor(
        &self,
        anchor: &SourceAnchor,
        capture: bool,
    ) -> Result<(DocumentRecord, OcrPage, ImagePageDescriptor), Failure> {
        let SourceLocator::Image {
            resource_id,
            page_index,
            ocr_revision,
            region_id,
            context_start,
            selection_start,
            selection_end,
        } = &anchor.locator
        else {
            return Err(Failure::Operation(
                "Expected an image source location".into(),
            ));
        };
        let source = self.document_record(&anchor.source_id)?;
        let descriptor = self
            .store
            .image_page_for_resource(&anchor.source_id, resource_id)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let page = self.required_ocr_page(&anchor.source_id, resource_id, *ocr_revision)?;
        let region = page
            .regions
            .iter()
            .find(|region| region.id == *region_id)
            .ok_or_else(|| Failure::Operation("The frozen OCR region is unavailable".into()))?;
        let context = usize::try_from(*context_start)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let start = usize::try_from(*selection_start)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let end = usize::try_from(*selection_end)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        if source.content_revision != anchor.content_revision
            || page.content_revision != anchor.content_revision
            || *page_index != Some(descriptor.page_index)
            || context
                .checked_add(anchor.text.len())
                .and_then(|end| region.text.get(context..end))
                != Some(anchor.text.as_str())
            || start >= end
            || anchor.text.get(start..end).is_none()
            || capture
                && (source.package_id != anchor.package_id
                    || source.package_version != anchor.package_version
                    || self
                        .current_ocr_page(&source.id, resource_id)?
                        .as_ref()
                        .map(|page| page.ocr_revision)
                        != Some(*ocr_revision))
        {
            return Err(Failure::Operation(
                "Image selection does not match its frozen OCR region or package".into(),
            ));
        }
        Ok((source, page, descriptor))
    }

    pub(super) fn return_image_anchor(
        &mut self,
        anchor: SourceAnchor,
        epoch: u64,
    ) -> Result<Response, Failure> {
        let (source, page, descriptor) = self.validate_image_anchor(&anchor, false)?;
        self.image_page_location(
            &source.id,
            &descriptor.resource_id,
            &Cancellation::source(self.cancellation.clone(), epoch),
        )?;
        let version = self
            .installed
            .get(&anchor.package_id)
            .map_or(anchor.package_version.as_str(), |package| {
                package.manifest.version.as_str()
            });
        if source.package_id != anchor.package_id || source.package_version != version {
            self.store
                .set_document_language(&source.id, &anchor.package_id, version)
                .map_err(|error| Failure::Operation(error.to_string()))?;
            self.analysis_cache
                .retain(|(key, _)| !key.starts_with(&source.id));
        }
        self.store
            .checkpoint_document(&DocumentCheckpoint {
                source_id: source.id.clone(),
                content_revision: source.content_revision,
                position: descriptor.position.clone(),
                appearance: source.appearance,
            })
            .map_err(|error| Failure::Operation(error.to_string()))?;
        Ok(Response::ImageMaterialSource {
            window: self.document_window(&source.id, Some(&descriptor.position))?,
            page,
            anchor,
        })
    }
}
