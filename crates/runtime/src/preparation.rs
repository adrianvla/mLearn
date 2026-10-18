use crate::{Installed, Runtime, execution::{Cancellation, Failure}, guest::{GuestOutput, GuestWork, LanguageAction, LanguageWork, Prepared}};
use mlearn_core::{Request, Response};
use std::sync::Arc;

impl Runtime {
    pub(crate) fn prepare(&mut self, request: Request, epoch: u64) -> Result<Prepared, Failure> {
        let cancellation = Cancellation::source(self.cancellation.clone(), epoch);
        match request {
            Request::AnalyzeSource { source_id, position_ms } => {
                cancellation.check()?;
                let input = self.prepare_analysis(&source_id, position_ms)?;
                let package_id = input.source.package_id.clone();
                self.language_work(&package_id, LanguageAction::Analyze(input), cancellation)
            }
            Request::OpenSource { path, package_id } => {
                cancellation.check()?;
                self.language_work(&package_id, LanguageAction::Open { path }, cancellation)
            }
            Request::DescribeLanguage { package_id } => self.language_work(&package_id, LanguageAction::Describe, cancellation),
            Request::InspectTarget { package_id, target_id } => self.language_work(&package_id, LanguageAction::Inspect { target_id }, cancellation),
            Request::ChangeClaim { change } => {
                let package_id = change.key.package_id.clone();
                self.language_work(&package_id, LanguageAction::Claim(change), Cancellation::durable())
            }
            Request::InvokePlugin { plugin_id, capability, input } => self.language_work(&plugin_id, LanguageAction::Invoke { capability, input }, cancellation),
            Request::InstallPlugin { plugin_id } => {
                self.policy.authorize(mlearn_language_host::CodeOrigin::Download)?;
                let catalog = self.catalog.as_ref().ok_or_else(|| Failure::Operation("No trusted desktop plugin catalog configured".into()))?.clone();
                Ok(Prepared::Work(GuestWork::Install { root: self.root.clone(), catalog, plugin_id }))
            }
            Request::AvailablePackages => {
                let catalog = self.catalog.as_ref().ok_or_else(|| Failure::Operation("No trusted catalog configured".into()))?.clone();
                Ok(Prepared::Work(GuestWork::Catalog(catalog)))
            }
            request @ (Request::ResumeSource { .. } | Request::AttachSubtitles { .. }) => {
                cancellation.check()?;
                let response = self.watch(request, epoch);
                cancellation.check()?;
                Ok(Prepared::Immediate(Box::new(response?)))
            }
            request @ (Request::Snapshot | Request::RecentSources | Request::SourceWindow { .. }
                | Request::SavePosition { .. } | Request::Knowledge { .. } | Request::SaveTheme { .. }) => {
                Ok(Prepared::Immediate(Box::new(self.metadata(request)?)))
            }
        }
    }
    fn language_work(&self, package_id: &str, action: LanguageAction, cancellation: Cancellation) -> Result<Prepared, Failure> {
        let package = self.installed.get(package_id).ok_or_else(|| Failure::Operation("Language package unavailable; install its compatible version and retry".into()))?.clone();
        Ok(Prepared::Work(GuestWork::Language(Box::new(LanguageWork { package, cancellation, action }))))
    }
    pub(crate) fn complete(&mut self, work: &GuestWork, output: &mut GuestOutput) -> Result<(Response, Option<Installed>), Failure> {
        match work {
            GuestWork::Language(work) => {
                work.cancellation.check()?;
                let current = self.installed.get(&work.package.manifest.id).ok_or(Failure::Cancelled)?;
                if current.manifest.version != work.package.manifest.version || !Arc::ptr_eq(&current.compiled, &work.package.compiled) {
                    return Err(Failure::Cancelled);
                }
                if let LanguageAction::Analyze(input) = &work.action {
                    let current = self.source_record(&input.source.id)?;
                    if current.id != input.source.id || current.media_revision != input.source.media_revision
                        || current.subtitle_revision != input.source.subtitle_revision
                        || current.package_id != input.source.package_id || current.package_version != input.source.package_version
                    {
                        return Err(Failure::Cancelled);
                    }
                }
                let response = match (&work.action, output) {
                    (LanguageAction::Open { path }, GuestOutput::Open) => {
                        let response = self.watch(Request::OpenSource { path: path.clone(), package_id: work.package.manifest.id.clone() }, work.cancellation.epoch);
                        work.cancellation.check()?;
                        response?
                    }
                    (LanguageAction::Describe, GuestOutput::Description(description)) => Response::Language { description: description.clone() },
                    (LanguageAction::Inspect { .. }, GuestOutput::Entry(entry)) => Response::Entry { entry: entry.clone() },
                    (LanguageAction::Claim(change), GuestOutput::Entry(_)) => Response::ClaimChanged {
                        projection: self.store.change_claim(change).map_err(|e| Failure::Operation(e.to_string()))?,
                    },
                    (LanguageAction::Analyze(input), GuestOutput::Analysis { tokens, description }) => {
                        self.complete_analysis(input, (tokens, description), &work.cancellation)?
                    }
                    (LanguageAction::Invoke { .. }, GuestOutput::Plugin(value)) => Response::PluginResult { output: value.clone() },
                    _ => return Err(Failure::Operation("Guest result does not match prepared action".into())),
                };
                Ok((response, None))
            }
            GuestWork::Install { .. } => {
                let GuestOutput::Installed(pending) = output else {
                    return Err(Failure::Operation("Missing installed package result".into()));
                };
                let installed = pending.as_ref().ok_or_else(|| Failure::Operation("Installed package already committed".into()))?;
                let plugin = crate::summary(&installed.manifest);
                self.store.activate_plugin(&installed.manifest.id, &serde_json::to_string(&installed.manifest).map_err(|e| Failure::Operation(e.to_string()))?)
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                let installed = pending.take().ok_or_else(|| Failure::Operation("Installed package already committed".into()))?;
                let retired = self.installed.insert(installed.manifest.id.clone(), installed);
                Ok((Response::Installed { plugin }, retired))
            }
            GuestWork::Catalog(_) => {
                let GuestOutput::Catalog(manifests) = output else {
                    return Err(Failure::Operation("Missing catalog result".into()));
                };
                Ok((Response::Packages { plugins: manifests.iter().map(crate::summary).collect() }, None))
            }
        }
    }
}
