use crate::StorageError;
use mlearn_core::{MaterialContent, MaterialTarget, SourceLocator};
use std::collections::HashSet;

pub(crate) fn bounded(value: &str, max: usize) -> Result<(), StorageError> {
    if value.is_empty() || value.len() > max {
        return Err(StorageError::Invalid(
            "Invalid Material identity or size".into(),
        ));
    }
    Ok(())
}

pub(crate) fn target(value: &MaterialTarget) -> Result<(), StorageError> {
    bounded(&value.package_id, 512)?;
    bounded(&value.target_id, 512)
}

pub(crate) fn content(value: &MaterialContent) -> Result<String, StorageError> {
    bounded(&value.package_id, 512)?;
    if let Some(id) = &value.target_id {
        bounded(id, 512)?;
    }
    if let Some(revision) = &value.package_revision {
        bounded(revision, 512)?;
    }
    if value.phrase.len() > 2048
        || value.reading.len() > 2048
        || [&value.meaning, &value.context, &value.notes]
            .iter()
            .any(|v| v.len() > 32768)
        || value.examples.len() > 16
        || value.examples.iter().any(|v| v.len() > 4096)
        || value.attachments.len() > 8
        || (value.phrase.trim().is_empty() && value.attachments.is_empty())
    {
        return Err(StorageError::Invalid(
            "Material content exceeds bounds or is empty".into(),
        ));
    }
    let mut ids = HashSet::new();
    for attachment in &value.attachments {
        bounded(&attachment.media_id.0, 512)?;
        if !ids.insert(&attachment.media_id.0) {
            return Err(StorageError::Invalid(
                "Duplicate Material attachment".into(),
            ));
        }
        if let Some(segment) = &attachment.segment {
            bounded(&segment.source_id, 512)?;
            bounded(&segment.content_revision, 512)?;
            if segment.start_ms > segment.end_ms {
                return Err(StorageError::Invalid("Invalid media segment".into()));
            }
        }
    }
    if let Some(source) = &value.source {
        bounded(&source.source_id, 512)?;
        bounded(&source.content_revision, 512)?;
        bounded(&source.package_id, 512)?;
        bounded(&source.package_version, 512)?;
        if source.text.len() > 32768 {
            return Err(StorageError::Invalid("Source text exceeds bounds".into()));
        }
        match &source.locator {
            SourceLocator::Video {
                subtitle_revision,
                cue_index,
                selection_start,
                selection_end,
                playback_rate,
                ..
            } => {
                if let Some(revision) = subtitle_revision {
                    bounded(revision, 512)?;
                }
                if !playback_rate.is_finite() || *playback_rate <= 0.0 {
                    return Err(StorageError::Invalid("Invalid source playback rate".into()));
                }
                let start = usize::try_from(*selection_start)
                    .map_err(|_| StorageError::Invalid("Invalid source offset".into()))?;
                let end = usize::try_from(*selection_end)
                    .map_err(|_| StorageError::Invalid("Invalid source offset".into()))?;
                let frame_without_text =
                    cue_index.is_none() && source.text.is_empty() && start == 0 && end == 0;
                if (!frame_without_text && start >= end)
                    || end > source.text.len()
                    || !source.text.is_char_boundary(start)
                    || !source.text.is_char_boundary(end)
                {
                    return Err(StorageError::Invalid("Invalid UTF-8 source span".into()));
                }
            }
        }
    }
    let encoded = serde_json::to_string(value)?;
    if encoded.len() > 65536 {
        return Err(StorageError::Invalid(
            "Material content exceeds 65536 bytes".into(),
        ));
    }
    Ok(encoded)
}
