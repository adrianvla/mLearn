//! Host-only extraction. Canonical plans and media locations come from Rust admission.
use base64::Engine;
use mlearn_core::{CapturedMediaFile, MaterialMediaKind, MediaCapturePlan, MediaCaptureRequest};
use mlearn_runtime::RuntimeExecutor;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU8, Ordering};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
#[cfg(not(target_os = "macos"))]
use tokio::sync::watch;
#[cfg(target_os = "macos")]
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::watch,
};

#[cfg(any(not(target_os = "macos"), test))]
#[path = "media_capture_ffmpeg.rs"]
mod ffmpeg;

const SELECTION_BYTES: u64 = 128 * 1024 * 1024;

struct Active {
    id: String,
    cancel: watch::Sender<bool>,
    started: bool,
    finished: watch::Sender<bool>,
}

pub(crate) struct Captures {
    active: Mutex<Option<Active>>,
    outputs: Mutex<HashSet<PathBuf>>,
    root: PathBuf,
    shutdown: AtomicU8,
}

impl Captures {
    pub(crate) fn new() -> Self {
        Self {
            active: Mutex::new(None),
            outputs: Mutex::new(HashSet::new()),
            root: std::env::temp_dir().join(format!("mlearn-capture-{}", uuid::Uuid::new_v4())),
            shutdown: AtomicU8::new(0),
        }
    }

    pub(crate) fn reserve(&self, id: String) -> Result<(), String> {
        if id.is_empty() || id.len() > 128 {
            return Err("Invalid media job identity".into());
        }
        let mut active = self.active.lock().map_err(|_| "Media owner poisoned")?;
        if self.shutdown.load(Ordering::Acquire) != 0
            || active.is_some()
            || self
                .outputs
                .lock()
                .map_err(|_| "Media files poisoned")?
                .len()
                >= 8
        {
            return Err("Media capture is busy; release pending files and retry".into());
        }
        let (cancel, _) = watch::channel(false);
        let (finished, _) = watch::channel(false);
        *active = Some(Active {
            id,
            cancel,
            started: false,
            finished,
        });
        Ok(())
    }

    pub(crate) fn cancel(&self, id: &str) -> Result<(), String> {
        let active = self.active.lock().map_err(|_| "Media owner poisoned")?;
        if let Some(job) = active.as_ref().filter(|job| job.id == id) {
            job.cancel.send_replace(true);
        }
        Ok(())
    }

    fn cancellation(&self, id: &str) -> Result<watch::Receiver<bool>, String> {
        let mut active = self.active.lock().map_err(|_| "Media owner poisoned")?;
        let job = active
            .as_mut()
            .filter(|job| job.id == id)
            .ok_or("Media capture was cancelled")?;
        if job.started {
            return Err("This media job is already running".into());
        }
        job.started = true;
        Ok(job.cancel.subscribe())
    }

    fn finish(&self, id: &str) {
        match self.active.lock() {
            Ok(mut active) => {
                if active.as_ref().is_some_and(|job| job.id == id) {
                    if let Some(job) = active.as_ref() {
                        job.finished.send_replace(true);
                    }
                    *active = None;
                }
            }
            Err(error) => eprintln!("Media capture owner cleanup failed: {error}"),
        }
    }

    pub(crate) fn release(&self, path: &str) -> Result<(), String> {
        let mut outputs = self.outputs.lock().map_err(|_| "Media files poisoned")?;
        let path = Path::new(path);
        if outputs.contains(path) {
            let directory = path.parent().ok_or("Captured media has no parent")?;
            std::fs::remove_dir_all(directory).map_err(|e| e.to_string())?;
            outputs.remove(path);
        }
        Ok(())
    }

    pub(crate) fn shutdown_finished(&self) -> bool {
        self.shutdown.load(Ordering::Acquire) == 2
    }

    pub(crate) fn begin_shutdown(&self) -> bool {
        self.shutdown
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub(crate) async fn shutdown(&self) {
        let completion = match self.active.lock() {
            Ok(mut active) => {
                if let Some(job) = active.as_ref() {
                    job.cancel.send_replace(true);
                    if job.started {
                        Some(job.finished.subscribe())
                    } else {
                        *active = None;
                        None
                    }
                } else {
                    None
                }
            }
            Err(error) => {
                eprintln!("Media shutdown owner failed: {error}");
                None
            }
        };
        if let Some(mut completion) = completion
            && !*completion.borrow()
            && let Err(error) =
                tokio::time::timeout(std::time::Duration::from_secs(10), completion.changed()).await
        {
            eprintln!("Media shutdown did not receive its cleanup receipt: {error}");
        }
        if self.root.exists()
            && let Err(error) = tokio::fs::remove_dir_all(&self.root).await
        {
            eprintln!("Media shutdown temporary cleanup failed: {error}");
        }
        self.shutdown.store(2, Ordering::Release);
    }
}

impl Drop for Captures {
    fn drop(&mut self) {
        if self.root.exists()
            && let Err(error) = std::fs::remove_dir_all(&self.root)
        {
            eprintln!("Media temporary files cleanup failed: {error}");
        }
    }
}

struct CaptureGuard<'a> {
    owner: &'a Captures,
    id: &'a str,
    directory: PathBuf,
    published: bool,
}

impl CaptureGuard<'_> {
    fn stage_selection(
        &mut self,
        path: &Path,
        kind: MaterialMediaKind,
        cancelled: &watch::Receiver<bool>,
    ) -> Result<serde_json::Value, String> {
        let output = self.stage_file(path, SELECTION_BYTES, cancelled)?;
        Ok(
            serde_json::json!({"path":output,"name":path.file_name().and_then(|name| name.to_str()),"kind":kind}),
        )
    }

    fn stage_file(
        &mut self,
        path: &Path,
        maximum_bytes: u64,
        cancelled: &watch::Receiver<bool>,
    ) -> Result<PathBuf, String> {
        if *cancelled.borrow() {
            return Err("Media selection cancelled".into());
        }
        let name = path
            .file_name()
            .ok_or("Selected media has no filename")?
            .to_str()
            .ok_or("Invalid selected filename")?;
        if name.len() > 255 || name.contains(['/', '\\', '\0']) {
            return Err("Invalid selected filename".into());
        }
        let mut input = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let before = input.metadata().map_err(|e| e.to_string())?;
        if !before.is_file() || before.len() == 0 || before.len() > maximum_bytes {
            return Err(format!(
                "Select an ordinary file up to {} MiB",
                maximum_bytes / 1024 / 1024
            ));
        }
        std::fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let output = self.directory.join(name);
        let mut destination = std::fs::File::create(&output).map_err(|e| e.to_string())?;
        let bytes = copy_selection_bounded(&mut input, &mut destination, maximum_bytes, cancelled)?;
        if bytes != before.len() || input.metadata().map_err(|e| e.to_string())?.len() != bytes {
            return Err("Media changed while copying; select it again".into());
        }
        if *cancelled.borrow() || self.owner.shutdown.load(Ordering::Acquire) != 0 {
            return Err("Media selection cancelled".into());
        }
        self.owner
            .outputs
            .lock()
            .map_err(|_| "Media files poisoned")?
            .insert(output.clone());
        self.published = true;
        Ok(output)
    }
}

#[cfg(test)]
fn copy_selection(
    input: &mut impl Read,
    output: &mut impl Write,
    cancelled: &watch::Receiver<bool>,
) -> Result<u64, String> {
    copy_selection_bounded(input, output, SELECTION_BYTES, cancelled)
}

fn copy_selection_bounded(
    input: &mut impl Read,
    output: &mut impl Write,
    maximum_bytes: u64,
    cancelled: &watch::Receiver<bool>,
) -> Result<u64, String> {
    let mut buffer = [0; 65536];
    let mut bytes = 0u64;
    loop {
        if *cancelled.borrow() {
            return Err("Media selection cancelled".into());
        }
        let remaining =
            usize::try_from((maximum_bytes - bytes + 1).min(65536)).map_err(|e| e.to_string())?;
        let count = input
            .read(&mut buffer[..remaining])
            .map_err(|e| e.to_string())?;
        if *cancelled.borrow() {
            return Err("Media selection cancelled".into());
        }
        if count == 0 {
            return Ok(bytes);
        }
        // Metadata is admission only: the selected file can grow during copying.
        bytes += u64::try_from(count).map_err(|e| e.to_string())?;
        if bytes > maximum_bytes {
            return Err(format!(
                "Selected file exceeds {} MiB",
                maximum_bytes / 1024 / 1024
            ));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
    }
}

#[tauri::command]
pub(crate) async fn pick_document(
    state: tauri::State<'_, super::NativeState>,
) -> Result<Option<String>, String> {
    let owner = state.captures.clone();
    let job_id = uuid::Uuid::new_v4().to_string();
    owner.reserve(job_id.clone())?;
    let cancelled = owner.cancellation(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = CaptureGuard {
            owner: &owner,
            id: &job_id,
            directory: owner.root.join(uuid::Uuid::new_v4().to_string()),
            published: false,
        };
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Documents", &["txt", "epub", "pdf"])
            .pick_file()
        else {
            return Ok(None);
        };
        if !matches!(
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("txt" | "epub" | "pdf")
        ) {
            return Err("Select a TXT, EPUB or PDF document".into());
        }
        let output = guard.stage_file(&path, 8 * 1024 * 1024, &cancelled)?;
        Ok(Some(
            output.to_str().ok_or("Invalid document path")?.to_owned(),
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

impl Drop for CaptureGuard<'_> {
    fn drop(&mut self) {
        if !self.published
            && self.directory.exists()
            && let Err(error) = std::fs::remove_dir_all(&self.directory)
        {
            eprintln!("Partial media cleanup failed: {error}");
        }
        self.owner.finish(self.id);
    }
}

fn response(
    runtime: &RuntimeExecutor,
    request: serde_json::Value,
    expected: &str,
) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_str(&runtime.execute(&request.to_string())).map_err(|e| e.to_string())?;
    if value["type"].as_str() != Some(expected) {
        return Err(value["message"]
            .as_str()
            .unwrap_or("Runtime media action failed")
            .to_owned());
    }
    Ok(value)
}

#[tauri::command]
pub(crate) fn reserve_media_capture(
    state: tauri::State<'_, super::NativeState>,
    job_id: String,
) -> Result<(), String> {
    state.captures.reserve(job_id)
}
#[tauri::command]
pub(crate) fn cancel_media_capture(
    state: tauri::State<'_, super::NativeState>,
    job_id: String,
) -> Result<(), String> {
    state.captures.cancel(&job_id)
}
#[tauri::command]
pub(crate) async fn release_media_capture(
    state: tauri::State<'_, super::NativeState>,
    path: String,
) -> Result<(), String> {
    let owner = state.captures.clone();
    tauri::async_runtime::spawn_blocking(move || owner.release(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn capture_media(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::NativeState>,
    job_id: String,
    request: MediaCaptureRequest,
) -> Result<CapturedMediaFile, String> {
    let owner = &state.captures;
    let mut cancelled = owner.cancellation(&job_id)?;
    let mut guard = CaptureGuard {
        owner,
        id: &job_id,
        directory: owner.root.join(uuid::Uuid::new_v4().to_string()),
        published: false,
    };
    if *cancelled.borrow() {
        return Err("Media capture cancelled".into());
    }
    let runtime = state.runtime.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || {
        let value = response(
            &runtime,
            serde_json::json!({"type":"plan_material_media","request":request}),
            "material_media_plan",
        )?;
        serde_json::from_value::<MediaCapturePlan>(value["plan"].clone()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    if *cancelled.borrow() {
        return Err("Media capture cancelled".into());
    }
    std::fs::create_dir_all(&guard.directory).map_err(|e| e.to_string())?;
    let file = extract(&app, &plan, &guard.directory, &mut cancelled).await?;
    if *cancelled.borrow() {
        return Err("Media capture cancelled".into());
    }
    // The provider cannot publish a path outside this job's private directory.
    let output = PathBuf::from(&file.path);
    if output.parent() != Some(guard.directory.as_path()) || !output.is_file() {
        return Err("The capture provider returned an invalid output".into());
    }
    owner
        .outputs
        .lock()
        .map_err(|_| "Media files poisoned")?
        .insert(output);
    guard.published = true;
    Ok(file)
}

#[cfg(target_os = "macos")]
async fn extract(
    app: &tauri::AppHandle,
    plan: &MediaCapturePlan,
    directory: &Path,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<CapturedMediaFile, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundled = executable
        .parent()
        .ok_or("Application binary has no parent")?
        .join("mlearn-media");
    #[cfg(debug_assertions)]
    let bundled = if bundled.is_file() {
        bundled
    } else {
        PathBuf::from(env!("MLEARN_APPLE_MEDIA_HELPER"))
    };
    let _ = app;
    let mut child = tokio::process::Command::new(bundled)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Bundled Apple media provider unavailable: {e}"))?;
    let mut input = child
        .stdin
        .take()
        .ok_or("Media provider stdin unavailable")?;
    input
        .write_all(
            &serde_json::to_vec(&serde_json::json!({"plan":plan,"directory":directory}))
                .map_err(|e| e.to_string())?,
        )
        .await
        .map_err(|e| e.to_string())?;
    drop(input);
    let status = tokio::select! {
        biased;
        _ = cancelled.changed() => {
            child.kill().await.map_err(|e| e.to_string())?;
            return Err("Media capture cancelled; provider terminated and reaped".into());
        },
        result = child.wait() => result.map_err(|e| e.to_string())?,
    };
    let mut output = Vec::new();
    child
        .stdout
        .take()
        .ok_or("Media provider stdout unavailable")?
        .take(524_289)
        .read_to_end(&mut output)
        .await
        .map_err(|e| e.to_string())?;
    if !status.success() {
        let mut error = String::new();
        child
            .stderr
            .take()
            .ok_or("Media provider stderr unavailable")?
            .take(8192)
            .read_to_string(&mut error)
            .await
            .map_err(|e| e.to_string())?;
        return Err(format!("Apple media provider failed: {error}"));
    }
    if output.len() > 524_288 {
        return Err("Media provider response is too large".into());
    }
    serde_json::from_slice(&output).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
async fn extract(
    _app: &tauri::AppHandle,
    plan: &MediaCapturePlan,
    directory: &Path,
    cancelled: &mut watch::Receiver<bool>,
) -> Result<CapturedMediaFile, String> {
    ffmpeg::extract(plan, directory, cancelled).await
}

pub(crate) fn authored_resolver(
    runtime: &mlearn_runtime::Runtime,
) -> Result<super::media::AuthoredResolver, String> {
    let reader = Mutex::new(runtime.authored_media_reader()?);
    Ok(Arc::new(move |id| {
        reader
            .lock()
            .map_err(|_| tauri::http::StatusCode::SERVICE_UNAVAILABLE)?(id)
        .map_err(|_| tauri::http::StatusCode::NOT_FOUND)
    }))
}

#[tauri::command]
pub(crate) async fn authored_media_uri(
    state: tauri::State<'_, super::NativeState>,
    id: String,
) -> Result<String, String> {
    let runtime = state.runtime.clone();
    let checked = id.clone();
    let image = tauri::async_runtime::spawn_blocking(move || {
        let value = response(
            &runtime,
            serde_json::json!({"type":"material_media","id":checked}),
            "material_media",
        )?;
        let location: mlearn_core::MaterialMediaLocation =
            serde_json::from_value(value["location"].clone()).map_err(|e| e.to_string())?;
        if location.media.kind != MaterialMediaKind::Image {
            return Ok::<_, String>(None);
        }
        // img-src already permits data:, not arbitrary loopback hosts. Keep that
        // policy intact; only canonical admitted raster images cross this API.
        if !matches!(
            location.media.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        ) {
            return Err("Unsupported authored image MIME type".into());
        }
        let mut bytes = Vec::new();
        std::fs::File::open(&location.path)
            .map_err(|e| e.to_string())?
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("Authored image exceeds the 32 MiB display limit".into());
        }
        Ok(Some(format!(
            "data:{};base64,{}",
            location.media.mime_type,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(image.unwrap_or_else(|| format!("{}authored/{id}", state.media_base)))
}

#[tauri::command]
pub(crate) async fn export_authored_media(
    state: tauri::State<'_, super::NativeState>,
    id: String,
) -> Result<bool, String> {
    let runtime = state.runtime.clone();
    let owner = state.captures.clone();
    let job_id = uuid::Uuid::new_v4().to_string();
    owner.reserve(job_id.clone())?;
    owner.cancellation(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let guard = CaptureGuard {
            owner: &owner,
            id: &job_id,
            directory: owner.root.join(uuid::Uuid::new_v4().to_string()),
            published: false,
        };
        let value = response(
            &runtime,
            serde_json::json!({"type":"material_media","id":id}),
            "material_media",
        )?;
        let location: mlearn_core::MaterialMediaLocation =
            serde_json::from_value(value["location"].clone()).map_err(|e| e.to_string())?;
        // Pin a private snapshot while the OS dialog is open. Removing the
        // attachment elsewhere must not race the eventual export read.
        std::fs::create_dir_all(&guard.directory).map_err(|e| e.to_string())?;
        let snapshot = guard.directory.join("export");
        std::fs::copy(&location.path, &snapshot).map_err(|e| e.to_string())?;
        let Some(destination) = rfd::FileDialog::new()
            .set_file_name(&location.media.name)
            .save_file()
        else {
            return Ok(false);
        };
        if owner.shutdown.load(Ordering::Acquire) != 0 {
            return Err("Media export cancelled by application shutdown".into());
        }
        let store = Path::new(&location.path)
            .parent()
            .ok_or("Authored media has no parent")?;
        let destination_parent = destination
            .parent()
            .ok_or("Export destination has no parent")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if destination_parent.starts_with(store) {
            return Err("Choose a destination outside the private media store".into());
        }
        std::fs::copy(&snapshot, destination).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn pick_authored_media(
    state: tauri::State<'_, super::NativeState>,
    kind: MaterialMediaKind,
) -> Result<Option<serde_json::Value>, String> {
    let owner = state.captures.clone();
    let job_id = uuid::Uuid::new_v4().to_string();
    owner.reserve(job_id.clone())?;
    let cancelled = owner.cancellation(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = CaptureGuard {
            owner: &owner,
            id: &job_id,
            directory: owner.root.join(uuid::Uuid::new_v4().to_string()),
            published: false,
        };
        let extensions: &[&str] = match kind {
            MaterialMediaKind::Image => &["png", "jpg", "jpeg", "webp", "gif"],
            MaterialMediaKind::Audio => &["m4a", "mp3", "wav", "ogg", "flac"],
            MaterialMediaKind::Video => &["mp4", "mov", "m4v", "webm", "mkv"],
        };
        rfd::FileDialog::new()
            .add_filter("Media", extensions)
            .pick_file()
            .map(|path| guard.stage_selection(&path, kind, &cancelled))
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "media_capture_tests.rs"]
mod tests;
