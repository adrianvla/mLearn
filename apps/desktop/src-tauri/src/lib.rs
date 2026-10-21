use mlearn_language_host::CodePolicy;
use mlearn_runtime::{Runtime, RuntimeExecutor, catalog::CatalogTrust};
use std::sync::{Arc, Mutex};
use tauri::Manager;

mod media;
mod window_material;

struct NativeState {
    runtime: Arc<RuntimeExecutor>,
    permits: Arc<tokio::sync::Semaphore>,
    cancellation: Arc<std::sync::atomic::AtomicU64>,
    material: Arc<Mutex<window_material::WindowMaterial>>,
}

fn media_resolver(runtime: &Runtime) -> Result<media::Resolver, String> {
    let reader = runtime.media_source_reader()?;
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
    app: tauri::AppHandle,
    state: tauri::State<'_, NativeState>,
    request: String,
) -> Result<String, String> {
    let started = std::time::Instant::now();
    if request.len() > 262_144 {
        return Err("Request exceeds 256 KiB".into());
    }
    let permit = state
        .permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Native runtime is busy; retry after the current operation")?;
    let runtime = state.runtime.clone();
    let action = window_material::ThemeAction::from_request(&request);
    let (response, snapshot) = tauri::async_runtime::spawn_blocking(move || {
        let worker_wait = started.elapsed();
        let _permit = permit;
        let response = runtime.execute(&request);
        let snapshot = action.accepted_snapshot(&runtime, &response);
        if std::env::var_os("MLEARN_PLUGIN_METRICS").is_some() {
            eprintln!(
                "runtime-ipc worker_wait_us={} elapsed_us={} response_bytes={}",
                worker_wait.as_micros(),
                started.elapsed().as_micros(),
                response.len()
            );
        }
        (response, snapshot)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Some(snapshot) = snapshot
        && let Err(error) =
            window_material::synchronize(&app, state.material.clone(), snapshot).await
    {
        eprintln!("Native window material update failed: {error}");
    }
    Ok(response)
}

#[tauri::command]
fn window_material_active(state: tauri::State<'_, NativeState>) -> Result<bool, String> {
    state
        .material
        .lock()
        .map(|material| material.active())
        .map_err(|_| "Window material state poisoned".into())
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
            let mut runtime = Runtime::open(&path, CodePolicy::DesktopDownloaded, trust, vec![])
                .map_err(std::io::Error::other)?;
            let snapshot =
                window_material::startup_snapshot(&mut runtime).map_err(std::io::Error::other)?;
            let theme_script = window_material::initialization_script(&snapshot.theme)?;
            let resolver = media_resolver(&runtime).map_err(std::io::Error::other)?;
            let cancellation = runtime.cancellation_handle();
            let material = Arc::new(Mutex::new(window_material::WindowMaterial::default()));
            let state = NativeState {
                cancellation,
                runtime: Arc::new(RuntimeExecutor::new(runtime)),
                permits: Arc::new(tokio::sync::Semaphore::new(3)),
                material: material.clone(),
            };
            let server = media_listener.start(resolver)?;
            app.manage(Mutex::new(server));
            app.manage(state);
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == "main")
                .ok_or_else(|| std::io::Error::other("Main window configuration is missing"))?;
            let window = tauri::WebviewWindowBuilder::from_config(app, config)?
                .visible(false)
                .initialization_script(theme_script)
                .build()?;
            material
                .lock()
                .map_err(|_| std::io::Error::other("Window material state poisoned"))?
                .apply(&window, &snapshot)
                .map_err(std::io::Error::other)?;
            window.show()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_execute,
            window_material_active,
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
        let runtime =
            Runtime::open(root.path(), CodePolicy::DesktopDownloaded, None, vec![]).unwrap();
        let store = ProfileStore::open(&root.path().join("profile.sqlite3")).unwrap();
        store
            .save_source(&SourceRecord {
                id: "admitted".into(),
                title: "Source".into(),
                media_path: video.to_string_lossy().into_owned(),
                media_revision: "revision".into(),
                subtitle_path: None,
                subtitle_revision: None,
                package_id: "package".into(),
                package_version: "1".into(),
                position_ms: 0,
                duration_ms: 0,
                subtitle_offset_ms: 0,
                subtitle_offset_revision: 0,
                playback_rate: 1.0,
                inspection_trigger: Default::default(),
            })
            .unwrap();
        let resolver = media_resolver(&runtime).unwrap();
        let runtime = Arc::new(Mutex::new(runtime));
        let execution = runtime.lock().unwrap();
        let (send, received) = mpsc::channel();

        // When execution retains its mutex, media authorization must still finish.
        let worker = std::thread::spawn(move || send.send(resolver("admitted")).unwrap());
        let result = received.recv_timeout(Duration::from_secs(5));
        drop(execution);
        worker.join().unwrap();

        // Then it resolves the admitted file without waiting for execution release.
        assert_eq!(
            result
                .expect("media authorization waited for language execution")
                .unwrap(),
            video.canonicalize().unwrap()
        );
    }
}
