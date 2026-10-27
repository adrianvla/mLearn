//! One desktop inference owner, separate bounded display, Rust-owned publication.
use mlearn_core::{
    OcrAvailability, OcrCandidate, OcrNativeResult, OcrPlan, OcrProvider, OcrQuad, OcrRect,
    OcrRegion, OcrRequest, OcrStageEvidence,
};
use mlearn_runtime::{
    RuntimeExecutor,
    native_ocr::{NativeOcrLease, NativeOcrModels},
    ocr_package::{OcrPackageBinding, OcrPackageProfile},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt},
    sync::{Notify, Semaphore, watch},
};
mod inference;

pub(crate) struct OcrJobs {
    inference: tokio::sync::Mutex<Option<inference::Worker>>,
    inference_identity: AtomicU64,
    active: Mutex<Option<Active>>,
    closed: AtomicBool,
    display: Arc<Semaphore>,
    workers: AtomicUsize,
    drained: Notify,
    shutdown: watch::Sender<bool>,
    #[cfg(feature = "ocr-probe")]
    pub(super) recognizing: Notify,
}
struct Active {
    id: String,
    running: bool,
    cancelled: watch::Sender<bool>,
    epoch: Arc<AtomicU64>,
}
struct JobGuard {
    owner: Arc<OcrJobs>,
    id: Option<String>,
}
impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            match self.owner.active.lock() {
                Ok(mut active) if active.as_ref().is_some_and(|v| &v.id == id) => *active = None,
                Ok(_) => {}
                Err(error) => eprintln!("OCR admission cleanup failed: {error}"),
            }
        }
        self.owner.workers.fetch_sub(1, Ordering::AcqRel);
        self.owner.drained.notify_waiters();
    }
}
impl OcrJobs {
    pub(crate) fn new() -> Self {
        Self {
            inference: tokio::sync::Mutex::new(None),
            inference_identity: AtomicU64::new(1),
            active: Mutex::new(None),
            closed: AtomicBool::new(false),
            display: Arc::new(Semaphore::new(1)),
            workers: AtomicUsize::new(0),
            drained: Notify::new(),
            shutdown: watch::channel(false).0,
            #[cfg(feature = "ocr-probe")]
            recognizing: Notify::new(),
        }
    }
    pub(crate) fn reserve(&self, id: String) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 {
            return Err("Invalid OCR job identity".into());
        }
        let mut active = self
            .active
            .lock()
            .map_err(|_| "OCR admission lock poisoned")?;
        if self.closed.load(Ordering::Acquire) || active.is_some() {
            return Err("Desktop OCR is busy or closing".into());
        }
        *active = Some(Active {
            id,
            running: false,
            cancelled: watch::channel(false).0,
            epoch: Arc::new(AtomicU64::new(0)),
        });
        Ok(())
    }
    fn auxiliary(self: &Arc<Self>) -> Result<JobGuard, String> {
        let _active = self
            .active
            .lock()
            .map_err(|_| "OCR admission lock poisoned")?;
        if self.closed.load(Ordering::Acquire) {
            return Err("Desktop OCR is closing".into());
        }
        self.workers.fetch_add(1, Ordering::AcqRel);
        Ok(JobGuard {
            owner: self.clone(),
            id: None,
        })
    }
    fn start(self: &Arc<Self>, id: &str) -> Result<(JobGuard, watch::Receiver<bool>), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "OCR admission lock poisoned")?;
        let value = active
            .as_mut()
            .filter(|v| v.id == id)
            .ok_or("OCR job was not reserved or was cancelled")?;
        if value.running || self.closed.load(Ordering::Acquire) || *value.cancelled.borrow() {
            return Err("OCR job is busy or cancelled".into());
        }
        value.running = true;
        self.workers.fetch_add(1, Ordering::AcqRel);
        Ok((
            JobGuard {
                owner: self.clone(),
                id: Some(id.into()),
            },
            value.cancelled.subscribe(),
        ))
    }
    pub(crate) fn cancel(&self, id: &str) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "OCR admission lock poisoned")?;
        if let Some(value) = active.as_ref().filter(|v| v.id == id) {
            value.epoch.store(1, Ordering::Release);
            value.cancelled.send_replace(true);
            if !value.running {
                *active = None;
            }
        }
        Ok(())
    }
    fn cancellation(&self, id: &str) -> Result<Arc<AtomicU64>, String> {
        self.active
            .lock()
            .map_err(|_| "OCR admission lock poisoned")?
            .as_ref()
            .filter(|v| v.id == id)
            .map(|v| v.epoch.clone())
            .ok_or("OCR admission expired".into())
    }
    fn publish(
        &self,
        id: &str,
        publish: impl FnOnce() -> Result<String, String>,
    ) -> Result<String, String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "OCR admission lock poisoned")?;
        let value = active
            .as_ref()
            .filter(|v| v.id == id && v.running)
            .ok_or("OCR admission expired")?;
        if self.closed.load(Ordering::Acquire) || *value.cancelled.borrow() {
            return Err("OCR cancelled before publication".into());
        }
        // Cancellation and immutable SQLite publication have one linearization
        // point; neither inference nor subprocess waits hold this short lock.
        publish()
    }
    pub(crate) fn begin_shutdown(&self) {
        self.closed.store(true, Ordering::Release);
        self.shutdown.send_replace(true);
        match self.active.lock() {
            Ok(mut active) => {
                if let Some(value) = active.as_ref() {
                    value.epoch.store(1, Ordering::Release);
                    value.cancelled.send_replace(true);
                }
                if active.as_ref().is_some_and(|v| !v.running) {
                    *active = None;
                }
            }
            Err(error) => eprintln!("OCR shutdown lock failed: {error}"),
        }
    }
    pub(crate) async fn drain(&self) {
        loop {
            let changed = self.drained.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.workers.load(Ordering::Acquire) == 0 {
                break;
            }
            changed.await;
        }
    }
    pub(crate) fn shutdown_finished(&self) -> bool {
        self.closed.load(Ordering::Acquire) && self.workers.load(Ordering::Acquire) == 0
    }
}
fn checked(cancelled: &watch::Receiver<bool>) -> Result<(), String> {
    if *cancelled.borrow() {
        Err("OCR cancelled".into())
    } else {
        Ok(())
    }
}
async fn cancelled(receiver: &mut watch::Receiver<bool>) {
    if let Err(error) = receiver.wait_for(|v| *v).await {
        eprintln!("OCR cancellation owner closed: {error}");
    }
}
async fn runtime(
    runtime: Arc<RuntimeExecutor>,
    request: Value,
    expected: &'static str,
) -> Result<(String, Value), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let raw = runtime.execute(&request.to_string());
        let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if value["type"].as_str() != Some(expected) {
            return Err(value["message"]
                .as_str()
                .unwrap_or("Unexpected runtime OCR response")
                .into());
        }
        Ok((raw, value))
    })
    .await
    .map_err(|e| e.to_string())?
}
async fn package(
    runtime: Arc<RuntimeExecutor>,
    source: String,
    capability: &'static str,
    input: Value,
    epoch: Arc<AtomicU64>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        runtime.ocr_source_stage(&source, capability, input, epoch)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(target_os = "macos")]
fn helper_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundled = executable
        .parent()
        .ok_or("Desktop executable has no parent")?
        .join("mlearn-ocr");
    #[cfg(all(debug_assertions, target_os = "macos"))]
    let bundled = if bundled.is_file() {
        bundled
    } else {
        PathBuf::from(env!("MLEARN_APPLE_OCR_HELPER"))
    };
    Ok(bundled)
}
async fn bounded<R: AsyncRead + Unpin>(reader: R, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("OCR provider output exceeded its bound".into());
    }
    Ok(bytes)
}
async fn stop(child: &mut tokio::process::Child) -> Result<(), String> {
    if child.try_wait().map_err(|e| e.to_string())?.is_none() {
        child.kill().await.map_err(|e| e.to_string())?;
    }
    child.wait().await.map_err(|e| e.to_string())?;
    Ok(())
}
async fn helper(
    input: Value,
    limit: usize,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<Value, String> {
    checked(cancelled)?;
    let bytes = serde_json::to_vec(&input).map_err(|e| e.to_string())?;
    if bytes.len() > 32768 {
        return Err("OCR helper input exceeds 32 KiB".into());
    }
    #[cfg(target_os = "macos")]
    let command = tokio::process::Command::new(helper_path()?);
    #[cfg(not(target_os = "macos"))]
    let command = {
        let mut command =
            tokio::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
        command.arg("--raster-page");
        command
    };
    run_once(command, bytes, limit, cancelled).await
}
async fn run_once(
    mut command: tokio::process::Command,
    bytes: Vec<u8>,
    limit: usize,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<Value, String> {
    checked(cancelled)?;
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Bundled OCR helper unavailable: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("OCR helper input missing")?;
    let stdout = child.stdout.take().ok_or("OCR helper output missing")?;
    let stderr = child.stderr.take().ok_or("OCR helper errors missing")?;
    let work = async {
        let ((output, error), status) = tokio::try_join!(
            async {
                let (_, output, error) = tokio::try_join!(
                    async move {
                        stdin.write_all(&bytes).await.map_err(|e| e.to_string())?;
                        // Unix ChildStdin::shutdown is a no-op. Drop the pipe
                        // so the helper sees EOF before we await its output.
                        drop(stdin);
                        Ok::<_, String>(())
                    },
                    bounded(stdout, limit),
                    bounded(stderr, 65536)
                )?;
                Ok::<_, String>((output, error))
            },
            async { child.wait().await.map_err(|e| e.to_string()) }
        )?;
        if !status.success() {
            return Err(format!(
                "OCR helper failed: {}",
                String::from_utf8_lossy(&error)
            ));
        }
        serde_json::from_slice(&output).map_err(|e| e.to_string())
    };
    let outcome = tokio::select! {
        biased;
        () = self::cancelled(cancelled) => Err("OCR cancelled".into()),
        outcome = tokio::time::timeout(Duration::from_secs(120),work) => outcome.map_err(|_|"OCR helper deadline exceeded".to_owned()).and_then(|v|v),
    };
    if outcome.is_err() {
        stop(&mut child).await?;
    }
    checked(cancelled)?;
    outcome
}
fn tuned_provider(binding: &OcrPackageBinding, models: &NativeOcrModels) -> OcrProvider {
    provider_for(binding, models.installed(&binding.profile.profile_id))
}
fn provider_for(
    binding: &OcrPackageBinding,
    installed: Result<mlearn_runtime::native_ocr::NativeOcrProfile, String>,
) -> OcrProvider {
    let reason = installed.as_ref().err().cloned();
    let revision = match installed {
        Ok(profile) => profile
            .revision()
            .map(|v| {
                let mut revision = Sha256::new();
                revision.update(v.as_bytes());
                revision.update(binding.package_revision.as_bytes());
                revision.update(mlearn_desktop_ocr::executor_revision().as_bytes());
                revision.update(Sha256::digest(include_bytes!(
                    "../../native/OcrHelper.swift"
                )));
                format!("{:x}", revision.finalize())
            })
            .unwrap_or_else(|e| format!("invalid:{e}")),
        Err(_) => format!("uninstalled/{}", binding.package_revision),
    };
    OcrProvider {
        id: binding.profile.provider_id.clone(),
        label: binding.profile.label.clone(),
        revision,
        availability: if reason.is_none() {
            OcrAvailability::Ready
        } else {
            OcrAvailability::Unavailable
        },
        languages: binding.profile.languages.clone(),
        scripts: binding.profile.scripts.clone(),
        language_provenance: format!("Authenticated package {}", binding.package_id),
        reason,
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Detection {
    width: u32,
    height: u32,
    crop: Option<OcrRect>,
    detections: Vec<OcrQuad>,
    metrics: Value,
}
#[derive(Clone, Serialize, Deserialize)]
struct Group {
    quad: OcrQuad,
    sources: Vec<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recognition {
    raw_recognition: Vec<String>,
    confidences: Vec<Option<f64>>,
    metrics: Value,
}
async fn frame<R: AsyncBufRead + Unpin>(reader: &mut R) -> Result<Value, String> {
    let mut output = Vec::new();
    loop {
        let data = reader.fill_buf().await.map_err(|e| e.to_string())?;
        if data.is_empty() {
            return Err("OCR worker closed before its stage response".into());
        }
        let newline = data.iter().position(|&b| b == b'\n');
        let size = newline.map_or(data.len(), |p| p + 1);
        if output.len() + size > 192 * 1024 {
            return Err("OCR stage response exceeds 192 KiB".into());
        }
        output.extend_from_slice(&data[..size]);
        reader.consume(size);
        if newline.is_some() {
            break;
        }
    }
    serde_json::from_slice(&output).map_err(|e| format!("Malformed OCR stage response: {e}"))
}
async fn write_frame(writer: &mut tokio::process::ChildStdin, value: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    if bytes.len() > 192 * 1024 - 1 {
        return Err("OCR stage input exceeds 192 KiB".into());
    }
    bytes.push(b'\n');
    writer.write_all(&bytes).await.map_err(|e| e.to_string())?;
    writer.flush().await.map_err(|e| e.to_string())
}
async fn tuned(
    runtime: Arc<RuntimeExecutor>,
    lease: NativeOcrLease,
    plan: OcrPlan,
    provider: OcrProvider,
    binding: OcrPackageBinding,
    owner: Arc<OcrJobs>,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<OcrNativeResult, String> {
    checked(cancelled)?;
    let epoch = owner.cancellation(&plan.request_id)?;
    let directory = tempfile::Builder::new()
        .prefix("mlearn-ocr-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let mut physical = plan.clone();
    if physical.mime_type == "application/pdf" {
        let output = directory.path().join("page.png");
        helper(json!({"operation":"pdf","location":{"sourceId":plan.source_id,"contentRevision":plan.content_revision,"resourceId":plan.resource_id,"path":plan.path,"mimeType":plan.mime_type,"pageIndex":plan.page_index},"output":output}),1024,cancelled).await?;
        physical.path = output.to_string_lossy().into_owned();
        physical.mime_type = "image/png".into();
        physical.page_index = None;
    }
    let profile_revision = lease.installation().profile.revision()?;
    let mut slot = owner.inference.lock().await;
    let stale = match slot.as_ref() {
        Some(worker) => worker.lease.installation().profile.revision()? != profile_revision,
        None => false,
    };
    if stale && let Some(worker) = slot.take() {
        worker.close().await?;
    }
    if slot.is_none() {
        *slot = Some(inference::Worker::spawn(&owner, lease).await?);
    }
    let work = async {
        let worker = slot.as_mut().ok_or("Rust OCR worker is unavailable")?;
        worker.touch();
        worker
            .send(json!({"plan":physical,"rasterizedPdf":plan.mime_type=="application/pdf"}))
            .await?;
        let detected = worker.receive().await?;
        if detected["type"] != "detected" {
            return Err("Unexpected detector stage response".into());
        }
        let detected: Detection = serde_json::from_value(detected).map_err(|e| e.to_string())?;
        checked(cancelled)?;
        let value=package(runtime.clone(),plan.source_id.clone(),"image.ocr.geometry.v1",
                json!({"detections":detected.detections,"width":detected.width,"height":detected.height,"crop":detected.crop}),epoch.clone()).await?;
        let groups: Vec<Group> = serde_json::from_value(value).map_err(|e| e.to_string())?;
        if groups.len() > 512 {
            return Err("Package recognition groups exceed bounds".into());
        }
        worker.send(json!({"groups":groups})).await?;
        #[cfg(feature = "ocr-probe")]
        owner.recognizing.notify_waiters();
        let recognized = worker.receive().await?;
        if recognized["type"] != "recognized" {
            return Err("Unexpected recognition stage response".into());
        }
        let recognized: Recognition =
            serde_json::from_value(recognized).map_err(|e| e.to_string())?;
        if recognized.raw_recognition.len() != groups.len()
            || recognized.confidences.len() != groups.len()
        {
            return Err("Recognizer/group membership changed".into());
        }
        checked(cancelled)?;
        let normalized = package(
            runtime.clone(),
            plan.source_id.clone(),
            "image.ocr.recognition.v1",
            json!({"texts":recognized.raw_recognition}),
            epoch.clone(),
        )
        .await?;
        let texts: Vec<String> = serde_json::from_value(normalized).map_err(|e| e.to_string())?;
        if texts.len() != groups.len() {
            return Err("Package recognition text membership changed".into());
        }
        let regions = groups
            .iter()
            .zip(texts)
            .enumerate()
            .map(|(i, (group, text))| OcrRegion {
                id: format!("{}:{i}", plan.request_id),
                candidates: vec![OcrCandidate {
                    text: text.clone(),
                    confidence: recognized.confidences[i],
                }],
                text,
                quad: group.quad.clone(),
                language: None,
                orientation: None,
                reading_of: None,
                context_region_ids: None,
            })
            .collect();
        eprintln!(
            "desktop-ocr stages detector={} recognizer={}",
            detected.metrics, recognized.metrics
        );
        Ok::<_, String>(OcrNativeResult {
            request_id: plan.request_id.clone(),
            provider,
            width: detected.width,
            height: detected.height,
            crop: detected.crop,
            regions,
            stage_evidence: Some(OcrStageEvidence {
                profile_revision: profile_revision.clone(),
                package_revision: binding.package_revision,
                detections: detected.detections,
                groups: groups.into_iter().map(|v| v.sources).collect(),
                raw_recognition: recognized.raw_recognition,
            }),
        })
    };
    // Cancellation kills AND reaps before releasing admission; successful pages
    // retain one leased worker until explicit unload, idle expiry or shutdown.
    let outcome = tokio::time::timeout(Duration::from_secs(180), work);
    let mut cancellation = cancelled.clone();
    let result = tokio::select! {
        biased;
        ()=self::cancelled(&mut cancellation)=>Err("OCR cancelled".into()),
        value=outcome=>value.map_err(|_|"Neural OCR deadline exceeded".to_owned()).and_then(|v|v),
    };
    let result = result.and_then(|result| checked(cancelled).map(|()| result));
    match result {
        Ok(result) => {
            if let Some(worker) = slot.as_ref() {
                worker.touch();
            }
            Ok(result)
        }
        Err(error) => {
            let errors = if let Some(worker) = slot.take() {
                worker.close().await?
            } else {
                vec![]
            };
            if errors.is_empty() {
                Err(error)
            } else {
                Err(format!("{error}: {}", String::from_utf8_lossy(&errors)))
            }
        }
    }
}
#[tauri::command]
pub(crate) async fn ocr_providers(
    state: tauri::State<'_, super::NativeState>,
) -> Result<Vec<OcrProvider>, String> {
    providers_owned(&state).await
}
pub(crate) async fn providers_owned(
    state: &super::NativeState,
) -> Result<Vec<OcrProvider>, String> {
    let _permit = state
        .permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Native provider query is busy")?;
    let _guard = state.ocr.auxiliary()?;
    #[cfg(target_os = "macos")]
    let mut cancel = state.ocr.shutdown.subscribe();
    #[cfg(target_os = "macos")]
    let mut providers = serde_json::from_value::<Vec<OcrProvider>>(
        helper(json!({"operation":"providers"}), 131072, &mut cancel).await?,
    )
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let mut providers = Vec::new();
    let runtime = state.runtime.clone();
    let bindings = tauri::async_runtime::spawn_blocking(move || runtime.ocr_package_profiles())
        .await
        .map_err(|e| e.to_string())??;
    providers.extend(
        bindings
            .iter()
            .map(|binding| tuned_provider(binding, &state.ocr_models)),
    );
    Ok(providers)
}
#[tauri::command]
pub(crate) fn reserve_ocr(
    state: tauri::State<'_, super::NativeState>,
    job_id: String,
) -> Result<(), String> {
    state.ocr.reserve(job_id)
}
#[tauri::command]
pub(crate) async fn cancel_ocr(
    state: tauri::State<'_, super::NativeState>,
    job_id: String,
) -> Result<(), String> {
    state.ocr.cancel(&job_id)?;
    runtime(
        state.runtime.clone(),
        json!({"type":"cancel_ocr","requestId":job_id}),
        "ocr_cancelled",
    )
    .await?;
    Ok(())
}
#[tauri::command]
pub(crate) async fn recognize_image(
    state: tauri::State<'_, super::NativeState>,
    job_id: String,
    request: OcrRequest,
) -> Result<String, String> {
    recognize_owned(&state, job_id, request).await
}
pub(crate) async fn recognize_owned(
    state: &super::NativeState,
    job_id: String,
    request: OcrRequest,
) -> Result<String, String> {
    let (_guard, mut cancelled) = state.ocr.start(&job_id)?;
    let result = async {
        if request.request_id != job_id {
            return Err("OCR request identity changed".into());
        }
        checked(&cancelled)?;
        let (_, value) = runtime(
            state.runtime.clone(),
            json!({"type":"plan_ocr","request":request}),
            "ocr_plan",
        )
        .await?;
        let plan: OcrPlan =
            serde_json::from_value(value["plan"].clone()).map_err(|e| e.to_string())?;
        if plan.request_id != job_id
            || plan.source_id != request.source_id
            || plan.resource_id != request.resource_id
            || plan.content_revision != request.content_revision
            || plan.provider_id != request.provider_id
            || plan.crop != request.crop
            || plan.recognition_languages != request.recognition_languages
        {
            return Err("Admitted OCR identity changed".into());
        }
        checked(&cancelled)?;
        let (native, binding) = if matches!(
            plan.provider_id.as_str(),
            "apple.vision.text" | "apple.vision.legacy"
        ) {
            (
                serde_json::from_value(
                    helper(
                        json!({"operation":"recognize","plan":plan}),
                        384 * 1024,
                        &mut cancelled,
                    )
                    .await?,
                )
                .map_err(|e| e.to_string())?,
                None,
            )
        } else {
            let definition = package(
                state.runtime.clone(),
                plan.source_id.clone(),
                "image.ocr.profile.v1",
                json!({}),
                state.ocr.cancellation(&job_id)?,
            )
            .await?;
            let profile: OcrPackageProfile =
                serde_json::from_value(definition).map_err(|e| e.to_string())?;
            let runtime = state.runtime.clone();
            let source = plan.source_id.clone();
            let selected =
                tauri::async_runtime::spawn_blocking(move || runtime.ocr_source_package(&source))
                    .await
                    .map_err(|e| e.to_string())??;
            let runtime = state.runtime.clone();
            let bindings =
                tauri::async_runtime::spawn_blocking(move || runtime.ocr_package_profiles())
                    .await
                    .map_err(|e| e.to_string())??;
            let binding = bindings
                .into_iter()
                .find(|v| {
                    v.package_id == selected.0
                        && v.package_revision == selected.1
                        && v.profile == profile
                })
                .ok_or("Source OCR profile unavailable")?;
            if profile.provider_id != plan.provider_id
                || plan
                    .recognition_languages
                    .iter()
                    .any(|l| !profile.languages.contains(l))
            {
                return Err(
                    "Selected tuned provider is not applicable to this source package/language"
                        .into(),
                );
            }
            inference::unload(&state.ocr, Some(&profile.profile_id)).await?;
            let models = state.ocr_models.clone();
            let id = profile.profile_id.clone();
            let token = cancelled.clone();
            let admitted_at = std::time::Instant::now();
            let lease =
                tauri::async_runtime::spawn_blocking(move || models.admit_cancellable(&id, &token))
                    .await
                    .map_err(|e| e.to_string())??;
            eprintln!(
                "desktop-ocr admission elapsed_ms={}",
                admitted_at.elapsed().as_millis()
            );
            checked(&cancelled)?;
            let provider = provider_for(&binding, Ok(lease.installation().profile.clone()));
            let result = tuned(
                state.runtime.clone(),
                lease,
                plan.clone(),
                provider,
                binding.clone(),
                state.ocr.clone(),
                &mut cancelled,
            )
            .await?;
            (result, Some(binding))
        };
        let runtime = state.runtime.clone();
        let owner = state.ocr.clone();
        let id = job_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            owner.publish(&id, || {
                let raw =
                    runtime.complete_native_ocr(&plan.source_id, binding.as_ref(), &native)?;
                let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                if value["type"] != "ocr_page" {
                    return Err(value["message"]
                        .as_str()
                        .unwrap_or("OCR publication failed")
                        .into());
                }
                Ok(raw)
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    .await;
    if result.is_err() {
        state.ocr.cancel(&job_id)?;
        if let Err(error) = runtime(
            state.runtime.clone(),
            json!({"type":"cancel_ocr","requestId":job_id}),
            "ocr_cancelled",
        )
        .await
        {
            eprintln!("OCR runtime cleanup failed: {error}");
        }
    }
    result
}
#[tauri::command]
pub(crate) async fn image_page_uri(
    state: tauri::State<'_, super::NativeState>,
    source_id: String,
    resource_id: String,
    crop: Option<OcrRect>,
) -> Result<String, String> {
    display_owned(&state, source_id, resource_id, crop).await
}
pub(crate) async fn display_owned(
    state: &super::NativeState,
    source_id: String,
    resource_id: String,
    crop: Option<OcrRect>,
) -> Result<String, String> {
    let _permit = state
        .ocr
        .display
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Image display conversion is busy")?;
    let _guard = state.ocr.auxiliary()?;
    let mut cancel = state.ocr.shutdown.subscribe();
    let (_, value) = runtime(
        state.runtime.clone(),
        json!({"type":"image_page_location","sourceId":source_id,"resourceId":resource_id}),
        "image_page_location",
    )
    .await?;
    serde_json::from_value(
        helper(
            json!({"operation":"display","location":value["location"],"crop":crop}),
            8 * 1024 * 1024,
            &mut cancel,
        )
        .await?,
    )
    .map_err(|e| e.to_string())
}
#[derive(Serialize)]
pub(crate) struct PickedImages {
    paths: Vec<String>,
    title: String,
}
#[tauri::command]
pub(crate) async fn pick_images(folder: bool) -> Result<Option<PickedImages>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = rfd::FileDialog::new();
        let paths = if folder {
            picker.pick_folder().map(|p| vec![p])
        } else {
            picker
                .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
                .pick_files()
        };
        let Some(paths) = paths else {
            return Ok(None);
        };
        if paths.is_empty() || paths.len() > 128 {
            return Err("Select 1-128 ordered image pages".into());
        }
        let title = paths
            .first()
            .and_then(|p| if folder { p.file_name() } else { p.file_stem() })
            .map(|s| s.to_string_lossy().into_owned())
            .ok_or("Image selection has no title")?;
        Ok(Some(PickedImages {
            paths: paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            title,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn ocr_models(
    state: tauri::State<'_, super::NativeState>,
) -> Result<Value, String> {
    let models = state.ocr_models.clone();
    let permit = state
        .permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Native model query is busy")?;
    let guard = state.ocr.auxiliary()?;
    tauri::async_runtime::spawn_blocking(move || {
        let (_permit, _guard) = (permit, guard);
        let (inventory, reason) = models.inventory()?;
        Ok(json!({"models":inventory,"catalogReason":reason,"installation":models.status()?}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn install_ocr_model(
    state: tauri::State<'_, super::NativeState>,
    profile_id: String,
) -> Result<(), String> {
    inference::unload(&state.ocr, None).await?;
    let models = state.ocr_models.clone();
    let guard = state.ocr.auxiliary()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        models.install(&profile_id)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) fn cancel_ocr_model_install(
    state: tauri::State<'_, super::NativeState>,
) -> Result<Value, String> {
    serde_json::to_value(state.ocr_models.cancel_install()?).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) fn ocr_model_install_status(
    state: tauri::State<'_, super::NativeState>,
) -> Result<Value, String> {
    serde_json::to_value(state.ocr_models.status()?).map_err(|e| e.to_string())
}
#[tauri::command]
pub(crate) async fn remove_ocr_model(
    state: tauri::State<'_, super::NativeState>,
    profile_id: String,
) -> Result<(), String> {
    inference::unload(&state.ocr, None).await?;
    let models = state.ocr_models.clone();
    let permit = state
        .permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Native model removal is busy")?;
    let guard = state.ocr.auxiliary()?;
    tauri::async_runtime::spawn_blocking(move || {
        let (_permit, _guard) = (permit, guard);
        models.remove(&profile_id)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn test_ocr_model(
    state: tauri::State<'_, super::NativeState>,
    profile_id: String,
) -> Result<Value, String> {
    test_owned(&state, profile_id).await
}
pub(crate) async fn test_owned(
    state: &super::NativeState,
    profile_id: String,
) -> Result<Value, String> {
    let id = format!("model-test:{}", uuid::Uuid::new_v4());
    state.ocr.reserve(id.clone())?;
    let (_guard, mut cancelled) = state.ocr.start(&id)?;
    inference::unload(&state.ocr, None).await?;
    let models = state.ocr_models.clone();
    let token = cancelled.clone();
    let lease =
        tauri::async_runtime::spawn_blocking(move || models.admit_cancellable(&profile_id, &token))
            .await
            .map_err(|e| e.to_string())??;
    let directory = tempfile::Builder::new()
        .prefix("mlearn-ocr-test-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let image = directory.path().join("test.png");
    std::fs::write(
        &image,
        include_bytes!("../../../../tests/fixtures/ocr/vision/vertical-ruby.png"),
    )
    .map_err(|e| e.to_string())?;
    let profile_revision = lease.installation().profile.revision()?;
    let mut worker = inference::Worker::spawn(&state.ocr, lease).await?;
    let started = std::time::Instant::now();
    let work = async {
        worker.send(json!({"plan":{"requestId":id,"sourceId":"model-test","contentRevision":"model-test",
            "resourceId":"model-test","providerId":"model-test","recognitionLanguages":[],
            "path":image,"mimeType":"image/png","pageIndex":null,"crop":null},"rasterizedPdf":false})).await?;
        let detected: Detection =
            serde_json::from_value(worker.receive().await?).map_err(|error| error.to_string())?;
        let first = detected
            .detections
            .first()
            .ok_or("Model test detected no text in its known source")?;
        worker
            .send(json!({"groups":[{"quad":first,"sources":[0]}]}))
            .await?;
        let recognized: Recognition =
            serde_json::from_value(worker.receive().await?).map_err(|error| error.to_string())?;
        let text = recognized
            .raw_recognition
            .first()
            .filter(|text| !text.trim().is_empty())
            .ok_or("Model test returned no recognition")?;
        Ok::<_, String>(
            json!({"detectedRegions":detected.detections.len(),"rawRecognition":text,
            "elapsedMs":started.elapsed().as_secs_f64()*1000.0,"profileRevision":profile_revision,
            "executorRevision":mlearn_desktop_ocr::executor_revision(),
            "execution":{"detector":detected.metrics,"recognizer":recognized.metrics}}),
        )
    };
    let outcome = tokio::select! {
        biased;
        () = self::cancelled(&mut cancelled) => Err("Native OCR model test cancelled".into()),
        result = tokio::time::timeout(Duration::from_secs(180), work) =>
            result.map_err(|_|"Native OCR model test deadline exceeded".to_owned()).and_then(|result| result),
    };
    let errors = worker.close().await?;
    outcome.map_err(|error| {
        if errors.is_empty() {
            error
        } else {
            format!("{error}: {}", String::from_utf8_lossy(&errors))
        }
    })
}
#[cfg(test)]
mod tests;
