use crate::{
    Installed, Runtime,
    execution::Failure,
    guest::{GuestOutput, GuestWork, LanguageAction},
};
use mlearn_core::{Request, Response};
use std::sync::Arc;

impl Runtime {
    pub(crate) fn complete(
        &mut self,
        work: &GuestWork,
        output: &mut GuestOutput,
    ) -> Result<(Response, Option<Installed>), Failure> {
        match work {
            GuestWork::Language(work) => {
                work.cancellation.check()?;
                let current = self
                    .installed
                    .get(&work.package.manifest.id)
                    .ok_or(Failure::Cancelled)?;
                if current.manifest.version != work.package.manifest.version
                    || !Arc::ptr_eq(&current.compiled, &work.package.compiled)
                {
                    return Err(Failure::Cancelled);
                }
                let source = match &work.action {
                    LanguageAction::Analyze(input) => Some(&input.source),
                    LanguageAction::Summaries { source, .. } => Some(source),
                    _ => None,
                };
                if let Some(source) = source {
                    let current = self.source_record(&source.id)?;
                    if current.id != source.id
                        || current.media_revision != source.media_revision
                        || current.subtitle_revision != source.subtitle_revision
                        || current.package_id != source.package_id
                        || current.package_version != source.package_version
                        || current.subtitle_offset_ms != source.subtitle_offset_ms
                    {
                        return Err(Failure::Cancelled);
                    }
                }
                let response = match (&work.action, output) {
                    (LanguageAction::EditMaterial(command), GuestOutput::Entry(_)) => {
                        Response::MaterialWritten {
                            outcome: self.write_material_edit(command)?,
                        }
                    }
                    (
                        LanguageAction::Capture { inputs, delivery },
                        GuestOutput::Capture(checks),
                    ) => {
                        self.complete_material_capture(inputs, std::mem::take(checks), *delivery)?
                    }
                    (LanguageAction::SelectSourceLanguage { source_id }, GuestOutput::Open) => {
                        let mut source = self.source_record(source_id)?;
                        source.package_id = work.package.manifest.id.clone();
                        source.package_version = work.package.manifest.version.clone();
                        let window = self.window(source.clone(), source.position_ms)?;
                        self.store
                            .save_source(&source)
                            .map_err(|e| Failure::Operation(e.to_string()))?;
                        self.analysis_cache
                            .retain(|(key, _)| !key.starts_with(source_id));
                        Response::Source { window }
                    }
                    (LanguageAction::Open { path }, GuestOutput::Open) => {
                        let response = self.watch(
                            Request::OpenSource {
                                path: path.clone(),
                                package_id: work.package.manifest.id.clone(),
                            },
                            work.cancellation.epoch,
                        );
                        work.cancellation.check()?;
                        response?
                    }
                    (LanguageAction::Describe, GuestOutput::Description(description)) => {
                        Response::Language {
                            description: description.clone(),
                        }
                    }
                    (LanguageAction::Inspect { .. }, GuestOutput::Entry(entry)) => {
                        Response::Entry {
                            entry: entry.clone(),
                            package_version: work.package.manifest.version.clone(),
                            package_revision: work.package.revision()?,
                            knowledge: self.target_knowledge(&work.package.manifest.id, entry)?,
                        }
                    }
                    (LanguageAction::Summaries { source, .. }, GuestOutput::Dictionary(items)) => {
                        Response::Dictionary {
                            batch: mlearn_core::DictionaryBatch {
                                source_id: source.id.clone(),
                                subtitle_revision: source
                                    .subtitle_revision
                                    .clone()
                                    .ok_or(Failure::Cancelled)?,
                                package_id: source.package_id.clone(),
                                package_version: source.package_version.clone(),
                                package_revision: work.package.revision()?,
                                items: items.clone(),
                            },
                        }
                    }
                    (LanguageAction::Claim(change), GuestOutput::Entry(_)) => {
                        Response::ClaimChanged {
                            projection: self
                                .store
                                .change_claim(change)
                                .map_err(|e| Failure::Operation(e.to_string()))?,
                        }
                    }
                    (
                        LanguageAction::Analyze(input),
                        GuestOutput::Analysis {
                            tokens,
                            description,
                        },
                    ) => {
                        self.complete_analysis(input, (tokens, description), &work.cancellation)?
                    }
                    (LanguageAction::Invoke { .. }, GuestOutput::Plugin(value)) => {
                        Response::PluginResult {
                            output: value.clone(),
                        }
                    }
                    _ => {
                        return Err(Failure::Operation(
                            "Guest result does not match prepared action".into(),
                        ));
                    }
                };
                Ok((response, None))
            }
            GuestWork::Install { transfer, .. } => {
                let command = transfer.command()?;
                transfer.commit(|| {
                    let GuestOutput::Installed(pending) = output else {
                        return Err(Failure::Operation(
                            "Missing installed package result".into(),
                        ));
                    };
                    let installed = pending.as_ref().ok_or_else(|| {
                        Failure::Operation("Installed package already committed".into())
                    })?;
                    let plugin = crate::summary(&installed.manifest);
                    let manifest = serde_json::to_string(&installed.manifest)
                        .map_err(|e| Failure::Operation(e.to_string()))?;
                    if command.command_id.starts_with("native:") {
                        self.store
                            .activate_plugin(&installed.manifest.id, &manifest)
                    } else {
                        self.store
                            .activate_plugin_command(&command, &manifest, plugin.clone())
                    }
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                    let installed = pending.take().ok_or_else(|| {
                        Failure::Operation("Installed package already committed".into())
                    })?;
                    self.package_issues.remove(&installed.manifest.id);
                    let retired = self
                        .installed
                        .insert(installed.manifest.id.clone(), installed);
                    // Versions are not artifact identities: an authenticated replacement
                    // may keep its version while changing code or resource semantics.
                    self.analysis_cache.clear();
                    Ok((Response::Installed { plugin }, retired))
                })
            }
            GuestWork::Catalog(_) => {
                let GuestOutput::Catalog(manifests) = output else {
                    return Err(Failure::Operation("Missing catalog result".into()));
                };
                Ok((
                    Response::Packages {
                        plugins: manifests.iter().map(crate::summary).collect(),
                    },
                    None,
                ))
            }
        }
    }
}
