use mlearn_language_host::CodePolicy;
use mlearn_runtime::{Runtime, RuntimeExecutor};
use std::{path::Path, sync::{Arc, atomic::{AtomicU64,Ordering}}};
uniffi::setup_scaffolding!();
include!(concat!(env!("OUT_DIR"), "/bundled.rs"));

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum BridgeError {
    // `message` conflicts with Throwable.message in generated Kotlin exceptions.
    #[error("{reason}")]
    Initialization { reason: String },
}

#[derive(uniffi::Object)]
pub struct RuntimeBridge { runtime: RuntimeExecutor, cancellation: Arc<AtomicU64> }

#[uniffi::export]
impl RuntimeBridge {
    #[uniffi::constructor]
    pub fn new(profile_path: String) -> Result<Arc<Self>, BridgeError> {
        let plugins = bundled_plugins().map_err(|reason| BridgeError::Initialization { reason })?;
        let runtime = Runtime::open(Path::new(&profile_path), CodePolicy::MobileBundled, None, plugins).map_err(|reason| BridgeError::Initialization { reason })?;
        let cancellation=runtime.cancellation_handle();
        Ok(Arc::new(Self { runtime: RuntimeExecutor::new(runtime), cancellation }))
    }
    pub fn cancel_source_open(&self) { self.cancellation.fetch_add(1,Ordering::Relaxed); }
    /// Native host invokes on a background queue. A busy request never creates an unbounded queue.
    pub fn execute(&self, request: String) -> String {
        self.runtime.execute(&request)
    }
}
