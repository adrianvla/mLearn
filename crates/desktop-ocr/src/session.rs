use ort::{
    execution_providers::{ExecutionProvider, ExecutionProviderDispatch},
    session::{Session, SessionInputValue},
    value::DynValue,
};
use serde::Serialize;
use std::{borrow::Cow, collections::BTreeMap, path::Path};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backend {
    /// A registered provider is not a claim that every graph node used it.
    pub registered_provider: String,
    pub fallback_reason: Option<String>,
}

pub fn initialize(library: &Path) -> Result<(), String> {
    if !library.is_absolute() || !library.is_file() {
        return Err("Authenticated ONNX Runtime library is unavailable".into());
    }
    ort::init_from(library.to_string_lossy())
        .with_name("mlearn-desktop-ocr")
        .with_telemetry(false)
        .commit()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn accelerator() -> Result<Option<(String, ExecutionProviderDispatch)>, String> {
    #[cfg(target_os = "macos")]
    let providers = [ort::execution_providers::CoreMLExecutionProvider::default().build()];
    #[cfg(target_os = "windows")]
    let providers = [ort::execution_providers::DirectMLExecutionProvider::default().build()];
    #[cfg(target_os = "linux")]
    let providers = [
        ort::execution_providers::CUDAExecutionProvider::default().build(),
        ort::execution_providers::ROCmExecutionProvider::default().build(),
    ];
    // Use the executing library's inventory, not the Cargo target as proof.
    #[cfg(target_os = "macos")]
    let available = ort::execution_providers::CoreMLExecutionProvider::default().is_available();
    #[cfg(target_os = "windows")]
    let available = ort::execution_providers::DirectMLExecutionProvider::default().is_available();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let name = if cfg!(target_os = "macos") {
            "CoreMLExecutionProvider"
        } else {
            "DmlExecutionProvider"
        };
        Ok(available
            .map_err(|error| error.to_string())?
            .then(|| (name.to_owned(), providers[0].clone().error_on_failure())))
    }
    #[cfg(target_os = "linux")]
    {
        for (index, provider) in [
            &ort::execution_providers::CUDAExecutionProvider::default() as &dyn ExecutionProvider,
            &ort::execution_providers::ROCmExecutionProvider::default() as &dyn ExecutionProvider,
        ]
        .into_iter()
        .enumerate()
        {
            if provider.is_available().map_err(|error| error.to_string())? {
                return Ok(Some((
                    provider.name().into(),
                    providers[index].clone().error_on_failure(),
                )));
            }
        }
        Ok(None)
    }
}

fn build(
    path: &Path,
    provider: Option<ExecutionProviderDispatch>,
    profile: Option<&Path>,
) -> Result<Session, String> {
    let mut builder = Session::builder()
        .and_then(|builder| builder.with_intra_threads(2))
        .and_then(|builder| builder.with_inter_threads(1))
        .and_then(|builder| builder.with_parallel_execution(false))
        .and_then(|builder| builder.with_memory_pattern(false))
        .map_err(|error| error.to_string())?;
    if let Some(provider) = provider {
        builder = builder
            .with_execution_providers([provider])
            .map_err(|error| error.to_string())?;
    }
    if let Some(profile) = profile {
        builder = builder
            .with_profiling(profile)
            .map_err(|error| error.to_string())?;
    }
    builder
        .commit_from_file(path)
        .map_err(|error| error.to_string())
}

pub struct Graph {
    session: Option<Session>,
    path: std::path::PathBuf,
    profile: Option<std::path::PathBuf>,
    pub backend: Backend,
}

impl Graph {
    pub fn open(path: &Path, cpu_only: bool) -> Result<Self, String> {
        Self::open_profiled(path, cpu_only, None)
    }

    pub fn open_profiled(
        path: &Path,
        cpu_only: bool,
        profile: Option<&Path>,
    ) -> Result<Self, String> {
        if !path.is_absolute() || !path.is_file() {
            return Err("Authenticated ONNX model is unavailable".into());
        }
        let selected = if cpu_only { Ok(None) } else { accelerator() };
        let (session, backend) = match selected {
            Ok(Some((name, provider))) => match build(path, Some(provider), profile) {
                Ok(session) => (
                    session,
                    Backend {
                        registered_provider: name,
                        fallback_reason: None,
                    },
                ),
                Err(reason) => (
                    build(path, None, profile)?,
                    Backend {
                        registered_provider: "CPUExecutionProvider".into(),
                        fallback_reason: Some(reason),
                    },
                ),
            },
            Ok(None) => (
                build(path, None, profile)?,
                Backend {
                    registered_provider: "CPUExecutionProvider".into(),
                    fallback_reason: None,
                },
            ),
            Err(reason) => (
                build(path, None, profile)?,
                Backend {
                    registered_provider: "CPUExecutionProvider".into(),
                    fallback_reason: Some(reason),
                },
            ),
        };
        Ok(Self {
            session: Some(session),
            path: path.into(),
            profile: profile.map(Path::to_owned),
            backend,
        })
    }

    pub fn finish_profiling(&mut self) -> Result<String, String> {
        if self.profile.is_none() {
            return Err("ONNX profiling was not enabled".into());
        }
        self.session
            .as_mut()
            .ok_or("ONNX session is unloaded")?
            .end_profiling()
            .map_err(|error| error.to_string())
    }

    pub fn schema(&self) -> Result<serde_json::Value, String> {
        let session = self.session.as_ref().ok_or("ONNX session is unloaded")?;
        Ok(serde_json::json!({
            "inputs": session.inputs.iter().map(|input| serde_json::json!({
                "name": input.name, "type": input.input_type.to_string(),
            })).collect::<Vec<_>>(),
            "outputs": session.outputs.iter().map(|output| serde_json::json!({
                "name": output.name, "type": output.output_type.to_string(),
            })).collect::<Vec<_>>(),
        }))
    }

    pub fn metadata(&self, key: &str) -> Result<Option<String>, String> {
        self.session
            .as_ref()
            .ok_or("ONNX session is unloaded")?
            .metadata()
            .and_then(|metadata| metadata.custom(key))
            .map_err(|error| error.to_string())
    }

    /// Owned output tensors outlive the temporary name table, not the worker.
    /// Retain only the bounded encoder output and the current decode step.
    pub fn run(
        &mut self,
        inputs: Vec<(String, DynValue)>,
    ) -> Result<BTreeMap<String, DynValue>, String> {
        self.run_inputs(
            inputs
                .into_iter()
                .map(|(name, value)| (name, value.into()))
                .collect(),
        )
    }

    pub fn run_inputs(
        &mut self,
        inputs: Vec<(String, SessionInputValue<'_>)>,
    ) -> Result<BTreeMap<String, DynValue>, String> {
        fn run(
            session: &mut Session,
            inputs: &[(String, SessionInputValue<'_>)],
        ) -> Result<BTreeMap<String, DynValue>, String> {
            let values: Vec<(Cow<'_, str>, SessionInputValue<'_>)> = inputs
                .iter()
                .map(|(name, value)| (Cow::Borrowed(name.as_str()), value.view().into()))
                .collect();
            session
                .run(values)
                .map(|outputs| {
                    outputs
                        .into_iter()
                        .map(|(name, value)| (name.to_owned(), value))
                        .collect()
                })
                .map_err(|error| error.to_string())
        }
        match run(
            self.session.as_mut().ok_or("ONNX session is unloaded")?,
            &inputs,
        ) {
            Ok(outputs) => Ok(outputs),
            Err(reason) if self.backend.registered_provider != "CPUExecutionProvider" => {
                // An installed EP can still reject an operator or fail at run
                // time. Retry this same graph/input once on CPU, never another
                // recognizer, and report the reason with the stage metrics.
                drop(self.session.take());
                self.session = Some(build(&self.path, None, self.profile.as_deref())?);
                self.backend = Backend {
                    registered_provider: "CPUExecutionProvider".into(),
                    fallback_reason: Some(reason),
                };
                run(
                    self.session.as_mut().ok_or("ONNX session is unloaded")?,
                    &inputs,
                )
            }
            Err(error) => Err(error),
        }
    }
}
