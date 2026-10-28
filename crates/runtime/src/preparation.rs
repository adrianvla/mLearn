use crate::{
    Runtime,
    execution::{Cancellation, Failure},
    guest::{GuestWork, LanguageAction, LanguageWork, Prepared},
};
use mlearn_core::{Request, Response};

impl Runtime {
    pub(crate) fn prepare(&mut self, request: Request, epoch: u64) -> Result<Prepared, Failure> {
        let cancellation = Cancellation::source(self.cancellation.clone(), epoch);
        match request {
            Request::PrepareCollection { .. }
            | Request::CollectionPreparationStatus { .. }
            | Request::CancelCollectionPreparation { .. } => Err(Failure::Protocol(
                "requires_executor",
                "Collection task control requires the shared native executor".into(),
            )),
            Request::Conversation { command } => self.prepare_conversation(command, cancellation),
            Request::ImportImageCollection {
                paths,
                title,
                package_id,
            } => {
                cancellation.check()?;
                self.language_work(
                    &package_id,
                    LanguageAction::OpenImageCollection {
                        root: self.root.clone(),
                        paths,
                        title,
                    },
                    cancellation,
                )
            }
            Request::AnalyzeOcr {
                source_id,
                resource_id,
                ocr_revision,
                region_ids,
            } => {
                cancellation.check()?;
                let input =
                    self.prepare_ocr_analysis(&source_id, &resource_id, ocr_revision, &region_ids)?;
                let package = input.package_id().to_owned();
                self.language_work(&package, LanguageAction::Analyze(input), cancellation)
            }
            Request::PostprocessOcr {
                source_id,
                resource_id,
                ocr_revision,
            } => {
                cancellation.check()?;
                let source = self.document_record(&source_id)?;
                let current = self
                    .current_ocr_page(&source_id, &resource_id)?
                    .ok_or_else(|| {
                        Failure::Operation(
                            "Recognize this page before package interpretation".into(),
                        )
                    })?;
                let page = self
                    .store
                    .ocr_base_page(&source_id, &resource_id)
                    .map_err(|error| Failure::Operation(error.to_string()))?
                    .ok_or_else(|| {
                        Failure::Operation("Original OCR evidence is unavailable".into())
                    })?;
                if ocr_revision != page.ocr_revision && ocr_revision != current.ocr_revision {
                    return Err(Failure::Operation(
                        "OCR page changed; refresh before package interpretation".into(),
                    ));
                }
                let evidence = self
                    .store
                    .ocr_evidence(&source_id, &resource_id, current.ocr_revision)
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                if evidence.package.is_some() {
                    // current_ocr_page has already checked the package artifact.
                    return Ok(Prepared::Immediate(Box::new(Response::OcrPage {
                        page: current,
                    })));
                }
                self.language_work(
                    &source.package_id,
                    LanguageAction::PostprocessOcr(page),
                    cancellation,
                )
            }
            request @ (Request::ImagePageLocation { .. }
            | Request::PlanOcr { .. }
            | Request::OcrRecovery { .. }
            | Request::CompleteOcr { .. }
            | Request::CancelOcr { .. }
            | Request::ReadOcr { .. }
            | Request::OcrEvidence { .. }
            | Request::CorrectOcr { .. }
            | Request::ImagePage { .. }
            | Request::ImageReaderSettings { .. }
            | Request::SaveImageReaderSettings { .. }) => Ok(Prepared::Immediate(Box::new(
                self.ocr_request(request, &cancellation)?,
            ))),
            Request::OpenDocument { path, package_id } => {
                cancellation.check()?;
                self.language_work(
                    &package_id,
                    LanguageAction::OpenDocument {
                        root: self.root.clone(),
                        path,
                    },
                    cancellation,
                )
            }
            request @ (Request::ResumeDocument { .. }
            | Request::RecentDocuments
            | Request::DocumentWindow { .. }
            | Request::DocumentContents { .. }
            | Request::CheckpointDocument { .. }
            | Request::DocumentResource { .. }) => Ok(Prepared::Immediate(Box::new(
                self.document_request(request, &cancellation)?,
            ))),
            Request::AnalyzeDocument {
                source_id,
                position,
            } => {
                cancellation.check()?;
                let input = self.prepare_document_analysis(&source_id, position.as_ref())?;
                let package_id = input.package_id().to_owned();
                self.language_work(&package_id, LanguageAction::Analyze(input), cancellation)
            }
            Request::SetDocumentLanguage {
                source_id,
                package_id,
            } => {
                cancellation.check()?;
                let source = self.document_record(&source_id)?;
                if source.package_id == package_id
                    && self
                        .installed
                        .get(&package_id)
                        .is_some_and(|package| package.manifest.version == source.package_version)
                {
                    return Ok(Prepared::Immediate(Box::new(Response::Document {
                        window: self.document_window(&source_id, source.position.as_ref())?,
                    })));
                }
                self.language_work(
                    &package_id,
                    LanguageAction::SelectDocumentLanguage { source_id },
                    cancellation,
                )
            }
            Request::Review { command } => self.prepare_review(command),
            Request::ReviewSession { session_id } => {
                Ok(Prepared::Immediate(Box::new(Response::ReviewSession {
                    session: self
                        .store
                        .review_session(&session_id)
                        .map_err(crate::review::storage_failure)?,
                })))
            }
            Request::ReviewSessions => {
                Ok(Prepared::Immediate(Box::new(Response::ReviewSessions {
                    sessions: self
                        .store
                        .review_sessions()
                        .map_err(crate::review::storage_failure)?,
                })))
            }
            Request::ReturnReviewSource {
                session_id,
                encounter_id,
            } => {
                cancellation.check()?;
                let session = self
                    .store
                    .review_session(&session_id)
                    .map_err(crate::review::storage_failure)?;
                if !session.encounter.as_ref().is_some_and(|encounter| {
                    encounter.id == encounter_id
                        && encounter
                            .conditions
                            .assistance
                            .contains(&mlearn_core::ReviewAssistance::Source)
                }) {
                    return Err(Failure::Protocol(
                        "invalid_review",
                        "Record source assistance for the current Review encounter before returning".into(),
                    ));
                }
                let anchor = self
                    .store
                    .review_source(&session_id, &encounter_id)
                    .map_err(crate::review::storage_failure)?
                    .ok_or_else(|| {
                        Failure::Operation("This Review encounter has no source association".into())
                    })?;
                Ok(Prepared::Immediate(Box::new(
                    self.return_source_anchor(anchor, epoch)?,
                )))
            }
            Request::UpdateMaterial { command } => self.prepare_material_edit(command),
            Request::CreateMaterial { command } => self.prepare_material_capture(
                mlearn_core::MaterialCaptureBatch {
                    package_id: command.content.package_id.clone(),
                    commands: vec![command],
                },
                crate::capture::CaptureDelivery::Single,
            ),
            Request::CaptureMaterials { batch } => {
                self.prepare_material_capture(batch, crate::capture::CaptureDelivery::Batch)
            }
            Request::AnalyzeSource {
                source_id,
                position_ms,
            } => {
                cancellation.check()?;
                let input = self.prepare_analysis(&source_id, position_ms)?;
                let package_id = input.package_id().to_owned();
                self.language_work(&package_id, LanguageAction::Analyze(input), cancellation)
            }
            Request::AnalyzeTranscript {
                source_id,
                after_index,
                query,
            } => {
                cancellation.check()?;
                let input = self.prepare_transcript_analysis(&source_id, after_index, &query)?;
                let package_id = input.package_id().to_owned();
                self.language_work(&package_id, LanguageAction::Analyze(input), cancellation)
            }
            Request::OpenSource { path, package_id } => {
                cancellation.check()?;
                self.language_work(&package_id, LanguageAction::Open { path }, cancellation)
            }
            Request::SetSourceLanguage {
                source_id,
                package_id,
            } => {
                cancellation.check()?;
                let source = self.source_record(&source_id)?;
                if source.package_id == package_id
                    && self
                        .installed
                        .get(&package_id)
                        .is_some_and(|package| package.manifest.version == source.package_version)
                {
                    let position_ms = source.position_ms;
                    return Ok(Prepared::Immediate(Box::new(Response::Source {
                        window: self.window(source, position_ms)?,
                    })));
                }
                self.language_work(
                    &package_id,
                    LanguageAction::SelectSourceLanguage { source_id },
                    cancellation,
                )
            }
            Request::DescribeLanguage { package_id } => {
                self.language_work(&package_id, LanguageAction::Describe, cancellation)
            }
            Request::InspectTarget {
                package_id,
                target_id,
                expected_revision,
            } => {
                let package = self
                    .installed
                    .get(&package_id)
                    .ok_or_else(|| Failure::Operation("Language package unavailable".into()))?;
                if let Some(revision) = expected_revision
                    && package.revision()? != revision
                {
                    return Err(Failure::Operation(
                        "Language package changed; inspect the current source again".into(),
                    ));
                }
                self.language_work(
                    &package_id,
                    LanguageAction::Inspect { target_id },
                    cancellation,
                )
            }
            Request::InspectTargets {
                source_id,
                subtitle_revision,
                package_revision,
                target_ids,
            } => {
                if target_ids.is_empty()
                    || target_ids.len() > 6
                    || target_ids.iter().any(|id| id.is_empty() || id.len() > 512)
                    || target_ids
                        .iter()
                        .collect::<std::collections::BTreeSet<_>>()
                        .len()
                        != target_ids.len()
                {
                    return Err(Failure::Operation(
                        "Dictionary batch requires one to six distinct targets".into(),
                    ));
                }
                let source = self.source_record(&source_id)?;
                let package = self
                    .installed
                    .get(&source.package_id)
                    .ok_or_else(|| Failure::Operation("Language package unavailable".into()))?;
                if source.subtitle_revision.as_deref() != Some(subtitle_revision.as_str())
                    || package.manifest.version != source.package_version
                    || package.revision()? != package_revision
                {
                    return Err(Failure::Operation(
                        "Dictionary source or language package changed".into(),
                    ));
                }
                let package_id = source.package_id.clone();
                self.language_work(
                    &package_id,
                    LanguageAction::Summaries {
                        source,
                        targets: target_ids,
                    },
                    cancellation,
                )
            }
            Request::ChangeClaim { change } => {
                let package_id = change.key.package_id.clone();
                self.language_work(
                    &package_id,
                    LanguageAction::Claim(change),
                    Cancellation::durable(),
                )
            }
            Request::InvokePlugin {
                plugin_id,
                capability,
                input,
            } => self.language_work(
                &plugin_id,
                LanguageAction::Invoke { capability, input },
                cancellation,
            ),
            Request::InstallPlugin { plugin_id } => {
                let command = self.installs.legacy_command(plugin_id);
                self.prepare_install(command)
            }
            Request::InstallPackage { command } => {
                if command.command_id.starts_with("native:") {
                    return Err(Failure::Operation(
                        "Reserved install command identity".into(),
                    ));
                }
                self.prepare_install(command)
            }
            Request::PackageInstallStatus { command_id } => Ok(Prepared::Immediate(Box::new(
                self.installs.status(&command_id, false)?,
            ))),
            Request::CurrentPackageInstall => Ok(Prepared::Immediate(Box::new(
                self.installs.current_status()?,
            ))),
            Request::CancelPackageInstall { command_id } => Ok(Prepared::Immediate(Box::new(
                self.installs.status(&command_id, true)?,
            ))),
            Request::AvailablePackages => {
                let catalog = self
                    .catalog
                    .as_ref()
                    .ok_or_else(|| Failure::Operation("No trusted catalog configured".into()))?
                    .clone();
                Ok(Prepared::Work(GuestWork::Catalog(catalog)))
            }
            request @ (Request::ResumeSource { .. } | Request::AttachSubtitles { .. }) => {
                cancellation.check()?;
                let response = self.watch(request, epoch);
                cancellation.check()?;
                Ok(Prepared::Immediate(Box::new(response?)))
            }
            request @ (Request::Collection { .. }
            | Request::CreateCollectionSelection { .. }
            | Request::CollectionSelection { .. }
            | Request::CollectionSelections
            | Request::CollectionSelectionPage { .. }
            | Request::ReleaseCollectionSelection { .. }
            | Request::Snapshot
            | Request::PlanMaterialMedia { .. }
            | Request::MaterialMedia { .. }
            | Request::Materials { .. }
            | Request::Material { .. }
            | Request::RemoveMaterial { .. }
            | Request::MaterialEligibility { .. }
            | Request::SetCaptureExclusion { .. }
            | Request::ReturnMaterialSource { .. }
            | Request::RecentSources
            | Request::SourceWindow { .. }
            | Request::Transcript { .. }
            | Request::CuePosition { .. }
            | Request::SetSubtitleOffset { .. }
            | Request::AlignSubtitleOffset { .. }
            | Request::SetPlaybackRate { .. }
            | Request::SetInspectionTrigger { .. }
            | Request::SavePosition { .. }
            | Request::Knowledge { .. }
            | Request::SaveTheme { .. }
            | Request::SaveInlineLevelScale { .. }
            | Request::SaveStarCollapse { .. }) => {
                Ok(Prepared::Immediate(Box::new(self.metadata(request)?)))
            }
        }
    }
    fn prepare_install(
        &self,
        command: mlearn_core::PackageInstallCommand,
    ) -> Result<Prepared, Failure> {
        self.policy
            .authorize(mlearn_language_host::CodeOrigin::Download)?;
        if !command.command_id.starts_with("native:")
            && let Some(receipt) = self
                .store
                .install_receipt(&command)
                .map_err(|e| Failure::Operation(e.to_string()))?
        {
            return Ok(Prepared::Immediate(Box::new(receipt)));
        }
        let catalog = self
            .catalog
            .as_ref()
            .ok_or_else(|| {
                Failure::Operation("No trusted desktop plugin catalog configured".into())
            })?
            .clone();
        let plugin_id = command.plugin_id.clone();
        match self.installs.begin(command)? {
            crate::packages::InstallStart::Started(transfer) => {
                Ok(Prepared::Work(GuestWork::Install {
                    root: self.root.clone(),
                    catalog,
                    plugin_id,
                    transfer,
                }))
            }
            crate::packages::InstallStart::Replay(response) => Ok(Prepared::Immediate(response)),
        }
    }
    pub(crate) fn language_work(
        &self,
        package_id: &str,
        action: LanguageAction,
        cancellation: Cancellation,
    ) -> Result<Prepared, Failure> {
        let package = self
            .installed
            .get(package_id)
            .ok_or_else(|| {
                Failure::Operation(
                    "Language package unavailable; install its compatible version and retry".into(),
                )
            })?
            .clone();
        Ok(Prepared::Work(GuestWork::Language(Box::new(
            LanguageWork {
                package,
                cancellation,
                action,
            },
        ))))
    }
}
