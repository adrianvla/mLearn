use crate::{Runtime, execution::Failure};
use mlearn_core::{
    DocumentCheckpoint, DocumentPosition, DocumentRecord, MaterialId, Response, SourceAnchor,
    SourceLocator, SourceRecord,
};

impl Runtime {
    fn anchored_source(&self, anchor: &SourceAnchor) -> Result<SourceRecord, Failure> {
        let source = self.source_record(&anchor.source_id)?;
        if source.media_revision != anchor.content_revision {
            return Err(Failure::Operation(
                "Captured source content changed; reselect the original source".into(),
            ));
        }
        match &anchor.locator {
            SourceLocator::Document { .. } => {
                return Err(Failure::Operation(
                    "Expected a video source location".into(),
                ));
            }
            SourceLocator::Video {
                subtitle_revision,
                cue_index,
                selection_start,
                selection_end,
                position_ms,
                subtitle_offset_ms,
                playback_rate,
            } => {
                if source.subtitle_revision != *subtitle_revision {
                    return Err(Failure::Operation(
                        "Captured subtitles changed; restore the original association".into(),
                    ));
                }
                if !playback_rate.is_finite()
                    || !(0.5..=2.0).contains(playback_rate)
                    || source.duration_ms > 0 && *position_ms > source.duration_ms
                {
                    return Err(Failure::Operation(
                        "Invalid captured playback location".into(),
                    ));
                }
                let start = usize::try_from(*selection_start)
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                let end = usize::try_from(*selection_end)
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                if anchor.text.get(start..end).is_none() {
                    return Err(Failure::Operation(
                        "Invalid captured UTF-8 selection".into(),
                    ));
                }
                match cue_index {
                    Some(index) => {
                        let cue = self
                            .store
                            .cue(&source.id, *index)
                            .map_err(|e| Failure::Operation(e.to_string()))?
                            .ok_or_else(|| {
                                Failure::Operation("Captured cue is unavailable".into())
                            })?;
                        let clock = i64::from(*position_ms) + i64::from(*subtitle_offset_ms);
                        if cue.text != anchor.text
                            || clock < i64::from(cue.start_ms)
                            || clock >= i64::from(cue.end_ms)
                        {
                            return Err(Failure::Operation(
                                "Captured text or position does not match its cue".into(),
                            ));
                        }
                    }
                    None => {
                        if !anchor.text.is_empty() || *selection_start != 0 || *selection_end != 0 {
                            return Err(Failure::Operation(
                                "A source selection requires its original cue".into(),
                            ));
                        }
                    }
                }
            }
        }
        Ok(source)
    }

    pub(super) fn validate_capture_source(&self, anchor: &SourceAnchor) -> Result<(), Failure> {
        if matches!(&anchor.locator, SourceLocator::Document { .. }) {
            self.validate_document_anchor(anchor, true)?;
            return Ok(());
        }
        let source = self.anchored_source(anchor)?;
        let SourceLocator::Video {
            subtitle_offset_ms,
            playback_rate,
            ..
        } = anchor.locator
        else {
            return Err(Failure::Operation(
                "Expected a video source location".into(),
            ));
        };
        // The rate is a UI transport round-trip, not a measured media clock.
        if source.package_id != anchor.package_id
            || source.package_version != anchor.package_version
            || source.subtitle_offset_ms != subtitle_offset_ms
            || (source.playback_rate - playback_rate).abs() > 0.000_001
        {
            return Err(Failure::Operation(
                "Source context changed; inspect the current source before capturing".into(),
            ));
        }
        Ok(())
    }

    pub(super) fn return_material_source(
        &mut self,
        id: &MaterialId,
        epoch: u64,
    ) -> Result<Response, Failure> {
        let material = self
            .store
            .material(id)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        let anchor = material.content.source.ok_or_else(|| {
            Failure::Operation("This authored item has no source association".into())
        })?;
        self.return_source_anchor(anchor, epoch)
    }

    pub(super) fn return_source_anchor(
        &mut self,
        anchor: SourceAnchor,
        epoch: u64,
    ) -> Result<Response, Failure> {
        if matches!(&anchor.locator, SourceLocator::Document { .. }) {
            return self.return_document_anchor(anchor, epoch);
        }
        self.anchored_source(&anchor)?;
        let mut source = self.resumable_source(&anchor.source_id, epoch)?;
        source.package_id = anchor.package_id.clone();
        source.package_version = self.installed.get(&anchor.package_id).map_or_else(
            || anchor.package_version.clone(),
            |p| p.manifest.version.clone(),
        );
        let SourceLocator::Video {
            position_ms,
            subtitle_offset_ms,
            playback_rate,
            ..
        } = anchor.locator
        else {
            return Err(Failure::Operation(
                "Expected a video source location".into(),
            ));
        };
        source.position_ms = position_ms;
        source.playback_rate = playback_rate;
        if source.subtitle_offset_ms != subtitle_offset_ms {
            source.subtitle_offset_ms = subtitle_offset_ms;
            source.subtitle_offset_revision = source
                .subtitle_offset_revision
                .checked_add(1)
                .ok_or_else(|| {
                    Failure::Operation("Subtitle synchronization revision exhausted".into())
                })?;
        }
        let window = self.window(source.clone(), position_ms)?;
        self.store
            .save_source(&source)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        Ok(Response::MaterialSource { window, anchor })
    }

    fn validate_document_anchor(
        &self,
        anchor: &SourceAnchor,
        capture: bool,
    ) -> Result<DocumentRecord, Failure> {
        let SourceLocator::Document {
            parser_revision,
            resource,
            block_id,
            context_start,
            selection_start,
            selection_end,
        } = &anchor.locator
        else {
            return Err(Failure::Operation(
                "Expected a document source location".into(),
            ));
        };
        let source = self.document_record(&anchor.source_id)?;
        let block = self
            .store
            .document_block(&source.id, resource, block_id)
            .map_err(|error| Failure::Operation(error.to_string()))?
            .ok_or_else(|| {
                Failure::Operation("The original document passage is unavailable".into())
            })?;
        let context = usize::try_from(*context_start)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let start = usize::try_from(*selection_start)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let end = usize::try_from(*selection_end)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let original = context
            .checked_add(anchor.text.len())
            .and_then(|end| block.text.get(context..end));
        if source.content_revision != anchor.content_revision
            || &source.parser_revision != parser_revision
            || original != Some(anchor.text.as_str())
            || start >= end
            || anchor.text.get(start..end).is_none()
            || capture
                && (source.package_id != anchor.package_id
                    || source.package_version != anchor.package_version)
        {
            return Err(Failure::Operation(
                "Document source context changed; inspect the original passage again".into(),
            ));
        }
        Ok(source)
    }

    fn return_document_anchor(
        &mut self,
        anchor: SourceAnchor,
        epoch: u64,
    ) -> Result<Response, Failure> {
        let source = self.validate_document_anchor(&anchor, false)?;
        if crate::source_file::revision(
            std::path::Path::new(&source.document_path),
            &self.cancellation,
            epoch,
        )? != anchor.content_revision
        {
            return Err(Failure::Operation(
                "The original document bytes changed; saved Material is unchanged".into(),
            ));
        }
        let SourceLocator::Document {
            parser_revision,
            resource,
            block_id,
            context_start,
            selection_start,
            ..
        } = &anchor.locator
        else {
            return Err(Failure::Operation(
                "Expected a document source location".into(),
            ));
        };
        let position = DocumentPosition {
            parser_revision: parser_revision.clone(),
            resource: resource.clone(),
            block_id: block_id.clone(),
            offset: context_start
                .checked_add(*selection_start)
                .ok_or_else(|| Failure::Operation("Invalid document return coordinates".into()))?,
        };
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
                position: position.clone(),
                appearance: source.appearance,
            })
            .map_err(|error| Failure::Operation(error.to_string()))?;
        Ok(Response::DocumentMaterialSource {
            window: self.document_window(&source.id, Some(&position))?,
            anchor,
        })
    }
}
