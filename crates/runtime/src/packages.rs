use crate::{
    Installed,
    catalog::{self, Artifact, CatalogClient, Manifest},
    execution::Cancellation,
    guest::{LanguageAction, LanguageWork},
};
use mlearn_language_host::{AssetMap, CompiledPlugin, Resource, Resources};
use std::{path::Path, sync::Arc};
use mlearn_core::{PackageInstallCommand, PackageInstallPhase, PackageInstallStatus, PluginSummary, Response};
use crate::execution::Failure;
use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};

#[derive(Default)]
pub(super) struct InstallOwner {
    current: Mutex<Option<Arc<InstallEntry>>>,
    legacy_sequence: AtomicU64,
}
struct InstallEntry {
    record: Mutex<InstallRecord>,
    epoch: Arc<AtomicU64>,
    cancelled: tokio::sync::watch::Sender<bool>,
}
struct InstallRecord {
    status: PackageInstallStatus,
    active: bool,
    plugin: Option<PluginSummary>,
}
pub(super) struct InstallTransfer { entry: Arc<InstallEntry> }
pub(super) enum InstallStart { Started(InstallTransfer), Replay(Box<Response>) }

impl InstallOwner {
    pub fn current_status(&self) -> Result<Response, Failure> {
        let current = self.current.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?;
        let status = current.as_ref().map(|entry| entry.record.lock()
            .map(|record| record.status.clone())
            .map_err(|_| Failure::Operation("Package install lock poisoned".into()))).transpose()?;
        Ok(Response::PackageInstallStatus { status })
    }
    pub fn legacy_command(&self, plugin_id: String) -> PackageInstallCommand {
        PackageInstallCommand { plugin_id, command_id: format!("native:{}", self.legacy_sequence.fetch_add(1, Ordering::Relaxed)) }
    }
    pub fn begin(&self, command: PackageInstallCommand) -> Result<InstallStart, Failure> {
        if command.command_id.is_empty() || command.command_id.len() > 128 || command.plugin_id.is_empty() || command.plugin_id.len() > 128 {
            return Err(Failure::Operation("Invalid install command identity".into()));
        }
        let mut current = self.current.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?;
        if let Some(entry) = current.as_ref() {
            let record = entry.record.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?;
            if record.status.command.command_id == command.command_id {
                if record.status.command.plugin_id != command.plugin_id {
                    return Err(Failure::Operation("Command identity reused for different contents".into()));
                }
                if record.active { return Err(Failure::Busy); }
                return match record.status.phase {
                    PackageInstallPhase::Succeeded => Ok(InstallStart::Replay(Box::new(Response::Installed { plugin: record.plugin.clone().ok_or_else(|| Failure::Operation("Missing installation receipt".into()))? }))),
                    PackageInstallPhase::Cancelled => Err(Failure::Protocol("cancelled", "Package installation cancelled".into())),
                    PackageInstallPhase::Failed => Err(Failure::Operation(record.status.message.clone().unwrap_or_default())),
                    PackageInstallPhase::Downloading | PackageInstallPhase::Validating => Err(Failure::Busy),
                };
            }
            if record.active { return Err(Failure::Busy); }
        }
        let entry = Arc::new(InstallEntry {
            record: Mutex::new(InstallRecord {
                status: PackageInstallStatus { command, phase: PackageInstallPhase::Downloading, downloaded_bytes: 0, total_bytes: None, message: None },
                active: true, plugin: None,
            }),
            epoch: Arc::new(AtomicU64::new(0)),
            cancelled: tokio::sync::watch::channel(false).0,
        });
        *current = Some(entry.clone());
        Ok(InstallStart::Started(InstallTransfer { entry }))
    }
    pub fn status(&self, command_id: &str, cancel: bool) -> Result<Response, Failure> {
        let current = self.current.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?;
        let status = if let Some(entry) = current.as_ref() {
            let record = entry.record.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?;
            if record.status.command.command_id == command_id {
                if cancel && record.active {
                    entry.epoch.store(1, Ordering::Relaxed);
                    entry.cancelled.send_replace(true);
                }
                Some(record.status.clone())
            } else { None }
        } else { None };
        Ok(Response::PackageInstallStatus { status })
    }
}
impl InstallTransfer {
    pub fn command(&self) -> Result<PackageInstallCommand, Failure> {
        Ok(self.entry.record.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?.status.command.clone())
    }
    pub fn check(&self) -> Result<(), String> {
        if *self.entry.cancelled.borrow() { Err("Package installation cancelled".into()) } else { Ok(()) }
    }
    pub async fn cancelled(&self) {
        let mut receiver = self.entry.cancelled.subscribe();
        // wait_for observes the current value as well as future sends: cancellation
        // before subscription cannot be lost.
        let _cancelled = receiver.wait_for(|value| *value).await;
    }
    pub fn cancellation(&self) -> Cancellation { Cancellation::source(self.entry.epoch.clone(), 0) }
    pub fn total(&self, manifest: &Manifest) -> Result<(), String> {
        let total = manifest.assets.values().try_fold(manifest.code.byte_length, |sum, artifact| sum.checked_add(artifact.byte_length).ok_or("Package size overflow"))?;
        self.total_bytes(total)
    }
    pub fn total_bytes(&self, total: usize) -> Result<(), String> {
        self.check()?;
        self.entry.record.lock().map_err(|_| "Package install lock poisoned")?.status.total_bytes = Some(u32::try_from(total).map_err(|_| "Package size overflow")?);
        Ok(())
    }
    pub fn progress(&self, bytes: usize) -> Result<(), String> {
        self.check()?;
        let mut record = self.entry.record.lock().map_err(|_| "Package install lock poisoned")?;
        let next = record.status.downloaded_bytes.checked_add(u32::try_from(bytes).map_err(|_| "Package size overflow")?).ok_or("Package size overflow")?;
        if record.status.total_bytes.is_none_or(|total| next > total) { return Err("Package exceeds authenticated size".into()); }
        record.status.downloaded_bytes = next;
        Ok(())
    }
    pub fn validating(&self) -> Result<(), String> {
        self.check()?;
        self.entry.record.lock().map_err(|_| "Package install lock poisoned")?.status.phase = PackageInstallPhase::Validating;
        Ok(())
    }
    pub fn commit(&self, activate: impl FnOnce() -> Result<(Response, Option<Installed>), Failure>) -> Result<(Response, Option<Installed>), Failure> {
        // The same lock serializes cancellation and activation; a cancellation
        // acknowledged first cannot publish a guest or replace the installed owner.
        let mut record = self.entry.record.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?;
        self.check()?;
        let result = activate()?;
        if let Response::Installed { plugin } = &result.0 { record.plugin = Some(plugin.clone()); }
        record.status.phase = PackageInstallPhase::Succeeded;
        record.active = false;
        Ok(result)
    }
    pub fn finish(&self, result: Result<Response, Failure>) -> Result<Response, Failure> {
        match result {
            Ok(response) => Ok(response),
            Err(error) => {
                let mut record = self.entry.record.lock().map_err(|_| Failure::Operation("Package install lock poisoned".into()))?;
                let cancelled = self.check().is_err();
                record.status.phase = if cancelled { PackageInstallPhase::Cancelled } else { PackageInstallPhase::Failed };
                record.status.message = Some(error.to_string().chars().take(2048).collect());
                record.active = false;
                if cancelled { Err(Failure::Protocol("cancelled", "Package installation cancelled".into())) } else { Err(error) }
            }
        }
    }
}
impl Drop for InstallTransfer {
    fn drop(&mut self) {
        match self.entry.record.lock() {
            Ok(mut record) if record.active => {
                record.active = false;
                record.status.phase = if *self.entry.cancelled.borrow() { PackageInstallPhase::Cancelled } else { PackageInstallPhase::Failed };
                record.status.message = Some("Package installation interrupted before activation".into());
            }
            Ok(_) => {}
            Err(error) => eprintln!("Package install cleanup: {error}"),
        }
    }
}

pub(super) fn compile(root: &Path, manifest: &Manifest, code: &[u8]) -> Result<CompiledPlugin, String> {
    let mut assets = AssetMap::new();
    let mut resources = Resources::new();
    for (key, artifact) in &manifest.assets {
        if let Some(kind) = manifest.resource_kind(key) {
            resources.insert(key.clone(), Resource::open(&root.join("plugin-blobs").join(&artifact.sha256), artifact.byte_length, &artifact.sha256, kind)?);
        } else {
            assets.insert(key.clone(), Arc::from(read_blob(root, artifact)?));
        }
    }
    CompiledPlugin::with_verified_resources(code, assets, resources, manifest.execution)
}
pub(super) fn read_blob(root: &Path, artifact: &Artifact) -> Result<Vec<u8>, String> {
    let path = root.join("plugin-blobs").join(&artifact.sha256);
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() != artifact.byte_length as u64 { return Err("Installed plugin blob has changed".into()); }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    catalog::verify_artifact(artifact, &bytes)?;
    Ok(bytes)
}
pub(super) fn write_blob(root: &Path, artifact: &Artifact, bytes: &[u8]) -> Result<(), String> {
    catalog::verify_artifact(artifact, bytes)?;
    let directory = root.join("plugin-blobs");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(&artifact.sha256);
    if path.exists() {
        catalog::copy_artifact(artifact, &mut std::fs::File::open(&path).map_err(|e| e.to_string())?, &mut std::io::sink())?;
        return Ok(());
    }
    let temporary = directory.join(format!("{}.part", artifact.sha256));
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(temporary, path).map_err(|e| e.to_string())
}
/// Downloads and compilation have no Runtime/storage access. Activation is a separate commit.
pub(super) fn install(root: &Path, catalog: &CatalogClient, id: &str, transfer: &InstallTransfer) -> Result<Installed, String> {
    let manifest = catalog.install_manifests(transfer)?.into_iter().find(|m| m.id == id).ok_or("Plugin is not in the trusted catalog")?;
    transfer.total(&manifest)?;
    let mut code = Vec::new();
    catalog.install_download(&manifest.code, &mut code, transfer)?;
    for artifact in manifest.assets.values() {
        let directory = root.join("plugin-blobs");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut temporary = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
        catalog.install_download(artifact, &mut temporary, transfer)?;
        transfer.check()?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary.persist(directory.join(&artifact.sha256)).map_err(|e| e.to_string())?;
    }
    transfer.validating()?;
    let compiled = Arc::new(compile(root, &manifest, &code)?);
    transfer.check()?;
    compiled.validate()?;
    transfer.check()?;
    let installed = Installed { manifest, compiled };
    if installed
        .manifest
        .capabilities
        .iter()
        .any(|c| c == "language.describe.v1")
    {
        LanguageWork {
            package: installed.clone(),
            cancellation: transfer.cancellation(),
            action: LanguageAction::Describe,
        }
        .description()
        .map_err(|e| e.to_string())?;
    }
    transfer.check()?;
    write_blob(root, &installed.manifest.code, &code)?;
    transfer.check()?;
    Ok(installed)
}
