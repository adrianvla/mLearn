use mlearn_language_host::CodePolicy;
use mlearn_runtime::{Runtime, catalog::CatalogTrust};
use std::sync::{Arc, Mutex};
use tauri::Manager;

struct NativeState {
    runtime: Arc<Mutex<Runtime>>,
    permits: Arc<tokio::sync::Semaphore>,
    cancellation: Arc<std::sync::atomic::AtomicU64>,
}

#[tauri::command]
async fn runtime_execute(
    state: tauri::State<'_, NativeState>,
    request: String,
) -> Result<String, String> {
    if request.len() > 262_144 {
        return Err("Request exceeds 256 KiB".into());
    }
    let permit = state
        .permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Native runtime is busy; retry after the current operation")?;
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let mut runtime = runtime.lock().map_err(|_| "Native runtime lock poisoned")?;
        Ok(runtime.execute(&request))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_source_open(state: tauri::State<'_, NativeState>) {
    state
        .cancellation
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
async fn pick_local_file(subtitles: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = rfd::FileDialog::new();
        let picker = if subtitles {
            picker.add_filter("Plain UTF-8 SRT", &["srt"])
        } else {
            picker.add_filter("Video", &["mp4", "mov", "m4v", "webm", "mkv"])
        };
        picker.pick_file().map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("mlearn-media", |context, request| {
            let result = (|| -> Result<tauri::http::Response<Vec<u8>>, String> {
                use std::io::{Read, Seek, SeekFrom};
                let id = request.uri().path().trim_start_matches('/');
                let state = context.app_handle().state::<NativeState>();
                let path = state
                    .runtime
                    .lock()
                    .map_err(|_| "Runtime unavailable")?
                    .source_media_path(id)?;
                let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
                let length = file.metadata().map_err(|e| e.to_string())?.len();
                let range = request.headers().get("range").and_then(|h| h.to_str().ok());
                // Explicit local diagnostics only; never include content or the filesystem path.
                #[cfg(debug_assertions)]
                if let Some(trace) = std::env::var_os("MLEARN_MEDIA_TRACE") {
                    use std::io::Write;
                    if let Ok(mut output) = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(trace)
                    {
                        let _ = writeln!(
                            output,
                            "method={} extension={} length={} range={:?}",
                            request.method(),
                            path.extension().and_then(|s| s.to_str()).unwrap_or(""),
                            length,
                            range
                        );
                    }
                }

                let (start, end) = if let Some(range) = range {
                    let ranges = http_range::HttpRange::parse(range, length)
                        .map_err(|e| format!("Invalid media range: {e:?}"))?;
                    if ranges.len() != 1 {
                        return Err("One media range per request is supported".into());
                    }
                    (
                        ranges[0].start,
                        (ranges[0].start + ranges[0].length - 1)
                            .min(ranges[0].start + 2 * 1024 * 1024 - 1),
                    )
                } else {
                    if length > 2 * 1024 * 1024 {
                        return Err("Media player must request byte ranges".into());
                    }
                    (0, length.saturating_sub(1))
                };
                file.seek(SeekFrom::Start(start))
                    .map_err(|e| e.to_string())?;
                let mut bytes = vec![0; (end - start + 1) as usize];
                file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
                let mime = match path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                {
                    "mov" => "video/quicktime",
                    "webm" => "video/webm",
                    "mkv" => "video/x-matroska",
                    _ => "video/mp4",
                };
                let mut response = tauri::http::Response::builder()
                    .status(if range.is_some() { 206 } else { 200 })
                    .header("Content-Type", mime)
                    .header("Accept-Ranges", "bytes")
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Content-Length", bytes.len().to_string());
                if range.is_some() {
                    response =
                        response.header("Content-Range", format!("bytes {start}-{end}/{length}"));
                }
                response.body(bytes).map_err(|e| e.to_string())
            })();
            result.unwrap_or_else(|message| {
                tauri::http::Response::builder()
                    .status(416)
                    .body(message.into_bytes())
                    .unwrap()
            })
        })
        .setup(|app| {
            let path = app.path().app_data_dir()?;
            let trust: Option<CatalogTrust> = option_env!("MLEARN_CATALOG_TRUST")
                .filter(|s| !s.is_empty())
                .map(serde_json::from_str)
                .transpose()?;
            // Desktop never receives bundled executable language modules.
            let runtime = Runtime::open(&path, CodePolicy::DesktopDownloaded, trust, vec![])
                .map_err(std::io::Error::other)?;
            let cancellation = runtime.cancellation_handle();
            app.manage(NativeState {
                cancellation,
                runtime: Arc::new(Mutex::new(runtime)),
                permits: Arc::new(tokio::sync::Semaphore::new(2)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_execute,
            pick_local_file,
            cancel_source_open
        ])
        .run(tauri::generate_context!())
        .expect("mLearn desktop host failed to start");
}
