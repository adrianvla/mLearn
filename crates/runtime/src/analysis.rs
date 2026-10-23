use crate::{
    Runtime,
    execution::{Cancellation, Failure},
};
use mlearn_core::*;
use std::{collections::BTreeSet, time::Instant};

pub(super) enum AnalysisSource {
    Video {
        source: SourceRecord,
        cues: Vec<Cue>,
    },
    Document {
        source: DocumentRecord,
        slices: Vec<DocumentSlice>,
    },
}
pub(super) struct DocumentSlice {
    pub block: DocumentBlock,
    pub start: usize,
    pub end: usize,
}
pub(super) struct AnalysisInput {
    pub source: AnalysisSource,
    pub cache_key: String,
    pub cached: Option<Vec<Vec<AnalyzedToken>>>,
}
impl AnalysisInput {
    pub fn package_id(&self) -> &str {
        match &self.source {
            AnalysisSource::Video { source, .. } => &source.package_id,
            AnalysisSource::Document { source, .. } => &source.package_id,
        }
    }
    pub fn texts(&self) -> Vec<&str> {
        match &self.source {
            AnalysisSource::Video { cues, .. } => {
                cues.iter().map(|cue| cue.text.as_str()).collect()
            }
            AnalysisSource::Document { slices, .. } => slices
                .iter()
                .map(|slice| &slice.block.text[slice.start..slice.end])
                .collect(),
        }
    }
}
impl Runtime {
    pub(super) fn prepare_analysis(
        &self,
        id: &str,
        position: u32,
    ) -> Result<AnalysisInput, Failure> {
        let source = self.source_record(id)?;
        let window = self.window(source.clone(), position)?;
        self.video_analysis(source, window.cues)
    }
    pub(super) fn prepare_transcript_analysis(
        &self,
        id: &str,
        after: Option<u32>,
        query: &str,
    ) -> Result<AnalysisInput, Failure> {
        if query.len() > 128 {
            return Err(Failure::Operation(
                "Transcript search exceeds 128 bytes".into(),
            ));
        }
        let source = self.source_record(id)?;
        let (cues, _) = self
            .store
            .transcript_page(id, after, query)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        self.video_analysis(source, cues)
    }
    fn video_analysis(
        &self,
        source: SourceRecord,
        cues: Vec<Cue>,
    ) -> Result<AnalysisInput, Failure> {
        let revision = source.subtitle_revision.as_ref().ok_or_else(|| {
            Failure::Operation("Select an external SRT subtitle file first".into())
        })?;
        let key = format!(
            "{}|{}|{}|{}|{:?}",
            source.id,
            revision,
            source.package_id,
            source.package_version,
            cues.iter().map(|cue| cue.index).collect::<Vec<_>>()
        );
        self.analysis_input(AnalysisSource::Video { source, cues }, key)
    }
    pub(super) fn prepare_document_analysis(
        &self,
        id: &str,
        position: Option<&DocumentPosition>,
    ) -> Result<AnalysisInput, Failure> {
        let window = self
            .store
            .document_window(id, position)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        let position = position.or(window.source.position.as_ref()).cloned();
        let mut slices = Vec::new();
        for block in window
            .blocks
            .into_iter()
            .filter(|block| block.image.is_none() && !block.text.is_empty())
            // Admission follows the visible source passage. A prefetched block
            // in another language must not reject this passage's valid analysis.
            .take(1)
        {
            let offset = position
                .as_ref()
                .filter(|value| value.resource == block.resource && value.block_id == block.id)
                .map_or(0, |value| value.offset as usize)
                .min(block.text.len() - 1);
            // A viewport moves among stable source chunks, not one fresh analysis per pixel.
            let mut start = offset / 1024 * 1024;
            while !block.text.is_char_boundary(start) {
                start -= 1;
            }
            let mut end = (start + 1024).min(block.text.len());
            while !block.text.is_char_boundary(end) {
                end -= 1;
            }
            slices.push(DocumentSlice { block, start, end });
        }
        let source = window.source;
        let key = format!(
            "{}|{}|{}|{}|{}|{:?}",
            source.id,
            source.content_revision,
            source.parser_revision,
            source.package_id,
            source.package_version,
            slices
                .iter()
                .map(|slice| (
                    &slice.block.resource,
                    &slice.block.id,
                    slice.start,
                    slice.end
                ))
                .collect::<Vec<_>>()
        );
        self.analysis_input(AnalysisSource::Document { source, slices }, key)
    }
    fn analysis_input(
        &self,
        source: AnalysisSource,
        cache_key: String,
    ) -> Result<AnalysisInput, Failure> {
        let (package_id, version) = match &source {
            AnalysisSource::Video { source, .. } => (&source.package_id, &source.package_version),
            AnalysisSource::Document { source, .. } => {
                (&source.package_id, &source.package_version)
            }
        };
        let installed = self.installed.get(package_id).ok_or_else(|| {
            Failure::Operation("Language package unavailable; install it and retry".into())
        })?;
        if &installed.manifest.version != version {
            return Err(Failure::Operation("Saved source requires its original package version; reselect the source language explicitly".into()));
        }
        let cached = self
            .analysis_cache
            .iter()
            .find(|(key, _)| key == &cache_key)
            .map(|(_, tokens)| tokens.clone());
        let input = AnalysisInput {
            source,
            cache_key,
            cached,
        };
        if std::env::var_os("MLEARN_PLUGIN_METRICS").is_some() {
            eprintln!(
                "runtime-analysis owner=analysis phase=prepare cache_hit={} cue_count={}",
                input.cached.is_some(),
                input.texts().len()
            );
        }
        Ok(input)
    }
    pub(super) fn validate_analysis_source(&self, input: &AnalysisInput) -> Result<(), Failure> {
        let valid = match &input.source {
            AnalysisSource::Video { source, .. } => {
                let current = self.source_record(&source.id)?;
                current.media_revision == source.media_revision
                    && current.subtitle_revision == source.subtitle_revision
                    && current.package_id == source.package_id
                    && current.package_version == source.package_version
                    && current.subtitle_offset_ms == source.subtitle_offset_ms
            }
            AnalysisSource::Document { source, .. } => self
                .store
                .document(&source.id)
                .map_err(|error| Failure::Operation(error.to_string()))?
                .is_some_and(|current| {
                    current.content_revision == source.content_revision
                        && current.parser_revision == source.parser_revision
                        && current.package_id == source.package_id
                        && current.package_version == source.package_version
                }),
        };
        if valid {
            Ok(())
        } else {
            Err(Failure::Cancelled)
        }
    }
    pub(super) fn complete_analysis(
        &mut self,
        input: &AnalysisInput,
        output: (&Option<Vec<Vec<AnalyzedToken>>>, &LanguageDescription),
        cancellation: &Cancellation,
    ) -> Result<Response, Failure> {
        let (tokens, description) = output;
        let analyses = match (&input.cached, tokens) {
            (Some(cached), None) => cached.clone(),
            (None, Some(tokens)) => validate(&input.texts(), tokens, input.package_id())?,
            _ => {
                return Err(Failure::Operation(
                    "Analysis result does not match prepared input".into(),
                ));
            }
        };
        let targets = analyses
            .iter()
            .flatten()
            .flat_map(|token| &token.targets)
            .collect::<BTreeSet<_>>();
        if targets.len() > 256 {
            return Err(Failure::Operation("This source window has too many alternatives for one Knowledge batch; raw source text remains available".into()));
        }
        let keys = targets
            .into_iter()
            .map(|target| KnowledgeKey {
                package_id: input.package_id().into(),
                target_id: target.clone(),
                capability: description.annotation_capability.clone(),
            })
            .collect::<Vec<_>>();
        let started = std::env::var_os("MLEARN_PLUGIN_METRICS")
            .is_some()
            .then(Instant::now);
        let knowledge = self.store.knowledge(&keys);
        if let Some(started) = started {
            eprintln!(
                "runtime-analysis owner=analysis phase=knowledge elapsed_us={} key_count={} cache_hit={} cue_count={} success={}",
                started.elapsed().as_micros(),
                keys.len(),
                input.cached.is_some(),
                input.texts().len(),
                knowledge.is_ok()
            );
        }
        let knowledge = knowledge.map_err(|error| Failure::Operation(error.to_string()))?;
        let statuses = analyses
            .iter()
            .map(|tokens| {
                tokens
                    .iter()
                    .map(|token| {
                        let states = token
                            .targets
                            .iter()
                            .map(|id| {
                                knowledge
                                    .iter()
                                    .find(|projection| {
                                        projection.key.target_id == *id
                                            && projection.key.capability
                                                == description.annotation_capability
                                    })
                                    .map_or("untracked", |projection| projection.status.as_str())
                            })
                            .collect::<BTreeSet<_>>();
                        match states.len() {
                            0 => "unresolved".to_owned(),
                            1 => states.first().copied().unwrap_or("unresolved").to_owned(),
                            _ => "mixed".to_owned(),
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        cancellation.check()?;
        if input.cached.is_none() {
            if self.analysis_cache.len() >= 8 {
                self.analysis_cache.pop_front();
            }
            self.analysis_cache
                .push_back((input.cache_key.clone(), analyses.clone()));
        }
        let package_revision = self
            .installed
            .get(input.package_id())
            .ok_or(Failure::Cancelled)?
            .revision()?;
        match &input.source {
            AnalysisSource::Video { source, cues } => {
                let annotations = cues
                    .iter()
                    .zip(&analyses)
                    .zip(&statuses)
                    .flat_map(|((cue, tokens), statuses)| {
                        tokens
                            .iter()
                            .zip(statuses)
                            .map(|(token, status)| OccurrenceKnowledge {
                                cue_index: cue.index,
                                token_start: token.start,
                                status: status.clone(),
                            })
                    })
                    .collect();
                Ok(Response::Analysis {
                    batch: AnalysisBatch {
                        source_id: source.id.clone(),
                        subtitle_revision: source
                            .subtitle_revision
                            .clone()
                            .ok_or(Failure::Cancelled)?,
                        package_id: source.package_id.clone(),
                        package_version: source.package_version.clone(),
                        package_revision,
                        cues: cues
                            .iter()
                            .zip(analyses)
                            .map(|(cue, tokens)| CueAnalysis {
                                cue: cue.clone(),
                                tokens,
                            })
                            .collect(),
                        knowledge,
                        annotations,
                    },
                })
            }
            AnalysisSource::Document { source, slices } => {
                let mut blocks = Vec::new();
                let mut annotations = Vec::new();
                for ((slice, mut tokens), statuses) in slices.iter().zip(analyses).zip(statuses) {
                    let start = u32::try_from(slice.start)
                        .map_err(|error| Failure::Operation(error.to_string()))?;
                    for (token, status) in tokens.iter_mut().zip(statuses) {
                        token.start += start;
                        token.end += start;
                        annotations.push(DocumentOccurrenceKnowledge {
                            resource: slice.block.resource.clone(),
                            block_id: slice.block.id.clone(),
                            token_start: token.start,
                            status,
                        });
                    }
                    blocks.push(DocumentAnalyzedBlock {
                        resource: slice.block.resource.clone(),
                        block_id: slice.block.id.clone(),
                        start,
                        text: slice.block.text[slice.start..slice.end].into(),
                        tokens,
                    });
                }
                Ok(Response::DocumentAnalysis {
                    batch: DocumentAnalysisBatch {
                        source_id: source.id.clone(),
                        content_revision: source.content_revision.clone(),
                        parser_revision: source.parser_revision.clone(),
                        package_id: source.package_id.clone(),
                        package_version: source.package_version.clone(),
                        package_revision,
                        blocks,
                        knowledge,
                        annotations,
                    },
                })
            }
        }
    }
}

fn validate(
    texts: &[&str],
    batches: &[Vec<AnalyzedToken>],
    package: &str,
) -> Result<Vec<Vec<AnalyzedToken>>, Failure> {
    if batches.len() != texts.len() {
        return Err(Failure::Operation(
            "Package returned the wrong analysis batch length".into(),
        ));
    }
    let mut presentation_bytes = 0;
    for (text, tokens) in texts.iter().zip(batches) {
        let mut cursor = 0;
        for token in tokens {
            presentation_bytes +=
                crate::linguistic::validate(&token.presentation, &token.text, package)?;
            if presentation_bytes > 131072 {
                return Err(Failure::Operation(
                    "Analysis linguistic presentation exceeds 128 KiB".into(),
                ));
            }
            let start = usize::try_from(token.start)
                .map_err(|error| Failure::Operation(error.to_string()))?;
            let end = usize::try_from(token.end)
                .map_err(|error| Failure::Operation(error.to_string()))?;
            if start != cursor
                || end <= start
                || text.get(cursor..end) != Some(token.text.as_str())
                || token.targets.len() > 128
                || token
                    .targets
                    .iter()
                    .any(|id| id.is_empty() || id.len() > 512)
            {
                return Err(Failure::Operation(
                    "Package returned invalid UTF-8 source spans or targets".into(),
                ));
            }
            cursor = end;
        }
        if cursor != text.len() || tokens.len() > 512 {
            return Err(Failure::Operation(
                "Package analysis did not cover the untouched source text".into(),
            ));
        }
    }
    Ok(batches.to_vec())
}
