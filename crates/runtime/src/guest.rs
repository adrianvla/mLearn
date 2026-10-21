use crate::{
    analysis::AnalysisInput,
    catalog::CatalogClient,
    execution::{Cancellation, Failure},
    Installed,
};
use mlearn_core::{
    AnalyzedToken, ClaimChange, DictionaryResult, LanguageDescription, LexicalEntry,
    LexicalSummary, Response, SourceRecord,
};
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};

pub(super) enum Prepared {
    Immediate(Box<Response>),
    Work(GuestWork),
}
pub(super) enum GuestWork {
    Language(Box<LanguageWork>),
    Install {
        root: PathBuf,
        catalog: Arc<CatalogClient>,
        plugin_id: String,
        transfer: crate::packages::InstallTransfer,
    },
    Catalog(Arc<CatalogClient>),
}
pub(super) struct LanguageWork {
    pub package: Installed,
    pub cancellation: Cancellation,
    pub action: LanguageAction,
}
pub(super) enum LanguageAction {
    Open {
        path: String,
    },
    SelectSourceLanguage {
        source_id: String,
    },
    Describe,
    Inspect {
        target_id: String,
    },
    Summaries {
        source: SourceRecord,
        targets: Vec<String>,
    },
    Claim(ClaimChange),
    Analyze(AnalysisInput),
    Invoke {
        capability: String,
        input: Value,
    },
}
pub(super) enum GuestOutput {
    Open,
    Description(LanguageDescription),
    Entry(LexicalEntry),
    Dictionary(Vec<DictionaryResult>),
    Analysis {
        tokens: Option<Vec<Vec<AnalyzedToken>>>,
        description: LanguageDescription,
    },
    Plugin(Value),
    Installed(Option<Installed>),
    Catalog(Vec<crate::catalog::Manifest>),
}
impl GuestWork {
    pub fn run(&self) -> Result<GuestOutput, Failure> {
        match self {
            Self::Language(work) => {
                work.cancellation.check()?;
                let output = match &work.action {
                    LanguageAction::Open { .. } | LanguageAction::SelectSourceLanguage { .. } => {
                        work.description()?;
                        GuestOutput::Open
                    }
                    LanguageAction::Describe => GuestOutput::Description(work.description()?),
                    LanguageAction::Inspect { target_id } => {
                        GuestOutput::Entry(work.entry(target_id)?)
                    }
                    LanguageAction::Summaries { targets, .. } => {
                        let schema = work.description()?;
                        let mut items = Vec::new();
                        for target in targets {
                            work.cancellation.check()?;
                            items.push(match work.entry_with_schema(target, &schema) {
                                Ok(entry) => {
                                    let summary = entry
                                        .summary
                                        .as_deref()
                                        .unwrap_or(&entry.definition)
                                        .lines()
                                        .next()
                                        .unwrap_or("")
                                        .chars()
                                        .take(512)
                                        .collect::<String>();
                                    DictionaryResult::Available {
                                        summary: LexicalSummary {
                                            target_id: entry.target_id,
                                            headword: entry.headword,
                                            reading: entry.reading,
                                            summary,
                                            presentation: entry.presentation,
                                        },
                                    }
                                }
                                Err(Failure::Cancelled) => return Err(Failure::Cancelled),
                                Err(error) => DictionaryResult::Unavailable {
                                    target_id: target.clone(),
                                    message: error.to_string().chars().take(256).collect(),
                                },
                            });
                        }
                        GuestOutput::Dictionary(items)
                    }
                    LanguageAction::Claim(change) => {
                        let entry = work.entry(&change.key.target_id)?;
                        if !entry
                            .capabilities
                            .iter()
                            .any(|c| c.id == change.key.capability)
                        {
                            return Err(Failure::Operation(
                                "This target does not declare the selected capability".into(),
                            ));
                        }
                        GuestOutput::Entry(entry)
                    }
                    LanguageAction::Analyze(input) => {
                        let tokens = if input.cached.is_some() {
                            None
                        } else {
                            let texts = input
                                .cues
                                .iter()
                                .map(|c| c.text.as_str())
                                .collect::<Vec<_>>();
                            Some(
                                serde_json::from_value(work.invoke(
                                    "text.analyze.v1",
                                    serde_json::json!({"texts":texts}),
                                )?)
                                .map_err(|e| Failure::Operation(e.to_string()))?,
                            )
                        };
                        GuestOutput::Analysis {
                            tokens,
                            description: work.description()?,
                        }
                    }
                    LanguageAction::Invoke { capability, input } => {
                        GuestOutput::Plugin(work.invoke(capability, input.clone())?)
                    }
                };
                work.cancellation.check()?;
                Ok(output)
            }
            Self::Install {
                root,
                catalog,
                plugin_id,
                transfer,
            } => Ok(GuestOutput::Installed(Some(crate::packages::install(
                root, catalog, plugin_id, transfer,
            )?))),
            Self::Catalog(catalog) => Ok(GuestOutput::Catalog(catalog.manifests()?)),
        }
    }
    pub fn finish(&self, result: Result<Response, Failure>) -> Result<Response, Failure> {
        match self {
            Self::Install { transfer, .. } => transfer.finish(result),
            Self::Language(_) | Self::Catalog(_) => result,
        }
    }
    pub fn capability(&self) -> &str {
        match self {
            Self::Language(work) => match &work.action {
                LanguageAction::Analyze(_) => "text.analyze.v1",
                LanguageAction::Inspect { .. }
                | LanguageAction::Summaries { .. }
                | LanguageAction::Claim(_) => "target.inspect.v1",
                LanguageAction::Open { .. }
                | LanguageAction::SelectSourceLanguage { .. }
                | LanguageAction::Describe => "language.describe.v1",
                LanguageAction::Invoke { capability, .. } => capability,
            },
            Self::Install { .. } => "package.install",
            Self::Catalog(_) => "package.catalog",
        }
    }
}
#[path = "preparation.rs"]
mod preparation;
