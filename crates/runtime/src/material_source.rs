use crate::{execution::Failure, Runtime};
use mlearn_core::{MaterialId, Response, SourceAnchor, SourceLocator, SourceRecord};

impl Runtime {
    fn anchored_source(&self, anchor: &SourceAnchor) -> Result<SourceRecord, Failure> {
        let source = self.source_record(&anchor.source_id)?;
        if source.media_revision != anchor.content_revision {
            return Err(Failure::Operation(
                "Captured source content changed; reselect the original source".into(),
            ));
        }
        match &anchor.locator {
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
        let source = self.anchored_source(anchor)?;
        let SourceLocator::Video {
            subtitle_offset_ms,
            playback_rate,
            ..
        } = anchor.locator;
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
        } = anchor.locator;
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
}
