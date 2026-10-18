use crate::Runtime;
use mlearn_core::*;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    collections::BTreeSet,
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
    // Only paths we created in the content-addressed imports namespace are rebased;
    // external desktop videos keep their original user-selected location.
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
    fn source_record(&self, id: &str) -> Result<SourceRecord, String> {
        self.store
            .source(id)
            .map(|s| self.resolve_source_paths(s))
            .map_err(|e| e.to_string())
    }
    pub fn source_media_path(&self, id: &str) -> Result<PathBuf, String> {
        let source = self.source_record(id)?;
        local(&source.media_path, &["mp4", "mov", "m4v", "webm", "mkv"])
    }
    /// Media reads the same admitted SQLite records without retaining the
    /// execution owner. Cold guest initialization must not stall HTTP headers.
    pub fn media_source_reader(
        &self,
    ) -> Result<impl Fn(&str) -> Result<PathBuf, String> + Send + 'static, String> {
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
    fn invoke_language(
        &self,
        id: &str,
        capability: &str,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let package = self
            .installed
            .get(id)
            .ok_or("Language package unavailable; install its compatible version and retry")?;
        if !package
            .manifest
            .capabilities
            .iter()
            .any(|v| v == capability)
        {
            return Err("Selected package does not support this language operation".into());
        }
        package.compiled.invoke_cancellable(capability, input, self.cancellation.clone(), self.request_epoch)
    }
    fn description(&self, id: &str) -> Result<LanguageDescription, String> {
        let description: LanguageDescription = serde_json::from_value(self.invoke_language(
            id,
            "language.describe.v1",
            serde_json::Value::Null,
        )?)
        .map_err(|e| e.to_string())?;
        if !description
            .capabilities
            .iter()
            .any(|c| c.id == description.annotation_capability)
            || description.capabilities.is_empty()
            || description.capabilities.len() > 8
            || description.capabilities.iter().any(|c| {
                !c.id.starts_with(&format!("{id}:")) || c.id.len() > 256 || c.label.len() > 128
            })
        {
            return Err("Invalid package capability schema".into());
        }
        Ok(description)
    }
    fn entry(&self, package: &str, target: &str) -> Result<LexicalEntry, String> {
        if target.len() > 512 {
            return Err("Target id exceeds limit".into());
        }
        let entry: LexicalEntry = serde_json::from_value(self.invoke_language(
            package,
            "target.inspect.v1",
            serde_json::json!({"targetId":target}),
        )?)
        .map_err(|e| e.to_string())?;
        if entry.target_id != target || entry.definition.len() > 32768 || entry.headword.len() > 512
        {
            return Err("Invalid inspected entry".into());
        }
        let schema = self.description(package)?;
        if entry
            .capabilities
            .iter()
            .any(|c| !schema.capabilities.contains(c))
        {
            return Err("Entry declares an unavailable capability".into());
        }
        Ok(entry)
    }
    fn window(&self, source: SourceRecord, time: u32) -> Result<SourceWindow, String> {
        let (cues, total_cues) = self
            .store
            .cue_window(&source.id, time)
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
    pub(crate) fn watch(&mut self, request: Request) -> Result<Response, String> {
        let epoch = self.cancellation.load(Ordering::Relaxed);
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
                let description = self.description(&package_id)?;
                let _ = description;
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
                    duration_ms: old.map_or(0, |s| s.duration_ms),
                };
                self.store.save_source(&source).map_err(|e| e.to_string())?;
                Ok(Response::Source {
                    window: self.window(source.clone(), source.position_ms)?,
                })
            }
            Request::ResumeSource { source_id } => {
                let source = self.source_record(&source_id)?;
                let path = self.source_media_path(&source_id)?;
                if hash(&path, &self.cancellation, epoch)? != source.media_revision {
                    return Err("Video content changed; open it as a new source. Saved progress is preserved.".into());
                }
                if let Some(path) = &source.subtitle_path {
                    if source.subtitle_revision.as_deref()
                        != Some(hash(Path::new(path), &self.cancellation, epoch)?.as_str())
                    {
                        return Err("Subtitle file changed; reselect it to update the association. Saved progress is preserved.".into());
                    }
                }
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
            Request::DescribeLanguage { package_id } => Ok(Response::Language {
                description: self.description(&package_id)?,
            }),
            Request::InspectTarget {
                package_id,
                target_id,
            } => Ok(Response::Entry {
                entry: self.entry(&package_id, &target_id)?,
            }),
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
            Request::ChangeClaim { change } => {
                let entry = self.entry(&change.key.package_id, &change.key.target_id)?;
                if !entry
                    .capabilities
                    .iter()
                    .any(|c| c.id == change.key.capability)
                {
                    return Err("This target does not declare the selected capability".into());
                }
                Ok(Response::ClaimChanged {
                    projection: self
                        .store
                        .change_claim(&change)
                        .map_err(|e| e.to_string())?,
                })
            }
            Request::AnalyzeSource {
                source_id,
                position_ms,
            } => {
                let source = self.source_record(&source_id)?;
                let revision = source
                    .subtitle_revision
                    .clone()
                    .ok_or("Select an external SRT subtitle file first")?;
                let installed = self
                    .installed
                    .get(&source.package_id)
                    .ok_or("Language package unavailable; install it and retry")?;
                if installed.manifest.version != source.package_version {
                    return Err("Saved source requires its original package version; reselect the source language explicitly".into());
                }
                let window = self.window(source.clone(), position_ms)?;
                let key = format!(
                    "{}|{}|{}|{}|{:?}",
                    source.id,
                    revision,
                    source.package_id,
                    source.package_version,
                    window.cues.iter().map(|c| c.index).collect::<Vec<_>>()
                );
                let analyses = if let Some((_, value)) =
                    self.analysis_cache.iter().find(|(k, _)| k == &key)
                {
                    value.clone()
                } else {
                    let mut result = Vec::new();
                    let texts = window
                        .cues
                        .iter()
                        .map(|c| c.text.as_str())
                        .collect::<Vec<_>>();
                    let token_batches: Vec<Vec<AnalyzedToken>> =
                        serde_json::from_value(self.invoke_language(
                            &source.package_id,
                            "text.analyze.v1",
                            serde_json::json!({"texts":texts}),
                        )?)
                        .map_err(|e| e.to_string())?;
                    if token_batches.len() != window.cues.len() {
                        return Err("Package returned the wrong analysis batch length".into());
                    }
                    for (cue, tokens) in window.cues.into_iter().zip(token_batches) {
                        let mut cursor = 0;
                        for token in &tokens {
                            if token.start as usize != cursor
                                || token.end <= token.start
                                || cue.text.get(cursor..token.end as usize)
                                    != Some(token.text.as_str())
                                || token.targets.len() > 128
                                || token
                                    .targets
                                    .iter()
                                    .any(|id| id.is_empty() || id.len() > 512)
                            {
                                return Err(
                                    "Package returned invalid UTF-8 source spans or targets".into(),
                                );
                            }
                            cursor = token.end as usize;
                        }
                        if cursor != cue.text.len() || tokens.len() > 512 {
                            return Err(
                                "Package analysis did not cover the untouched source text".into()
                            );
                        }
                        result.push(CueAnalysis { cue, tokens });
                    }
                    check(&self.cancellation, epoch)?;
                    if self.analysis_cache.len() >= 8 {
                        self.analysis_cache.pop_front();
                    }
                    self.analysis_cache.push_back((key, result.clone()));
                    result
                };
                let description = self.description(&source.package_id)?;
                let targets = analyses
                    .iter()
                    .flat_map(|a| a.tokens.iter())
                    .flat_map(|t| t.targets.iter())
                    .collect::<BTreeSet<_>>();
                if targets.len() * description.capabilities.len() > 256 {
                    return Err("This subtitle window has too many alternatives for one Knowledge batch; raw subtitles remain available".into());
                }
                let keys = targets
                    .into_iter()
                    .flat_map(|target| {
                        description.capabilities.iter().map(|cap| KnowledgeKey {
                            package_id: source.package_id.clone(),
                            target_id: target.clone(),
                            capability: cap.id.clone(),
                        })
                    })
                    .collect::<Vec<_>>();
                let knowledge = self.store.knowledge(&keys).map_err(|e| e.to_string())?;
                let annotations = analyses
                    .iter()
                    .flat_map(|a| {
                        a.tokens.iter().map(|t| {
                            let states = t
                                .targets
                                .iter()
                                .map(|id| {
                                    knowledge
                                        .iter()
                                        .find(|p| {
                                            p.key.target_id == *id
                                                && p.key.capability
                                                    == description.annotation_capability
                                        })
                                        .map(|p| p.status.as_str())
                                        .unwrap_or("untracked")
                                })
                                .collect::<BTreeSet<_>>();
                            let status = if states.is_empty() {
                                "unresolved"
                            } else if states.len() == 1 {
                                states.first().unwrap()
                            } else {
                                "mixed"
                            };
                            OccurrenceKnowledge {
                                cue_index: a.cue.index,
                                token_start: t.start,
                                status: status.into(),
                            }
                        })
                    })
                    .collect();
                check(&self.cancellation, epoch)?;
                Ok(Response::Analysis {
                    batch: AnalysisBatch {
                        source_id,
                        subtitle_revision: revision,
                        package_id: source.package_id,
                        package_version: source.package_version,
                        cues: analyses,
                        knowledge,
                        annotations,
                    },
                })
            }
            _ => Err("Not a Watch action".into()),
        }
    }
}
#[cfg(test)]
mod cancellation_tests {
    use super::*;
    use std::sync::atomic::Ordering;
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
