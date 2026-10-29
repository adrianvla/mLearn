use crate::{
    bounded_reads::{BoundedReadError, BoundedReads},
    guest::{GuestOutput, GuestWork, Prepared},
    guest_gate::GuestGate,
    Runtime,
};
use mlearn_core::{Request, Response};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Instant,
};

#[derive(Debug, thiserror::Error)]
pub(super) enum Failure {
    #[error("{0}")]
    Operation(String),
    #[error("Source work cancelled; saved progress is unchanged")]
    Cancelled,
    #[error("Native language execution is busy; retry the action")]
    Busy,
    #[error("{1}")]
    Protocol(&'static str, String),
}
impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self::Operation(message)
    }
}
#[derive(Clone)]
pub(super) struct Cancellation {
    pub(super) value: Arc<AtomicU64>,
    pub epoch: u64,
    operation: Option<Arc<AtomicBool>>,
}
impl Cancellation {
    pub fn source(value: Arc<AtomicU64>, epoch: u64) -> Self {
        Self {
            value,
            epoch,
            operation: None,
        }
    }
    pub fn durable() -> Self {
        Self {
            value: Arc::new(AtomicU64::new(0)),
            epoch: 0,
            operation: None,
        }
    }
    pub fn check(&self) -> Result<(), Failure> {
        if self.value.load(Ordering::Relaxed) == self.epoch
            && self
                .operation
                .as_ref()
                .is_none_or(|flag| !flag.load(Ordering::Acquire))
        {
            Ok(())
        } else {
            Err(Failure::Cancelled)
        }
    }
    pub fn invoke(
        &self,
        package: &crate::Installed,
        capability: &str,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, Failure> {
        self.check()?;
        if !package
            .manifest
            .capabilities
            .iter()
            .any(|c| c == capability)
        {
            return Err(Failure::Operation(
                "Selected package does not support this language operation".into(),
            ));
        }
        let output = package.compiled.invoke_cancellable_with_operation(
            capability,
            input,
            self.value.clone(),
            self.epoch,
            self.operation.clone(),
        );
        self.check()?;
        output.map_err(|error| {
            if error.is_busy() {
                Failure::Busy
            } else {
                Failure::Operation(error.to_string())
            }
        })
    }
}
pub(super) struct CallPermit<'a>(&'a AtomicUsize);
impl Drop for CallPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Shared native scheduling boundary. Guest admission stays outside Runtime.
/// Hosts call execute on blocking workers; display coalescing stays in the client.
pub struct RuntimeExecutor {
    pub(super) runtime: Arc<Mutex<Runtime>>,
    conversations: crate::conversation_execution::ConversationOwner,
    collections: crate::collection::CollectionOwner,
    bulk: crate::material_bulk::MaterialBulkOwner,
    pub(super) guest: GuestGate,
    bounded_reads: BoundedReads,
    admitted: AtomicUsize,
    cancellation: Arc<AtomicU64>,
}
impl RuntimeExecutor {
    #[cfg(test)]
    pub(crate) fn observe_material_bulk(
        &self,
    ) -> (
        std::sync::mpsc::Receiver<u32>,
        std::sync::mpsc::SyncSender<()>,
    ) {
        self.bulk.observe()
    }

    #[cfg(test)]
    pub(crate) fn observe_collection(
        &self,
    ) -> (
        std::sync::mpsc::Receiver<u32>,
        std::sync::mpsc::SyncSender<()>,
    ) {
        self.collections.observe()
    }

    #[cfg(test)]
    pub(crate) fn observe_generation(
        &self,
    ) -> (
        tokio::sync::oneshot::Receiver<()>,
        tokio::sync::oneshot::Receiver<()>,
    ) {
        self.conversations.observe()
    }

    pub fn new(runtime: Runtime) -> Self {
        let cancellation = runtime.cancellation_handle();
        Self {
            runtime: Arc::new(Mutex::new(runtime)),
            conversations: crate::conversation_execution::ConversationOwner::default(),
            collections: crate::collection::CollectionOwner::default(),
            bulk: crate::material_bulk::MaterialBulkOwner::default(),
            guest: GuestGate::default(),
            bounded_reads: BoundedReads::default(),
            admitted: AtomicUsize::new(0),
            cancellation,
        }
    }
    pub fn cancellation_handle(&self) -> Arc<AtomicU64> {
        self.cancellation.clone()
    }
    /// Canonical source cancellation also wakes queued scoped reads.
    pub fn cancel_source_open(&self) {
        self.cancellation.fetch_add(1, Ordering::Relaxed);
        self.guest.notify_source_change();
    }
    /// Register a fresh native identity without taking a heavy call permit.
    pub fn begin_bounded_read(&self) -> Result<String, BoundedReadError> {
        self.bounded_reads.begin(&self.cancellation, Instant::now())
    }
    /// Signal one read and join its real cleanup, independently of heavy permits.
    pub fn cancel_bounded_read(&self, id: &str) -> Result<(), BoundedReadError> {
        let _control = self.bounded_reads.control()?;
        if let Some(lease) = self.bounded_reads.cancel(id)? {
            self.guest.notify_operation(&lease.wake);
            #[cfg(test)]
            bounded_read_tests::cancel_signalled();
            lease.join()?;
        }
        Ok(())
    }
    pub fn execute_bounded_read(&self, id: &str, request: &str) -> String {
        let claimed = match self
            .bounded_reads
            .claim(id, &self.cancellation, Instant::now())
        {
            Ok(claimed) => claimed,
            Err(error) => return encode(Err(error.into())),
        };
        let cancellation = Cancellation {
            value: Arc::clone(&self.cancellation),
            epoch: claimed.lease.epoch,
            operation: Some(Arc::clone(&claimed.lease.cancelled)),
        };
        // This inner scope drops the heavy permit and every execution owner
        // before Claimed removes the lease and acknowledges its cancellation.
        let result = (|| {
            let _permit = self.admit()?;
            #[cfg(test)]
            bounded_read_tests::hold(bounded_read_tests::Point::Claimed);
            cancellation.check()?;
            let request = parse(request)?;
            if !matches!(
                request,
                Request::GraphNeighborhood { .. }
                    | Request::KnowledgeEvidence { .. }
                    | Request::SearchDocument { .. }
            ) {
                return Err(Failure::Protocol(
                    "invalid_bounded_read",
                    "Request is not an operation-scoped bounded read".into(),
                ));
            }
            self.execute_request_scoped(request, Some((&cancellation, &claimed.lease.wake)))
        })();
        let response = encode(result);
        drop(claimed);
        response
    }
    pub(super) fn admit(&self) -> Result<CallPermit<'_>, Failure> {
        let active = self.admitted.fetch_add(1, Ordering::Relaxed);
        let permit = CallPermit(&self.admitted);
        if active >= 3 {
            Err(Failure::Busy)
        } else {
            Ok(permit)
        }
    }
    pub fn execute(&self, request: &str) -> String {
        let _permit = match self.admit() {
            Ok(permit) => permit,
            Err(error) => return encode(Err(error)),
        };
        encode(parse(request).and_then(|request| self.execute_request(request)))
    }
    fn execute_request(&self, request: Request) -> Result<Response, Failure> {
        self.execute_request_scoped(request, None)
    }
    fn execute_request_scoped(
        &self,
        request: Request,
        scoped: Option<(&Cancellation, &Arc<Condvar>)>,
    ) -> Result<Response, Failure> {
        if let Some((cancellation, _)) = scoped {
            cancellation.check()?;
        }
        let request = match request {
            Request::MaterialBulk { command } => {
                return self.bulk.execute(&self.runtime, &self.guest, command);
            }
            Request::PrepareCollection { command } => {
                return self
                    .collections
                    .prepare(&self.runtime, &self.guest, command);
            }
            Request::CollectionPreparationStatus { command_id } => {
                return self.collections.status(command_id.as_deref(), false);
            }
            Request::CancelCollectionPreparation { command_id } => {
                return self.collections.status(Some(&command_id), true);
            }
            Request::Conversation { command } => match command {
                command @ (mlearn_core::ConversationCommand::AnalyzeVisibleMessages { .. }
                | mlearn_core::ConversationCommand::AnalyzeMessageSource { .. }) => {
                    Request::Conversation { command }
                }
                command => return self.conversations.execute(self.runtime.clone(), command),
            },
            request => request,
        };
        let started = std::env::var_os("MLEARN_PLUGIN_METRICS")
            .is_some()
            .then(Instant::now);
        let epoch = scoped.map_or_else(
            || self.cancellation.load(Ordering::Relaxed),
            |(cancellation, _)| cancellation.epoch,
        );
        // Reserve the single install identity before waiting for guest admission.
        // Status/cancel never take that guest lock or wait behind a transfer.
        let (request, install) = if matches!(
            request,
            Request::InstallPlugin { .. } | Request::InstallPackage { .. }
        ) {
            let prepared = self
                .runtime
                .lock()
                .map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?
                .prepare(request, epoch)?;
            match prepared {
                Prepared::Immediate(response) => return Ok(*response),
                work @ Prepared::Work(_) => (None, Some(work)),
            }
        } else {
            (Some(request), None)
        };
        let install_prepared_at = started.map(|start| start.elapsed()).unwrap_or_default();
        let admission = if install.is_some() || request.as_ref().is_some_and(guest_bearing) {
            // Background refresh must not queue behind a user action. Foreground
            // lookup/claims wait for current analysis without owning Runtime;
            // the shared three-call permit still bounds all waiting workers.
            Some(if let Some((cancellation, wake)) = scoped {
                self.guest.lock_cancellable(cancellation, wake)?
            } else if matches!(
                request,
                Some(
                    Request::AnalyzeSource { .. }
                        | Request::AnalyzeTranscript { .. }
                        | Request::InspectTargets { .. }
                )
            ) {
                self.guest.try_lock()?
            } else {
                self.guest.lock().map_err(|_| {
                    Failure::Operation("Native guest admission lock poisoned".into())
                })?
            })
        } else {
            None
        };
        let admitted_at = started.map(|start| start.elapsed()).unwrap_or_default();
        if let Some((cancellation, _)) = scoped {
            cancellation.check()?;
        }
        let prepared = if let Some(install) = install {
            install
        } else {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?;
            let request =
                request.ok_or_else(|| Failure::Operation("Missing prepared request".into()))?;
            match scoped {
                Some((cancellation, _)) => {
                    cancellation.check()?;
                    runtime.prepare_cancellable(request, cancellation.clone())?
                }
                None => runtime.prepare(request, epoch)?,
            }
        };
        if let Some(started) = started {
            let capability = match &prepared {
                Prepared::Immediate(_) => "metadata",
                Prepared::Work(work) => work.capability(),
            };
            eprintln!(
                "runtime-work owner=executor capability={capability:?} phase=prepare admission_us={} preparation_us={}",
                admitted_at.saturating_sub(install_prepared_at).as_micros(),
                (started.elapsed().saturating_sub(admitted_at) + install_prepared_at).as_micros()
            );
        }
        match prepared {
            Prepared::Immediate(response) => {
                #[cfg(test)]
                if scoped.is_some() {
                    bounded_read_tests::hold(bounded_read_tests::Point::Immediate);
                }
                if let Some((cancellation, _)) = scoped {
                    cancellation.check()?;
                }
                Ok(*response)
            }
            Prepared::Work(work) => {
                let guest_started = started.map(|_| Instant::now());
                let output = work.run();
                if let Some(guest_started) = guest_started {
                    eprintln!(
                        "runtime-work owner=executor capability={:?} phase=guest elapsed_us={} success={}",
                        work.capability(),
                        guest_started.elapsed().as_micros(),
                        output.is_ok()
                    );
                }
                drop(admission);
                let completion_started = started.map(|_| Instant::now());
                let result = (|| {
                    let mut output = output?;
                    // Real guest results and their Arc owners remain outside the Runtime guard.
                    #[cfg(test)]
                    crate::watch::source_execution_tests::hold_guest_result(work.capability());
                    self.publish(&work, &mut output)
                })();
                let result = self
                    .runtime
                    .lock()
                    .map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))
                    .and_then(|mut runtime| runtime.finish_work(&work, result));
                if let Some(completion_started) = completion_started {
                    // Includes authoritative Knowledge projection and durable completion.
                    eprintln!(
                        "runtime-work owner=executor capability={:?} phase=completion elapsed_us={} success={}",
                        work.capability(),
                        completion_started.elapsed().as_micros(),
                        result.is_ok()
                    );
                }
                result
            }
        }
    }
    fn publish(&self, work: &GuestWork, output: &mut GuestOutput) -> Result<Response, Failure> {
        let completion = {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?;
            runtime.complete(work, output)
        };
        let (response, retired) = completion?;
        // The last compiled owner may wait for the global guest slot in Drop.
        drop(retired);
        Ok(response)
    }
}
fn guest_bearing(request: &Request) -> bool {
    match request {
        Request::Conversation { command } => matches!(
            command,
            mlearn_core::ConversationCommand::AnalyzeVisibleMessages { .. }
                | mlearn_core::ConversationCommand::AnalyzeMessageSource { .. }
        ),
        Request::Review { command } => matches!(
            command,
            mlearn_core::ReviewCommand::Start { .. } | mlearn_core::ReviewCommand::Next { .. }
        ),
        Request::OpenSource { .. }
        | Request::ImportImageCollection { .. }
        | Request::AnalyzeOcr { .. }
        | Request::PostprocessOcr { .. }
        | Request::OpenDocument { .. }
        | Request::SetDocumentLanguage { .. }
        | Request::AnalyzeDocument { .. }
        | Request::CreateMaterial { .. }
        | Request::CaptureMaterials { .. }
        | Request::SetSourceLanguage { .. }
        | Request::AnalyzeSource { .. }
        | Request::AnalyzeTranscript { .. }
        | Request::DescribeLanguage { .. }
        | Request::InspectTarget { .. }
        | Request::GraphNeighborhood { .. }
        | Request::InspectTargets { .. }
        | Request::ChangeClaim { .. }
        | Request::InvokePlugin { .. }
        | Request::InstallPlugin { .. }
        | Request::InstallPackage { .. } => true,
        Request::Collection { .. }
        | Request::CreateCollectionSelection { .. }
        | Request::CollectionSelection { .. }
        | Request::CollectionSelections
        | Request::CollectionSelectionMembership { .. }
        | Request::CollectionSelectionPage { .. }
        | Request::ReleaseCollectionSelection { .. }
        | Request::PrepareCollection { .. }
        | Request::CollectionPreparationStatus { .. }
        | Request::CancelCollectionPreparation { .. }
        | Request::Snapshot
        | Request::ImagePage { .. }
        | Request::ImageReaderSettings { .. }
        | Request::SaveImageReaderSettings { .. }
        | Request::ImagePageLocation { .. }
        | Request::PlanOcr { .. }
        | Request::OcrRecovery { .. }
        | Request::CompleteOcr { .. }
        | Request::CancelOcr { .. }
        | Request::ReadOcr { .. }
        | Request::OcrEvidence { .. }
        | Request::CorrectOcr { .. }
        | Request::ResumeDocument { .. }
        | Request::RecentDocuments
        | Request::DocumentWindow { .. }
        | Request::DocumentContents { .. }
        | Request::SearchDocument { .. }
        | Request::ReturnSourceAnchor { .. }
        | Request::CheckpointDocument { .. }
        | Request::DocumentResource { .. }
        | Request::ReviewSession { .. }
        | Request::ReviewSessions
        | Request::ReturnReviewSource { .. }
        | Request::PlanMaterialMedia { .. }
        | Request::MaterialMedia { .. }
        | Request::Materials { .. }
        | Request::Material { .. }
        | Request::MaterialProposals { .. }
        | Request::MaterialGeneration { .. }
        | Request::MaterialGenerations { .. }
        | Request::CollectMaterialGeneration { .. }
        | Request::MaterialProposal { .. }
        | Request::SuggestMaterial { .. }
        | Request::ReviewMaterialProposal { .. }
        | Request::ReturnMaterialProposalSource { .. }
        | Request::RemoveMaterial { .. }
        | Request::MaterialBulk { .. }
        | Request::MaterialEligibility { .. }
        | Request::SetCaptureExclusion { .. }
        | Request::ReturnMaterialSource { .. }
        | Request::RecentSources
        | Request::AvailablePackages
        | Request::ResumeSource { .. }
        | Request::AttachSubtitles { .. }
        | Request::SourceWindow { .. }
        | Request::SavePosition { .. }
        | Request::Transcript { .. }
        | Request::CuePosition { .. }
        | Request::SetSubtitleOffset { .. }
        | Request::AlignSubtitleOffset { .. }
        | Request::SetPlaybackRate { .. }
        | Request::SetInspectionTrigger { .. }
        | Request::Knowledge { .. }
        | Request::KnowledgeEvidence { .. }
        | Request::SaveTheme { .. }
        | Request::SaveInlineLevelScale { .. }
        | Request::SaveStarCollapse { .. }
        | Request::PackageInstallStatus { .. }
        | Request::CurrentPackageInstall
        | Request::CancelPackageInstall { .. } => false,
        Request::UpdateMaterial { command } => command.content.target_id.is_some(),
    }
}
pub(super) fn parse(request: &str) -> Result<Request, Failure> {
    if request.len() > 262_144 {
        return Err(Failure::Protocol(
            "request_too_large",
            "Request exceeds 256 KiB".into(),
        ));
    }
    serde_json::from_str(request).map_err(|e| Failure::Protocol("invalid_request", e.to_string()))
}
pub(super) fn encode(result: Result<Response, Failure>) -> String {
    let response = result.unwrap_or_else(|error| error_response(&error));
    let encoded =
        serde_json::to_string(&response).expect("Runtime response types are JSON serializable");
    if encoded.len() > 524288 {
        return r#"{"type":"error","code":"response_too_large","message":"Native response exceeds 512 KiB; select a smaller source range."}"#.into();
    }
    encoded
}
pub(super) fn error_response(error: &Failure) -> Response {
    let code = match &error {
        Failure::Operation(_) => "operation_failed",
        Failure::Cancelled => "cancelled",
        Failure::Busy => "busy",
        Failure::Protocol(code, _) => code,
    };
    Response::Error {
        code: code.into(),
        message: error.to_string().chars().take(2048).collect(),
    }
}

#[cfg(test)]
#[path = "bounded_read_tests.rs"]
mod bounded_read_tests;
