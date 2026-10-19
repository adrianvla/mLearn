use crate::{Runtime, guest::{GuestOutput, GuestWork, Prepared}};
use mlearn_core::{Request, Response};
use std::{sync::{Arc, Mutex, TryLockError, atomic::{AtomicU64, AtomicUsize, Ordering}}, time::Instant};

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
    fn from(message: String) -> Self { Self::Operation(message) }
}
#[derive(Clone)]
pub(super) struct Cancellation {
    value: Arc<AtomicU64>,
    pub epoch: u64,
}
impl Cancellation {
    pub fn source(value: Arc<AtomicU64>, epoch: u64) -> Self { Self { value, epoch } }
    pub fn durable() -> Self { Self { value: Arc::new(AtomicU64::new(0)), epoch: 0 } }
    pub fn check(&self) -> Result<(), Failure> {
        if self.value.load(Ordering::Relaxed) == self.epoch { Ok(()) } else { Err(Failure::Cancelled) }
    }
    pub fn invoke(&self, package: &crate::Installed, capability: &str, input: serde_json::Value) -> Result<serde_json::Value, Failure> {
        self.check()?;
        if !package.manifest.capabilities.iter().any(|c| c == capability) {
            return Err(Failure::Operation("Selected package does not support this language operation".into()));
        }
        let output = package.compiled.invoke_cancellable(capability, input, self.value.clone(), self.epoch);
        self.check()?;
        output.map_err(Failure::Operation)
    }
}
pub(super) struct CallPermit<'a>(&'a AtomicUsize);
impl Drop for CallPermit<'_> {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::Relaxed); }
}

/// Shared native scheduling boundary. Guest admission stays outside Runtime.
/// Hosts call execute on blocking workers; display coalescing stays in the client.
pub struct RuntimeExecutor {
    pub(super) runtime: Mutex<Runtime>,
    pub(super) guest: Mutex<()>,
    admitted: AtomicUsize,
    cancellation: Arc<AtomicU64>,
}
impl RuntimeExecutor {
    pub fn new(runtime: Runtime) -> Self {
        let cancellation = runtime.cancellation_handle();
        Self { runtime: Mutex::new(runtime), guest: Mutex::new(()), admitted: AtomicUsize::new(0), cancellation }
    }
    pub fn cancellation_handle(&self) -> Arc<AtomicU64> { self.cancellation.clone() }
    pub(super) fn admit(&self) -> Result<CallPermit<'_>, Failure> {
        let active = self.admitted.fetch_add(1, Ordering::Relaxed);
        let permit = CallPermit(&self.admitted);
        if active >= 3 { Err(Failure::Busy) } else { Ok(permit) }
    }
    pub fn execute(&self, request: &str) -> String {
        let _permit = match self.admit() {
            Ok(permit) => permit,
            Err(error) => return encode(Err(error)),
        };
        encode(parse(request).and_then(|request| self.execute_request(request)))
    }
    fn execute_request(&self, request: Request) -> Result<Response, Failure> {
        let started = std::env::var_os("MLEARN_PLUGIN_METRICS").is_some().then(Instant::now);
        let epoch = self.cancellation.load(Ordering::Relaxed);
        // Reserve the single install identity before waiting for guest admission.
        // Status/cancel never take that guest lock or wait behind a transfer.
        let (request, install) = if matches!(request, Request::InstallPlugin { .. } | Request::InstallPackage { .. }) {
            let prepared = self.runtime.lock().map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?.prepare(request, epoch)?;
            match prepared {
                Prepared::Immediate(response) => return Ok(*response),
                work @ Prepared::Work(_) => (None, Some(work)),
            }
        } else { (Some(request), None) };
        let install_prepared_at = started.map(|start| start.elapsed()).unwrap_or_default();
        let admission = if install.is_some() || request.as_ref().is_some_and(guest_bearing) {
            // Background refresh must not queue behind a user action. Foreground
            // lookup/claims wait for current analysis without owning Runtime;
            // the shared three-call permit still bounds all waiting workers.
            Some(if matches!(request, Some(Request::AnalyzeSource { .. } | Request::AnalyzeTranscript { .. })) {
                self.guest.try_lock().map_err(|error| match error {
                    TryLockError::WouldBlock => Failure::Busy,
                    TryLockError::Poisoned(_) => Failure::Operation("Native guest admission lock poisoned".into()),
                })?
            } else {
                self.guest.lock().map_err(|_| Failure::Operation("Native guest admission lock poisoned".into()))?
            })
        } else { None };
        let admitted_at = started.map(|start| start.elapsed()).unwrap_or_default();
        let prepared = if let Some(install) = install { install } else {
            let mut runtime = self.runtime.lock().map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?;
            runtime.prepare(request.ok_or_else(|| Failure::Operation("Missing prepared request".into()))?, epoch)?
        };
        if let Some(started) = started {
            let capability = match &prepared { Prepared::Immediate(_) => "metadata", Prepared::Work(work) => work.capability() };
            eprintln!("runtime-work owner=executor capability={capability:?} phase=prepare admission_us={} preparation_us={}",
                admitted_at.saturating_sub(install_prepared_at).as_micros(),
                (started.elapsed().saturating_sub(admitted_at) + install_prepared_at).as_micros());
        }
        match prepared {
            Prepared::Immediate(response) => Ok(*response),
            Prepared::Work(work) => {
                let guest_started = started.map(|_| Instant::now());
                let output = work.run();
                if let Some(guest_started) = guest_started {
                    eprintln!("runtime-work owner=executor capability={:?} phase=guest elapsed_us={} success={}", work.capability(), guest_started.elapsed().as_micros(), output.is_ok());
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
                let result = self.runtime.lock().map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))
                    .and_then(|mut runtime| runtime.finish_work(&work, result));
                if let Some(completion_started) = completion_started {
                    // Includes authoritative Knowledge projection and durable completion.
                    eprintln!("runtime-work owner=executor capability={:?} phase=completion elapsed_us={} success={}", work.capability(), completion_started.elapsed().as_micros(), result.is_ok());
                }
                result
            }
        }
    }
    fn publish(&self, work: &GuestWork, output: &mut GuestOutput) -> Result<Response, Failure> {
        let completion = {
            let mut runtime = self.runtime.lock().map_err(|_| Failure::Operation("Native runtime lock poisoned".into()))?;
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
        Request::OpenSource { .. } | Request::SetSourceLanguage { .. } | Request::AnalyzeSource { .. } | Request::AnalyzeTranscript { .. } | Request::DescribeLanguage { .. }
        | Request::InspectTarget { .. } | Request::ChangeClaim { .. } | Request::InvokePlugin { .. }
        | Request::InstallPlugin { .. } | Request::InstallPackage { .. } => true,
        Request::Snapshot | Request::RecentSources | Request::AvailablePackages | Request::ResumeSource { .. }
        | Request::AttachSubtitles { .. } | Request::SourceWindow { .. } | Request::SavePosition { .. }
        | Request::Transcript { .. } | Request::CuePosition { .. } | Request::SetSubtitleOffset { .. } | Request::SetPlaybackRate { .. }
        | Request::SetInspectionTrigger { .. }
        | Request::Knowledge { .. } | Request::SaveTheme { .. }
        | Request::PackageInstallStatus { .. } | Request::CurrentPackageInstall | Request::CancelPackageInstall { .. } => false,
    }
}
pub(super) fn parse(request: &str) -> Result<Request, Failure> {
    if request.len() > 262_144 {
        return Err(Failure::Protocol("request_too_large", "Request exceeds 256 KiB".into()));
    }
    serde_json::from_str(request).map_err(|e| Failure::Protocol("invalid_request", e.to_string()))
}
pub(super) fn encode(result: Result<Response, Failure>) -> String {
    let response = result.unwrap_or_else(|error| error_response(&error));
    let encoded = serde_json::to_string(&response).expect("Runtime response types are JSON serializable");
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
        Response::Error { code: code.into(), message: error.to_string().chars().take(2048).collect() }
}
