use mlearn_language_host::CodePolicy;
use mlearn_runtime::{Runtime, catalog::CatalogTrust};
use std::sync::{Arc, Mutex};
use tauri::Manager;

struct NativeState {
    runtime: Arc<Mutex<Runtime>>,
    permits: Arc<tokio::sync::Semaphore>,
}

#[tauri::command]
async fn runtime_execute(state: tauri::State<'_, NativeState>, request: String) -> Result<String, String> {
    if request.len() > 262_144 { return Err("Request exceeds 256 KiB".into()); }
    let permit = state.permits.clone().try_acquire_owned().map_err(|_| "Native runtime is busy; retry after the current operation")?;
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let mut runtime = runtime.lock().map_err(|_| "Native runtime lock poisoned")?;
        Ok(runtime.execute(&request))
    }).await.map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_data_dir()?;
            let trust: Option<CatalogTrust> = option_env!("MLEARN_CATALOG_TRUST").filter(|s| !s.is_empty()).map(serde_json::from_str).transpose()?;
            // Desktop never receives bundled executable language modules.
            let runtime = Runtime::open(&path, CodePolicy::DesktopDownloaded, trust, vec![]).map_err(std::io::Error::other)?;
            app.manage(NativeState { runtime: Arc::new(Mutex::new(runtime)), permits: Arc::new(tokio::sync::Semaphore::new(2)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![runtime_execute])
        .run(tauri::generate_context!())
        .expect("mLearn desktop host failed to start");
}
