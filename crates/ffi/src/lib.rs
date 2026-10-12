use mlearn_language_host::CodePolicy;
use mlearn_runtime::Runtime;
use std::{path::Path, sync::{Arc, Mutex}};
uniffi::setup_scaffolding!();
include!(concat!(env!("OUT_DIR"), "/bundled.rs"));

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum BridgeError {
    #[error("{message}")]
    Initialization { message: String },
}

#[derive(uniffi::Object)]
pub struct RuntimeBridge { runtime: Mutex<Runtime> }

#[uniffi::export]
impl RuntimeBridge {
    #[uniffi::constructor]
    pub fn new(profile_path: String) -> Result<Arc<Self>, BridgeError> {
        let plugins = bundled_plugins().map_err(|message| BridgeError::Initialization { message })?;
        let runtime = Runtime::open(Path::new(&profile_path), CodePolicy::MobileBundled, None, plugins).map_err(|message| BridgeError::Initialization { message })?;
        Ok(Arc::new(Self { runtime: Mutex::new(runtime) }))
    }
    /// Native host invokes on a background queue. A busy request never creates an unbounded queue.
    pub fn execute(&self, request: String) -> String {
        match self.runtime.try_lock() {
            Ok(mut runtime) => runtime.execute(&request),
            Err(_) => r#"{"type":"error","code":"busy","message":"Native runtime is busy; retry after the current operation."}"#.into(),
        }
    }
}
