use mlearn_language_host::CodePolicy;
use mlearn_runtime::{Runtime, catalog::CatalogTrust};
use std::sync::{Arc, Mutex};
use tauri::Manager;

mod media;

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
    let media_listener = media::MediaListener::bind().expect("Cannot bind local media transport");
    // This script runs at document start, before the synchronous MediaHost.uri
    // consumer. Do not expose the capability to a navigated external document.
    let media_script = format!(
        "if ({}.includes(location.origin)) Object.defineProperty(window, '__MLEARN_MEDIA_BASE__', {{value:{}}});",
        serde_json::json!(media::ORIGINS),
        serde_json::json!(media_listener.base_url()),
    );
    tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("media")
                .js_init_script(media_script)
                .build(),
        )
        .setup(move |app| {
            let path = app.path().app_data_dir()?;
            let trust: Option<CatalogTrust> = option_env!("MLEARN_CATALOG_TRUST")
                .filter(|s| !s.is_empty())
                .map(serde_json::from_str)
                .transpose()?;
            // Desktop never receives bundled executable language modules.
            let runtime = Runtime::open(&path, CodePolicy::DesktopDownloaded, trust, vec![])
                .map_err(std::io::Error::other)?;
            let cancellation = runtime.cancellation_handle();
            let state = NativeState {
                cancellation,
                runtime: Arc::new(Mutex::new(runtime)),
                permits: Arc::new(tokio::sync::Semaphore::new(2)),
            };
            let runtime = state.runtime.clone();
            let server = media_listener.start(Arc::new(move |id| {
                // The transport admits at most four blocking resolver jobs.
                // Ordinary analysis contention must wait, not fail playback;
                // runtime_execute keeps its existing independent permit gate.
                let runtime = runtime
                    .lock()
                    .map_err(|_| tauri::http::StatusCode::SERVICE_UNAVAILABLE)?;
                runtime
                    .source_media_path(id)
                    .map_err(|_| tauri::http::StatusCode::NOT_FOUND)
            }))?;
            app.manage(Mutex::new(server));
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_execute,
            pick_local_file,
            cancel_source_open
        ])
        .build(tauri::generate_context!())
        .expect("mLearn desktop host failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit)
                && let Ok(mut server) = app.state::<Mutex<media::MediaServer>>().lock()
            {
                server.shutdown();
            }
        });
}
