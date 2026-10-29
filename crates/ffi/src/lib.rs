use mlearn_language_host::CodePolicy;
use mlearn_runtime::{BoundedReadError, Runtime, RuntimeExecutor};
use std::{path::Path, sync::Arc};
uniffi::setup_scaffolding!();
include!(concat!(env!("OUT_DIR"), "/bundled.rs"));

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum BridgeError {
    // `message` conflicts with Throwable.message in generated Kotlin exceptions.
    #[error("{reason}")]
    Initialization { reason: String },
    #[error("{reason}")]
    BoundedRead { code: String, reason: String },
}

impl From<BoundedReadError> for BridgeError {
    fn from(error: BoundedReadError) -> Self {
        Self::BoundedRead {
            code: error.code().into(),
            reason: error.to_string(),
        }
    }
}

#[derive(uniffi::Object)]
pub struct RuntimeBridge {
    runtime: RuntimeExecutor,
}

#[uniffi::export]
impl RuntimeBridge {
    #[uniffi::constructor]
    pub fn new(profile_path: String) -> Result<Arc<Self>, BridgeError> {
        let plugins = bundled_plugins().map_err(|reason| BridgeError::Initialization { reason })?;
        let runtime = Runtime::open(
            Path::new(&profile_path),
            CodePolicy::MobileBundled,
            None,
            plugins,
        )
        .map_err(|reason| BridgeError::Initialization { reason })?;
        Ok(Arc::new(Self {
            runtime: RuntimeExecutor::new(runtime),
        }))
    }
    pub fn cancel_source_open(&self) {
        self.runtime.cancel_source_open();
    }
    pub fn begin_bounded_read(&self) -> Result<String, BridgeError> {
        self.runtime.begin_bounded_read().map_err(Into::into)
    }
    pub fn execute_bounded_read(&self, id: String, request: String) -> String {
        self.runtime.execute_bounded_read(&id, &request)
    }
    pub fn cancel_bounded_read(&self, id: String) -> Result<(), BridgeError> {
        self.runtime.cancel_bounded_read(&id).map_err(Into::into)
    }
    /// Native host invokes on a background queue. A busy request never creates an unbounded queue.
    pub fn execute(&self, request: String) -> String {
        self.runtime.execute(&request)
    }
}
