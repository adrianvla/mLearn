use crate::{Runtime, execution::Failure};
use mlearn_core::{
    AuthoredMedia, AuthoredMediaId, MaterialMediaKind, MaterialMediaLocation, MediaCapturePlan,
    MediaCaptureRequest, MediaCaptureSelection, Response,
};
use std::path::{Path, PathBuf};

pub(super) fn asset_path(root: &Path, media: &AuthoredMedia) -> Result<PathBuf, String> {
    let digest = media
        .id
        .0
        .strip_prefix("media-")
        .ok_or("Unsupported authored media identity")?;
    if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Unsupported authored media identity".into());
    }
    let extension = match media.mime_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "audio/wav" => "wav",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/webm" => "webm",
        "audio/ogg" => "ogg",
        _ => return Err("Unsupported authored media format".into()),
    };
    Ok(root
        .join("authored")
        .join(format!("{}.{}", media.id.0, extension)))
}

impl Runtime {
    pub(super) fn plan_material_media(
        &self,
        request: &MediaCaptureRequest,
        epoch: u64,
    ) -> Result<Response, Failure> {
        let source = self.resumable_source(&request.source_id, epoch)?;
        if source.media_revision != request.content_revision {
            return Err(Failure::Operation("Capture source content changed".into()));
        }
        if source.duration_ms == 0 {
            return Err(Failure::Operation(
                "Wait for the video duration before capturing media".into(),
            ));
        }
        let (kind, start, end) = match &request.selection {
            MediaCaptureSelection::Frame { position_ms } => (
                MaterialMediaKind::Image,
                i64::from(*position_ms),
                i64::from(*position_ms),
            ),
            MediaCaptureSelection::Audio { start_ms, end_ms } => (
                MaterialMediaKind::Audio,
                i64::from(*start_ms),
                i64::from(*end_ms),
            ),
            MediaCaptureSelection::Video { start_ms, end_ms } => (
                MaterialMediaKind::Video,
                i64::from(*start_ms),
                i64::from(*end_ms),
            ),
            MediaCaptureSelection::Cue {
                subtitle_revision,
                cue_index,
                media_kind,
            } => {
                if source.subtitle_revision.as_deref() != Some(subtitle_revision.as_str()) {
                    return Err(Failure::Operation(
                        "Capture subtitle association changed".into(),
                    ));
                }
                let cue = self
                    .store
                    .cue(&source.id, *cue_index)
                    .map_err(|e| Failure::Operation(e.to_string()))?
                    .ok_or_else(|| Failure::Operation("Capture cue is unavailable".into()))?;
                let start = i64::from(cue.start_ms) - i64::from(source.subtitle_offset_ms);
                let end = i64::from(cue.end_ms) - i64::from(source.subtitle_offset_ms);
                if end <= 0 || start >= i64::from(source.duration_ms) {
                    return Err(Failure::Operation(
                        "Capture cue falls outside the video".into(),
                    ));
                }
                let start = start.max(0);
                let end = if *media_kind == MaterialMediaKind::Image {
                    start
                } else {
                    end.min(i64::from(source.duration_ms))
                };
                (*media_kind, start, end)
            }
        };
        if start < 0
            || end < start
            || end > i64::from(source.duration_ms)
            || kind != MaterialMediaKind::Image && (start == end || end - start > 120_000)
        {
            return Err(Failure::Operation(
                "Select a valid media range of at most 120 seconds".into(),
            ));
        }
        Ok(Response::MaterialMediaPlan {
            plan: MediaCapturePlan {
                source_id: source.id,
                content_revision: source.media_revision,
                path: source.media_path,
                kind,
                start_ms: u32::try_from(start).map_err(|e| Failure::Operation(e.to_string()))?,
                end_ms: u32::try_from(end).map_err(|e| Failure::Operation(e.to_string()))?,
            },
        })
    }

    pub(super) fn material_media_location(
        &self,
        id: &AuthoredMediaId,
    ) -> Result<Response, Failure> {
        let media = self
            .store
            .authored_media(id)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        let path = asset_path(&self.root, &media)?;
        let metadata = std::fs::symlink_metadata(&path).map_err(|e| {
            Failure::Operation(format!(
                "Authored media unavailable; replace it from the original: {e}"
            ))
        })?;
        if media.id != *id || !metadata.file_type().is_file() {
            return Err(Failure::Operation("Invalid authored media location".into()));
        }
        Ok(Response::MaterialMedia {
            location: MaterialMediaLocation {
                media,
                path: path.to_string_lossy().into_owned(),
            },
        })
    }

    pub fn authored_media_reader(
        &self,
    ) -> Result<impl Fn(&str) -> Result<(PathBuf, String), String> + Send + 'static + use<>, String>
    {
        let reader = mlearn_storage::SourceReader::open(&self.root.join("profile.sqlite3"))
            .map_err(|e| e.to_string())?;
        let root = self.root.clone();
        Ok(move |id: &str| {
            let media = reader
                .authored_media(&AuthoredMediaId(id.into()))
                .map_err(|e| e.to_string())?;
            if media.id.0 != id {
                return Err("Authored media identity changed".into());
            }
            let path = asset_path(&root, &media)?;
            if !std::fs::symlink_metadata(&path)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_file()
            {
                return Err("Authored media is unavailable".into());
            }
            Ok((path, media.mime_type))
        })
    }
}
