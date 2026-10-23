//! Host-only package stages. No model bytes, host paths or tensor ABI enter guests.
use crate::{RuntimeExecutor, execution::Cancellation};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OcrPackageProfile {
    pub provider_id: String,
    pub profile_id: String,
    pub label: String,
    pub languages: Vec<String>,
    pub scripts: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPackageBinding {
    pub package_id: String,
    pub package_revision: String,
    pub profile: OcrPackageProfile,
}
impl RuntimeExecutor {
    pub fn ocr_source_package(&self, source: &str) -> Result<(String, String), String> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "Native runtime lock poisoned")?;
        let record = runtime.document_record(source).map_err(|e| e.to_string())?;
        let package = runtime
            .installed
            .get(&record.package_id)
            .ok_or("Source language package unavailable")?;
        Ok((
            record.package_id,
            package.revision().map_err(|e| e.to_string())?,
        ))
    }
    pub fn complete_native_ocr(
        &self,
        source: &str,
        binding: Option<&OcrPackageBinding>,
        result: &mlearn_core::OcrNativeResult,
    ) -> Result<String, String> {
        let _permit = self.admit().map_err(|e| e.to_string())?;
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Native runtime lock poisoned")?;
        if let Some(binding) = binding {
            let record = runtime.document_record(source).map_err(|e| e.to_string())?;
            let package = runtime
                .installed
                .get(&record.package_id)
                .ok_or("Source language package removed")?;
            if record.package_id != binding.package_id
                || package.revision().map_err(|e| e.to_string())? != binding.package_revision
            {
                return Err("Source language package changed during native OCR; retry".into());
            }
        }
        Ok(
            runtime
                .execute(&serde_json::json!({"type":"complete_ocr","result":result}).to_string()),
        )
    }
    pub fn ocr_package_profiles(&self) -> Result<Vec<OcrPackageBinding>, String> {
        let _permit = self.admit().map_err(|e| e.to_string())?;
        let _guest = self
            .guest
            .try_lock()
            .map_err(|_| "Language execution is busy")?;
        let packages = self
            .runtime
            .lock()
            .map_err(|_| "Native runtime lock poisoned")?
            .installed
            .values()
            .filter(|p| {
                p.manifest
                    .capabilities
                    .iter()
                    .any(|c| c == "image.ocr.profile.v1")
            })
            .cloned()
            .collect::<Vec<_>>();
        let mut bindings = Vec::new();
        for package in packages {
            let value = Cancellation::durable()
                .invoke(&package, "image.ocr.profile.v1", serde_json::json!({}))
                .map_err(|e| e.to_string())?;
            let profile: OcrPackageProfile =
                serde_json::from_value(value).map_err(|e| e.to_string())?;
            bindings.push(OcrPackageBinding {
                package_id: package.manifest.id.clone(),
                package_revision: package.revision().map_err(|e| e.to_string())?,
                profile,
            });
        }
        Ok(bindings)
    }
    pub fn ocr_source_stage(
        &self,
        source: &str,
        capability: &str,
        input: Value,
        epoch: std::sync::Arc<std::sync::atomic::AtomicU64>,
    ) -> Result<Value, String> {
        if !matches!(
            capability,
            "image.ocr.profile.v1" | "image.ocr.geometry.v1" | "image.ocr.recognition.v1"
        ) {
            return Err("Not a host OCR package stage".into());
        }
        if serde_json::to_vec(&input).map_err(|e| e.to_string())?.len() > 192 * 1024 {
            return Err("OCR package stage exceeds bounded input".into());
        }
        let cancellation = Cancellation::source(epoch, 0);
        cancellation.check().map_err(|e| e.to_string())?;
        let _permit = self.admit().map_err(|e| e.to_string())?;
        let _guest = self
            .guest
            .try_lock()
            .map_err(|_| "Language execution is busy")?;
        let package = {
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| "Native runtime lock poisoned")?;
            let record = runtime.document_record(source).map_err(|e| e.to_string())?;
            runtime
                .installed
                .get(&record.package_id)
                .cloned()
                .ok_or("Source language package unavailable")?
        };
        let value = cancellation
            .invoke(&package, capability, input)
            .map_err(|e| e.to_string())?;
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "Native runtime lock poisoned")?;
        let record = runtime.document_record(source).map_err(|e| e.to_string())?;
        let current = runtime
            .installed
            .get(&record.package_id)
            .ok_or("Source language package removed")?;
        if current.revision().map_err(|e| e.to_string())?
            != package.revision().map_err(|e| e.to_string())?
        {
            return Err("Source language package changed during OCR".into());
        }
        Ok(value)
    }
}
