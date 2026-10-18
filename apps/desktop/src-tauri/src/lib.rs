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

fn media_resolver(runtime: Arc<Mutex<Runtime>>) -> Result<media::Resolver, String> {
    let reader = runtime
        .lock()
        .map_err(|_| "Native runtime lock poisoned")?
        .media_source_reader()?;
    let reader = Mutex::new(reader);
    Ok(Arc::new(move |id| {
        let reader = reader
            .lock()
            .map_err(|_| tauri::http::StatusCode::SERVICE_UNAVAILABLE)?;
        reader(id).map_err(|_| tauri::http::StatusCode::NOT_FOUND)
    }))
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
            let resolver = media_resolver(state.runtime.clone()).map_err(std::io::Error::other)?;
            let server = media_listener.start(resolver)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_core::SourceRecord;
    use mlearn_storage::ProfileStore;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn admitted_media_remains_available_while_execution_owner_is_busy() {
        // Given an admitted source in real storage and the actual host resolver.
        let root = tempfile::tempdir().unwrap();
        let video = root.path().join("source.mp4");
        std::fs::write(&video, b"media authorization fixture").unwrap();
        let runtime = Runtime::open(root.path(), CodePolicy::DesktopDownloaded, None, vec![]).unwrap();
        let store = ProfileStore::open(&root.path().join("profile.sqlite3")).unwrap();
        store.save_source(&SourceRecord {
            id: "admitted".into(), title: "Source".into(),
            media_path: video.to_string_lossy().into_owned(), media_revision: "revision".into(),
            subtitle_path: None, subtitle_revision: None,
            package_id: "package".into(), package_version: "1".into(),
            position_ms: 0, duration_ms: 0,
        }).unwrap();
        let runtime = Arc::new(Mutex::new(runtime));
        let resolver = media_resolver(runtime.clone()).unwrap();
        let execution = runtime.lock().unwrap();
        let (send, received) = mpsc::channel();

        // When execution retains its mutex, media authorization must still finish.
        let worker = std::thread::spawn(move || send.send(resolver("admitted")).unwrap());
        let result = received.recv_timeout(Duration::from_secs(5));
        drop(execution);
        worker.join().unwrap();

        // Then it resolves the admitted file without waiting for execution release.
        assert_eq!(result.expect("media authorization waited for language execution").unwrap(), video.canonicalize().unwrap());
    }
}
