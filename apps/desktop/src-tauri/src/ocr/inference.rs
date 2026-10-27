//! One warm Rust worker; the existing OCR admission remains the sole job owner.
use super::{OcrJobs, checked, frame, stop, write_frame};
use mlearn_runtime::native_ocr::{NativeOcrLease, native_ocr_library};
use serde_json::Value;
use std::{path::Path, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, BufReader},
    sync::watch,
    time::Instant,
};

const IDLE: Duration = Duration::from_secs(120);

pub(super) struct Worker {
    child: tokio::process::Child,
    input: tokio::process::ChildStdin,
    output: BufReader<tokio::process::ChildStdout>,
    errors: tokio::task::JoinHandle<Result<Vec<u8>, String>>,
    pub(super) lease: NativeOcrLease,
    idle: watch::Sender<Instant>,
    identity: u64,
    _directory: tempfile::TempDir,
    _guard: super::JobGuard,
}

fn command(directory: &Path, scratch: &Path) -> Result<tokio::process::Command, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = tokio::process::Command::new("/usr/bin/sandbox-exec");
        let policy = format!(
            "(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath {:?}) (literal \"/dev/null\"))",
            scratch.to_string_lossy()
        );
        command.args(["-p", &policy]).arg(executable);
        command
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = tokio::process::Command::new(executable);
    command
        .arg("--native-ocr")
        .arg(directory.join("runtime").join(native_ocr_library()))
        .arg(directory.join("models"))
        .current_dir(scratch)
        .env_clear()
        .env("HOME", scratch)
        .env("TMPDIR", scratch)
        .env("TMP", scratch)
        .env("TEMP", scratch)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    if let Some(root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", root);
    }
    Ok(command)
}

impl Worker {
    pub(super) async fn spawn(owner: &Arc<OcrJobs>, lease: NativeOcrLease) -> Result<Self, String> {
        let guard = owner.auxiliary()?;
        let directory = tempfile::Builder::new()
            .prefix("mlearn-native-ocr-")
            .tempdir()
            .map_err(|error| error.to_string())?;
        let scratch = directory
            .path()
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let mut child = command(&lease.installation().directory, &scratch)?
            .spawn()
            .map_err(|error| format!("Rust OCR worker failed to start: {error}"))?;
        let input = child
            .stdin
            .take()
            .ok_or("Rust OCR worker input is unavailable")?;
        let output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or("Rust OCR worker output is unavailable")?,
        );
        let mut stderr = child
            .stderr
            .take()
            .ok_or("Rust OCR worker errors are unavailable")?;
        // A ring tail, not a lifetime-growing log or an unread full pipe.
        let errors = tokio::spawn(async move {
            let mut tail = Vec::new();
            let mut bytes = [0_u8; 8192];
            loop {
                let count = stderr
                    .read(&mut bytes)
                    .await
                    .map_err(|error| error.to_string())?;
                if count == 0 {
                    return Ok(tail);
                }
                if tail.len() + count > 65536 {
                    tail.drain(..tail.len() + count - 65536);
                }
                tail.extend_from_slice(&bytes[..count]);
            }
        });
        let identity = owner
            .inference_identity
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let idle = watch::channel(Instant::now()).0;
        arm_idle(owner.clone(), identity, idle.subscribe());
        Ok(Self {
            child,
            input,
            output,
            errors,
            lease,
            idle,
            identity,
            _directory: directory,
            _guard: guard,
        })
    }
    pub(super) fn touch(&self) {
        self.idle.send_replace(Instant::now());
    }
    pub(super) async fn send(&mut self, value: Value) -> Result<(), String> {
        write_frame(&mut self.input, value).await
    }
    pub(super) async fn receive(&mut self) -> Result<Value, String> {
        frame(&mut self.output).await
    }
    pub(super) async fn close(mut self) -> Result<Vec<u8>, String> {
        // Keep the resource lease and scratch until kill AND reap and stderr EOF.
        stop(&mut self.child).await?;
        self.errors.await.map_err(|error| error.to_string())?
    }
}

fn arm_idle(owner: Arc<OcrJobs>, identity: u64, mut idle: watch::Receiver<Instant>) {
    let mut closing = owner.shutdown.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            let deadline = *idle.borrow_and_update() + IDLE;
            tokio::select! {
                biased;
                () = super::cancelled(&mut closing) => {},
                changed = idle.changed() => { if changed.is_ok() { continue; } },
                () = tokio::time::sleep_until(deadline) => {},
            }
            let mut slot = owner.inference.lock().await;
            let Some(worker) = slot.as_ref() else {
                return;
            };
            if worker.identity != identity {
                return;
            }
            if checked(&closing).is_ok() && worker.idle.borrow().elapsed() < IDLE {
                continue;
            }
            if let Some(worker) = slot.take()
                && let Err(error) = worker.close().await
            {
                eprintln!("Native OCR idle/shutdown cleanup failed: {error}");
            }
            return;
        }
    });
}

pub(super) async fn unload(owner: &OcrJobs, except_profile: Option<&str>) -> Result<(), String> {
    let mut slot = owner
        .inference
        .try_lock()
        .map_err(|_| "Cancel active OCR before changing native resources")?;
    if slot.as_ref().is_some_and(|worker| {
        Some(worker.lease.installation().profile.id.as_str()) == except_profile
    }) {
        return Ok(());
    }
    if let Some(worker) = slot.take() {
        worker.close().await?;
    }
    Ok(())
}
