use crate::{
    execution::{Cancellation, Failure},
    Runtime,
};
use mlearn_core::*;
use std::{collections::BTreeSet, time::Instant};

pub(super) struct AnalysisInput {
    pub source: SourceRecord,
    pub cues: Vec<Cue>,
    pub cache_key: String,
    pub cached: Option<Vec<CueAnalysis>>,
}
impl Runtime {
    pub(super) fn prepare_analysis(
        &self,
        source_id: &str,
        position_ms: u32,
    ) -> Result<AnalysisInput, Failure> {
        let source = self.source_record(source_id)?;
        let window = self.window(source.clone(), position_ms)?;
        self.analysis_input(source, window.cues)
    }
    pub(super) fn prepare_transcript_analysis(
        &self,
        source_id: &str,
        after: Option<u32>,
        query: &str,
    ) -> Result<AnalysisInput, Failure> {
        if query.len() > 128 {
            return Err(Failure::Operation(
                "Transcript search exceeds 128 bytes".into(),
            ));
        }
        let source = self.source_record(source_id)?;
        let (cues, _) = self
            .store
            .transcript_page(source_id, after, query)
            .map_err(|e| Failure::Operation(e.to_string()))?;
        self.analysis_input(source, cues)
    }
    fn analysis_input(
        &self,
        source: SourceRecord,
        cues: Vec<Cue>,
    ) -> Result<AnalysisInput, Failure> {
        let revision = source.subtitle_revision.as_ref().ok_or_else(|| {
            Failure::Operation("Select an external SRT subtitle file first".into())
        })?;
        let installed = self.installed.get(&source.package_id).ok_or_else(|| {
            Failure::Operation("Language package unavailable; install it and retry".into())
        })?;
        if installed.manifest.version != source.package_version {
            return Err(Failure::Operation("Saved source requires its original package version; reselect the source language explicitly".into()));
        }
        let cache_key = format!(
            "{}|{}|{}|{}|{:?}",
            source.id,
            revision,
            source.package_id,
            source.package_version,
            cues.iter().map(|c| c.index).collect::<Vec<_>>()
        );
        let cached = self
            .analysis_cache
            .iter()
            .find(|(key, _)| key == &cache_key)
            .map(|(_, value)| value.clone());
        if std::env::var_os("MLEARN_PLUGIN_METRICS").is_some() {
            eprintln!(
                "runtime-analysis owner=analysis phase=prepare cache_hit={} cue_count={}",
                cached.is_some(),
                cues.len()
            );
        }
        Ok(AnalysisInput {
            source,
            cues,
            cache_key,
            cached,
        })
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
            (None, Some(tokens)) => validate(&input.cues, tokens, &input.source.package_id)?,
            _ => {
                return Err(Failure::Operation(
                    "Analysis result does not match prepared input".into(),
                ))
            }
        };
        let targets = analyses
            .iter()
            .flat_map(|a| &a.tokens)
            .flat_map(|t| &t.targets)
            .collect::<BTreeSet<_>>();
        if targets.len() * description.capabilities.len() > 256 {
            return Err(Failure::Operation("This subtitle window has too many alternatives for one Knowledge batch; raw subtitles remain available".into()));
        }
        let keys = targets
            .into_iter()
            .flat_map(|target| {
                description.capabilities.iter().map(|cap| KnowledgeKey {
                    package_id: input.source.package_id.clone(),
                    target_id: target.clone(),
                    capability: cap.id.clone(),
                })
            })
            .collect::<Vec<_>>();
        // Knowledge is authoritative at completion, never captured with guest input.
        let started = std::env::var_os("MLEARN_PLUGIN_METRICS")
            .is_some()
            .then(Instant::now);
        let knowledge = self.store.knowledge(&keys);
        if let Some(started) = started {
            eprintln!("runtime-analysis owner=analysis phase=knowledge elapsed_us={} key_count={} cache_hit={} cue_count={} success={}",
                started.elapsed().as_micros(), keys.len(), input.cached.is_some(), input.cues.len(), knowledge.is_ok());
        }
        let knowledge = knowledge.map_err(|e| Failure::Operation(e.to_string()))?;
        let annotations = analyses
            .iter()
            .flat_map(|a| {
                a.tokens.iter().map(|token| {
                    let states = token
                        .targets
                        .iter()
                        .map(|id| {
                            knowledge
                                .iter()
                                .find(|p| {
                                    p.key.target_id == *id
                                        && p.key.capability == description.annotation_capability
                                })
                                .map(|p| p.status.as_str())
                                .unwrap_or("untracked")
                        })
                        .collect::<BTreeSet<_>>();
                    let status = match states.len() {
                        0 => "unresolved",
                        1 => states.first().copied().unwrap_or("unresolved"),
                        _ => "mixed",
                    };
                    OccurrenceKnowledge {
                        cue_index: a.cue.index,
                        token_start: token.start,
                        status: status.into(),
                    }
                })
            })
            .collect();
        cancellation.check()?;
        if input.cached.is_none() {
            if self.analysis_cache.len() >= 8 {
                self.analysis_cache.pop_front();
            }
            self.analysis_cache
                .push_back((input.cache_key.clone(), analyses.clone()));
        }
        Ok(Response::Analysis {
            batch: AnalysisBatch {
                source_id: input.source.id.clone(),
                subtitle_revision: input.source.subtitle_revision.clone().ok_or_else(|| {
                    Failure::Operation("Analysis source has no subtitle revision".into())
                })?,
                package_id: input.source.package_id.clone(),
                package_version: input.source.package_version.clone(),
                package_revision: self
                    .installed
                    .get(&input.source.package_id)
                    .ok_or(Failure::Cancelled)?
                    .revision()?,
                cues: analyses,
                knowledge,
                annotations,
            },
        })
    }
}
fn validate(
    cues: &[Cue],
    batches: &[Vec<AnalyzedToken>],
    package: &str,
) -> Result<Vec<CueAnalysis>, Failure> {
    if batches.len() != cues.len() {
        return Err(Failure::Operation(
            "Package returned the wrong analysis batch length".into(),
        ));
    }
    let mut result = Vec::new();
    let mut presentation_bytes = 0;
    for (cue, tokens) in cues.iter().zip(batches) {
        let mut cursor = 0;
        for token in tokens {
            presentation_bytes +=
                crate::linguistic::validate(&token.presentation, &token.text, package)?;
            if presentation_bytes > 131072 {
                return Err(Failure::Operation(
                    "Analysis linguistic presentation exceeds 128 KiB".into(),
                ));
            }
            let start =
                usize::try_from(token.start).map_err(|e| Failure::Operation(e.to_string()))?;
            let end = usize::try_from(token.end).map_err(|e| Failure::Operation(e.to_string()))?;
            if start != cursor
                || end <= start
                || cue.text.get(cursor..end) != Some(token.text.as_str())
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
        if cursor != cue.text.len() || tokens.len() > 512 {
            return Err(Failure::Operation(
                "Package analysis did not cover the untouched source text".into(),
            ));
        }
        result.push(CueAnalysis {
            cue: cue.clone(),
            tokens: tokens.clone(),
        });
    }
    Ok(result)
}
