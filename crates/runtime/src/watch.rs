use crate::Runtime;
use mlearn_core::*;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

fn check(cancellation: &AtomicU64, epoch: u64) -> Result<(), String> {
    if cancellation.load(Ordering::Relaxed) != epoch {
        Err("Source opening cancelled; saved progress is unchanged".into())
    } else {
        Ok(())
    }
}
#[path = "subtitles.rs"]
mod subtitles;
fn hash(path: &Path, cancellation: &AtomicU64, epoch: u64) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|e| format!("Source unavailable; reselect the original file: {e}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        check(cancellation, epoch)?;
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn local(path: &str, extensions: &[&str]) -> Result<PathBuf, String> {
    if path.len() > 4096 {
        return Err("Path is too long".into());
    }
    let path = fs::canonicalize(path).map_err(|e| format!("File unavailable; reselect it: {e}"))?;
    if !path.is_file() {
        return Err("Select an ordinary file".into());
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if !extensions.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported file; select {}",
            extensions.join(", ")
        ));
    }
    Ok(path)
}
impl Runtime {
    // Owned imports follow the profile when iOS relocates its data container.
    // External desktop videos keep their original user-selected location.
    fn resolve_source_paths(&self, mut source: SourceRecord) -> SourceRecord {
        let owned = |saved: &str, revision: &str| -> String {
            let path = Path::new(saved);
            match path.file_name().and_then(|n| n.to_str()) {
                Some(name)
                    if path.parent().and_then(Path::file_name)
                        == Some(std::ffi::OsStr::new("imports"))
                        && name.starts_with(&format!("{revision}.")) =>
                {
                    self.root
                        .join("imports")
                        .join(name)
                        .to_string_lossy()
                        .into_owned()
                }
                _ => saved.to_owned(),
            }
        };
        if self.policy == mlearn_language_host::CodePolicy::MobileBundled {
            source.media_path = owned(&source.media_path, &source.media_revision);
        }
        if let (Some(path), Some(revision)) = (&source.subtitle_path, &source.subtitle_revision) {
            source.subtitle_path = Some(owned(path, revision));
        }
        source
    }
    pub(super) fn source_record(&self, id: &str) -> Result<SourceRecord, String> {
        self.store
            .source(id)
            .map(|s| self.resolve_source_paths(s))
            .map_err(|e| e.to_string())
    }
    pub(super) fn resumable_source(&self, id: &str, epoch: u64) -> Result<SourceRecord, String> {
        let source = self.source_record(id)?;
        let path = self.source_media_path(id)?;
        if hash(&path, &self.cancellation, epoch)? != source.media_revision {
            return Err(
                "Video content changed; open it as a new source. Saved progress is preserved."
                    .into(),
            );
        }
        if let Some(path) = &source.subtitle_path
            && source.subtitle_revision.as_deref()
                != Some(hash(Path::new(path), &self.cancellation, epoch)?.as_str())
        {
            return Err("Subtitle file changed; reselect it to update the association. Saved progress is preserved.".into());
        }
        Ok(source)
    }
    pub fn source_media_path(&self, id: &str) -> Result<PathBuf, String> {
        let source = self.source_record(id)?;
        local(&source.media_path, &["mp4", "mov", "m4v", "webm", "mkv"])
    }
    /// Reads canonical admitted SQLite records without retaining the execution owner.
    pub fn media_source_reader(
        &self,
    ) -> Result<impl Fn(&str) -> Result<PathBuf, String> + Send + 'static + use<>, String> {
        if self.policy != mlearn_language_host::CodePolicy::DesktopDownloaded {
            return Err("Desktop media transport is unavailable on this host".into());
        }
        let reader = mlearn_storage::SourceReader::open(&self.root.join("profile.sqlite3"))
            .map_err(|e| e.to_string())?;
        Ok(move |id: &str| {
            let source = reader.source(id).map_err(|e| e.to_string())?;
            local(&source.media_path, &["mp4", "mov", "m4v", "webm", "mkv"])
        })
    }
    pub(super) fn window(&self, source: SourceRecord, time: u32) -> Result<SourceWindow, String> {
        // Cue timestamps remain authored coordinates. Only the lookup clock moves.
        let subtitle_time = (i64::from(time) + i64::from(source.subtitle_offset_ms))
            .clamp(0, i64::from(u32::MAX)) as u32;
        let (cues, total_cues) = self
            .store
            .cue_window(&source.id, subtitle_time)
            .map_err(|e| e.to_string())?;
        Ok(SourceWindow {
            source,
            cues,
            total_cues,
        })
    }
    fn import_path(
        &self,
        path: &Path,
        digest: &str,
        copy: bool,
        epoch: u64,
    ) -> Result<PathBuf, String> {
        check(&self.cancellation, epoch)?;
        if !copy && self.policy == mlearn_language_host::CodePolicy::DesktopDownloaded {
            return Ok(path.into());
        }
        // Picker cache/permission lifetimes do not become saved-source lifetimes.
        let dir = self.root.join("imports");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(format!(
            "{}.{}",
            digest,
            path.extension().and_then(|s| s.to_str()).unwrap_or("bin")
        ));
        if dest.exists() && hash(&dest, &self.cancellation, epoch)? == digest {
            return Ok(dest);
        }
        let temp = dest.with_extension("part");
        let copied = (|| -> Result<(), String> {
            use std::io::Write;
            let mut input = fs::File::open(path).map_err(|e| e.to_string())?;
            let mut output = fs::File::create(&temp).map_err(|e| e.to_string())?;
            let mut buffer = [0; 65536];
            loop {
                check(&self.cancellation, epoch)?;
                let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            }
            output.sync_all().map_err(|e| e.to_string())?;
            check(&self.cancellation, epoch)?;
            fs::rename(&temp, &dest).map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(error) = copied {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
        Ok(dest)
    }
    pub(crate) fn watch(&mut self, request: Request, epoch: u64) -> Result<Response, String> {
        match request {
            Request::RecentSources => Ok(Response::Sources {
                sources: self
                    .store
                    .recents()
                    .map_err(|e| e.to_string())?
                    .into_iter()
                    .map(|s| self.resolve_source_paths(s))
                    .collect(),
            }),
            Request::OpenSource { path, package_id } => {
                let path = local(&path, &["mp4", "mov", "m4v", "webm", "mkv"])?;
                let media_revision = hash(&path, &self.cancellation, epoch)?;
                let id = format!("video-{media_revision}");
                let old = self
                    .store
                    .find_source(&id)
                    .map_err(|e| e.to_string())?
                    .map(|s| self.resolve_source_paths(s));
                let title = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Video")
                    .to_owned();
                let path = self.import_path(&path, &media_revision, false, epoch)?;
                let source = SourceRecord {
                    id,
                    title,
                    media_path: path.to_string_lossy().into_owned(),
                    media_revision,
                    subtitle_path: old.as_ref().and_then(|s| s.subtitle_path.clone()),
                    subtitle_revision: old.as_ref().and_then(|s| s.subtitle_revision.clone()),
                    package_id: package_id.clone(),
                    package_version: self.installed[&package_id].manifest.version.clone(),
                    position_ms: old.as_ref().map_or(0, |s| s.position_ms),
                    duration_ms: old.as_ref().map_or(0, |s| s.duration_ms),
                    subtitle_offset_ms: old.as_ref().map_or(0, |s| s.subtitle_offset_ms),
                    subtitle_offset_revision: old
                        .as_ref()
                        .map_or(0, |s| s.subtitle_offset_revision),
                    playback_rate: old.as_ref().map_or(1.0, |s| s.playback_rate),
                    inspection_trigger: old
                        .as_ref()
                        .map_or(InspectionTrigger::Click, |s| s.inspection_trigger),
                };
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::Source {
                    window: self.window(source.clone(), source.position_ms)?,
                })
            }
            Request::ResumeSource { source_id } => {
                let source = self.resumable_source(&source_id, epoch)?;
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::Source {
                    window: self.window(source.clone(), source.position_ms)?,
                })
            }
            Request::AttachSubtitles { source_id, path } => {
                let path = local(&path, &["srt"])?;
                if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
                    return Err("Subtitle file exceeds 2 MiB".into());
                }
                let cues = subtitles::parse(
                    &fs::read_to_string(&path).map_err(|e| format!("SRT must be UTF-8: {e}"))?,
                )?;
                let revision = hash(&path, &self.cancellation, epoch)?;
                let path = self.import_path(&path, &revision, true, epoch)?;
                let mut source = self.source_record(&source_id)?;
                source.subtitle_path = Some(path.to_string_lossy().into_owned());
                source.subtitle_revision = Some(revision);
                source.subtitle_offset_ms = 0;
                source.subtitle_offset_revision = source
                    .subtitle_offset_revision
                    .checked_add(1)
                    .ok_or("Subtitle synchronization revision exhausted")?;
                self.store
                    .attach_cues(&source, &cues)
                    .map_err(|e| e.to_string())?;
                self.analysis_cache
                    .retain(|(key, _)| !key.starts_with(&source_id));
                Ok(Response::Source {
                    window: self.window(source.clone(), source.position_ms)?,
                })
            }
            Request::SourceWindow {
                source_id,
                position_ms,
            } => Ok(Response::Source {
                window: self.window(self.source_record(&source_id)?, position_ms)?,
            }),
            Request::CuePosition {
                source_id,
                subtitle_revision,
                cue_index,
            } => {
                let source = self.source_record(&source_id)?;
                if source.subtitle_revision.as_deref() != Some(subtitle_revision.as_str()) {
                    return Err("Subtitle association changed; reopen the transcript".into());
                }
                if source.duration_ms == 0 {
                    return Err("Video duration unavailable; wait for media or reselect it".into());
                }
                let cue = self
                    .store
                    .cue(&source_id, cue_index)
                    .map_err(|e| e.to_string())?
                    .ok_or("Cue unavailable; reopen the transcript")?;
                let start = i64::from(cue.start_ms) - i64::from(source.subtitle_offset_ms);
                let end = i64::from(cue.end_ms) - i64::from(source.subtitle_offset_ms);
                if end <= 0 {
                    return Err(
                        "This cue falls before the video at the current subtitle offset".into(),
                    );
                }
                if start >= i64::from(source.duration_ms) {
                    return Err(
                        "This cue falls after the video at the current subtitle offset".into(),
                    );
                }
                Ok(Response::CuePosition {
                    position: CuePosition {
                        source_id,
                        subtitle_revision,
                        cue_index,
                        position_ms: u32::try_from(start.max(0)).map_err(|e| e.to_string())?,
                    },
                })
            }
            Request::Transcript {
                source_id,
                after_index,
                query,
            } => {
                if query.len() > 128 {
                    return Err("Transcript search exceeds 128 bytes".into());
                }
                let source = self.source_record(&source_id)?;
                let subtitle_revision = source
                    .subtitle_revision
                    .ok_or("Select subtitles before opening the transcript")?;
                let (cues, next_index) = self
                    .store
                    .transcript_page(&source_id, after_index, &query)
                    .map_err(|e| e.to_string())?;
                Ok(Response::Transcript {
                    page: TranscriptPage {
                        source_id,
                        subtitle_revision,
                        cues,
                        next_index,
                    },
                })
            }
            Request::AlignSubtitleOffset {
                source_id,
                subtitle_revision,
                expected_offset_revision,
                position_ms,
                direction,
            } => {
                let mut source = self.source_record(&source_id)?;
                if source.subtitle_revision.as_deref() != Some(subtitle_revision.as_str()) {
                    return Err("Subtitle source changed; reopen synchronization controls".into());
                }
                if source.subtitle_offset_revision != expected_offset_revision {
                    return Err("Subtitle synchronization changed; refresh before choosing another alignment".into());
                }
                if position_ms > 7 * 24 * 60 * 60 * 1000
                    || source.duration_ms > 0 && position_ms > source.duration_ms
                {
                    return Err("Synchronization position is outside the media duration".into());
                }
                let time = i64::from(position_ms) + i64::from(source.subtitle_offset_ms);
                let cue = self
                    .store
                    .neighboring_cue(&source_id, time, direction)
                    .map_err(|e| e.to_string())?
                    .ok_or(match direction {
                        SubtitleDirection::Previous => "No previous subtitle at this position",
                        SubtitleDirection::Next => "No next subtitle at this position",
                    })?;
                let offset = i64::from(cue.start_ms) - i64::from(position_ms);
                if !(-86_400_000..=86_400_000).contains(&offset) {
                    return Err("Subtitle offset must be within 24 hours".into());
                }
                source.subtitle_offset_ms = i32::try_from(offset).map_err(|e| e.to_string())?;
                // Consume an intent once, including after restart or an offset
                // changing away and back. No growing command-receipt cache.
                source.subtitle_offset_revision = source
                    .subtitle_offset_revision
                    .checked_add(1)
                    .ok_or("Subtitle synchronization revision exhausted")?;
                source.position_ms = position_ms;
                // Validate the resulting bounded window before the single durable write.
                let window = self.window(source.clone(), position_ms)?;
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::Source { window })
            }
            Request::SetSubtitleOffset {
                source_id,
                offset_ms,
            } => {
                if !(-86_400_000..=86_400_000).contains(&offset_ms) {
                    return Err("Subtitle offset must be within 24 hours".into());
                }
                let mut source = self.source_record(&source_id)?;
                if source.subtitle_revision.is_none() {
                    return Err("Select subtitles before adjusting synchronization".into());
                }
                source.subtitle_offset_ms = offset_ms;
                source.subtitle_offset_revision = source
                    .subtitle_offset_revision
                    .checked_add(1)
                    .ok_or("Subtitle synchronization revision exhausted")?;
                let window = self.window(source.clone(), source.position_ms)?;
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::Source { window })
            }
            Request::SetPlaybackRate { source_id, rate } => {
                if !rate.is_finite() || !(0.5..=2.0).contains(&rate) {
                    return Err("Playback rate must be between 0.5 and 2".into());
                }
                let mut source = self.source_record(&source_id)?;
                source.playback_rate = rate;
                let window = self.window(source.clone(), source.position_ms)?;
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::Source { window })
            }
            Request::SetInspectionTrigger { source_id, trigger } => {
                let mut source = self.source_record(&source_id)?;
                source.inspection_trigger = trigger;
                let window = self.window(source.clone(), source.position_ms)?;
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::Source { window })
            }
            Request::SavePosition {
                source_id,
                position_ms,
                duration_ms,
            } => {
                if duration_ms > 7 * 24 * 60 * 60 * 1000
                    || (duration_ms > 0 && position_ms > duration_ms)
                {
                    return Err("Playback position is outside the media duration".into());
                }
                let mut source = self.source_record(&source_id)?;
                source.position_ms = position_ms;
                source.duration_ms = duration_ms;
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::PositionSaved)
            }
            Request::Knowledge { keys } => {
                if keys.len() > 256
                    || keys.iter().any(|k| {
                        k.target_id.len() > 512
                            || k.package_id.len() > 128
                            || k.capability.len() > 256
                    })
                {
                    return Err("Knowledge batch exceeds limits".into());
                }
                Ok(Response::Knowledge {
                    projections: self.store.knowledge(&keys).map_err(|e| e.to_string())?,
                })
            }
            _ => Err("Not a Watch action".into()),
        }
    }
}
#[cfg(test)]
mod cancellation_tests {
    use super::*;
    #[test]
    fn canceled_import_releases_its_partial_file_without_admitting_a_source() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("authored.mp4");
        fs::write(&file, b"isolated synthetic bytes").unwrap();
        let runtime = Runtime::open(
            &dir.path().join("profile"),
            mlearn_language_host::CodePolicy::MobileBundled,
            None,
            vec![],
        )
        .unwrap();
        let cancellation = runtime.cancellation_handle();
        let epoch = cancellation.load(Ordering::Relaxed);
        cancellation.fetch_add(1, Ordering::Relaxed);
        assert!(
            runtime
                .import_path(&file, "test-content", true, epoch)
                .is_err()
        );
        assert!(runtime.store.recents().unwrap().is_empty());
        let imports = dir.path().join("profile/imports");
        if imports.exists() {
            assert_eq!(fs::read_dir(imports).unwrap().count(), 0);
        }
    }
}
#[cfg(test)]
#[path = "source_execution_tests.rs"]
pub(crate) mod source_execution_tests;
