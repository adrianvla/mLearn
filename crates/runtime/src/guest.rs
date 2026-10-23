use crate::{
    Installed,
    analysis::AnalysisInput,
    catalog::CatalogClient,
    execution::{Cancellation, Failure},
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
    Review(Box<crate::review::ReviewWork>),
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
    EditMaterial(Box<mlearn_core::MaterialEdit>),
    Capture {
        inputs: Vec<crate::capture::CaptureInput>,
        delivery: crate::capture::CaptureDelivery,
    },
    Open {
        path: String,
    },
    OpenDocument {
        root: PathBuf,
        path: String,
    },
    SelectSourceLanguage {
        source_id: String,
    },
    SelectDocumentLanguage {
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
    Review(Vec<mlearn_core::ReviewAdmission>),
    Capture(Vec<Result<(), String>>),
    Open,
    Document(Box<crate::document_import::PreparedDocument>),
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
            Self::Review(work) => Ok(GuestOutput::Review(work.run()?)),
            Self::Language(work) => {
                work.cancellation.check()?;
                let output = match &work.action {
                    LanguageAction::OpenDocument { root, path } => {
                        work.description()?;
                        GuestOutput::Document(Box::new(crate::document_import::prepare(
                            root,
                            path,
                            &work.package.manifest.id,
                            &work.package.manifest.version,
                            &work.cancellation,
                        )?))
                    }
                    LanguageAction::EditMaterial(command) => {
                        let target = command.content.target_id.as_deref().ok_or_else(|| {
                            Failure::Operation("Missing edited target identity".into())
                        })?;
                        let entry = work.entry(target)?;
                        if let Some(sense) = &command.content.sense
                            && !entry
                                .senses
                                .as_ref()
                                .is_some_and(|senses| senses.contains(sense))
                        {
                            return Err(Failure::Operation(
                                "Selected dictionary sense changed; inspect the item again".into(),
                            ));
                        }
                        GuestOutput::Entry(entry)
                    }
                    LanguageAction::Capture { inputs, .. } => {
                        GuestOutput::Capture(work.check_capture_targets(inputs))
                    }
                    LanguageAction::Open { .. }
                    | LanguageAction::SelectSourceLanguage { .. }
                    | LanguageAction::SelectDocumentLanguage { .. } => {
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
                            let texts = input.texts();
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
            Self::Language(_) | Self::Review(_) | Self::Catalog(_) => result,
        }
    }
    pub fn capability(&self) -> &str {
        match self {
            Self::Review(_) => "learning.probes.v1",
            Self::Language(work) => match &work.action {
                LanguageAction::Analyze(_) => "text.analyze.v1",
                LanguageAction::Inspect { .. }
                | LanguageAction::EditMaterial(_)
                | LanguageAction::Capture { .. }
                | LanguageAction::Summaries { .. }
                | LanguageAction::Claim(_) => "target.inspect.v1",
                LanguageAction::OpenDocument { .. } => "document.parse",
                LanguageAction::Open { .. }
                | LanguageAction::SelectSourceLanguage { .. }
                | LanguageAction::SelectDocumentLanguage { .. }
                | LanguageAction::Describe => "language.describe.v1",
                LanguageAction::Invoke { capability, .. } => capability,
            },
            Self::Install { .. } => "package.install",
            Self::Catalog(_) => "package.catalog",
        }
    }
}
#[path = "completion.rs"]
mod completion;
#[path = "preparation.rs"]
mod preparation;
