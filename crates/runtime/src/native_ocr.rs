//! Desktop-only authenticated native OCR artifacts. These never enter Wasmi.
use crate::{
    catalog::{Artifact, CatalogClient, CatalogTrust, copy_artifact, copy_content, signed_payload},
    packages::{InstallOwner, InstallStart, InstallTransfer},
};
use mlearn_core::{PackageInstallPhase, PluginSummary, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeOcrProfile {
    pub id: String,
    pub label: String,
    pub target: String,
    pub executor: String,
    pub runtime: Artifact,
    pub models: Artifact,
    pub runtime_index_sha256: String,
    pub models_index_sha256: String,
}
impl NativeOcrProfile {
    pub fn revision(&self) -> Result<String, String> {
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(self).map_err(|e| e.to_string())?)
        ))
    }
    fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 128
            || !self
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            || self.label.is_empty()
            || self.label.len() > 128
            || self.target != format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
            || !matches!(
                self.executor.as_str(),
                "paddle-manga-onnx-v1" | "paddle-ctc-onnx-v1"
            )
        {
            return Err("Unsupported native OCR profile identity/target/executor".into());
        }
        for digest in [&self.runtime_index_sha256, &self.models_index_sha256] {
            if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Invalid native OCR inventory digest".into());
            }
        }
        for artifact in [&self.runtime, &self.models] {
            if artifact.byte_length == 0 || artifact.byte_length > 2 * 1024 * 1024 * 1024 {
                return Err("Native OCR archive exceeds its separate 2 GiB budget".into());
            }
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    schema_version: u32,
    expires_at: u64,
    #[serde(default)]
    native_ocr: Vec<NativeOcrProfile>,
}
fn profiles(bytes: &[u8], key: &str, now: u64) -> Result<Vec<NativeOcrProfile>, String> {
    let catalog: Catalog =
        serde_json::from_slice(&signed_payload(bytes, key)?).map_err(|e| e.to_string())?;
    if catalog.schema_version != 1 || catalog.expires_at <= now || catalog.native_ocr.len() > 8 {
        return Err("Native OCR catalog expired or unsupported".into());
    }
    let mut seen = BTreeSet::new();
    for profile in &catalog.native_ocr {
        profile.validate()?;
        if !seen.insert(&profile.id) {
            return Err("Duplicate native OCR profile".into());
        }
    }
    Ok(catalog.native_ocr)
}

#[derive(Clone)]
pub struct NativeOcrInstallation {
    pub profile: NativeOcrProfile,
    pub directory: PathBuf,
}
/// The signed runtime archive uses one stable filename per actual host target.
pub fn native_ocr_library() -> &'static str {
    if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOcrModelState {
    pub profile: NativeOcrProfile,
    pub profile_revision: String,
    pub installed: bool,
    pub installed_revision: Option<String>,
    pub reason: Option<String>,
}
pub struct NativeOcrModels {
    root: PathBuf,
    trust: Option<CatalogTrust>,
    installs: InstallOwner,
    // At most one verified installed resource lease per host. The Rust worker
    // retains its lease while model sessions are warm, through final reap.
    snapshot: Mutex<Option<Arc<Snapshot>>>,
    mutations: Mutex<()>,
}
struct Snapshot {
    installation: NativeOcrInstallation,
}
#[derive(Clone)]
pub struct NativeOcrLease(Arc<Snapshot>);
impl NativeOcrLease {
    pub fn installation(&self) -> &NativeOcrInstallation {
        &self.0.installation
    }
}
impl NativeOcrModels {
    pub fn new(root: &Path, trust: Option<CatalogTrust>) -> Result<Self, String> {
        let root = fs::canonicalize(root)
            .map_err(|e| e.to_string())?
            .join("native-ocr");
        let owner = Self {
            root,
            trust,
            installs: InstallOwner::default(),
            snapshot: Mutex::new(None),
            mutations: Mutex::new(()),
        };
        if let Err(error) = owner.recover_activation() {
            // Optional native assets must not make Reader/Watch/profile startup
            // fail. Admission/install reports the resource problem locally.
            eprintln!("Native OCR activation recovery unavailable: {error}");
        }
        Ok(owner)
    }
    fn recover_activation(&self) -> Result<(), String> {
        if !self.root.exists() {
            return Ok(());
        }
        // A crash between the two activation renames must not strand the prior
        // usable install. Never activate an unsigned staging directory.
        for (count, entry) in fs::read_dir(&self.root)
            .map_err(|e| e.to_string())?
            .enumerate()
        {
            if count >= 64 {
                return Err("Native model directory exceeds its bounded inventory".into());
            }
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let Some(id) = name
                .to_str()
                .and_then(|s| s.strip_prefix('.'))
                .and_then(|s| s.strip_suffix("-previous"))
            else {
                continue;
            };
            if self.root.join(id).exists() {
                continue;
            }
            native_profile_id(id)?;
            let bytes = bounded_file(&entry.path().join("receipt.json"), 512 * 1024)?;
            let public = &self
                .trust
                .as_ref()
                .ok_or("No publisher trust for native model recovery")?
                .public_key;
            if !profiles(&bytes, public, 0)?.iter().any(|p| p.id == id) {
                return Err("Native model recovery identity mismatch".into());
            }
            fs::rename(entry.path(), self.root.join(id)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    fn client(&self) -> Result<CatalogClient, String> {
        let mut trust = self
            .trust
            .clone()
            .ok_or("No authenticated desktop model catalog configured")?;
        trust.url = reqwest::Url::parse(&trust.url)
            .map_err(|e| e.to_string())?
            .join("ocr-catalog.json")
            .map_err(|e| e.to_string())?
            .into();
        CatalogClient::new(trust)
    }
    fn installed_profile(&self, id: &str) -> Result<NativeOcrProfile, String> {
        native_profile_id(id)?;
        let path = self.root.join(id).join("receipt.json");
        let bytes = bounded_file(&path, 512 * 1024)?;
        // Installed working artifacts remain usable after catalog expiry/offline.
        // Their original publisher signature is still checked at every restore.
        let profile = profiles(
            &bytes,
            &self
                .trust
                .as_ref()
                .ok_or("No model publisher trust")?
                .public_key,
            0,
        )?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("Native model receipt does not contain its identity")?;
        for required in [
            format!("runtime/{}", native_ocr_library()),
            "runtime-index.json".into(),
            "models-index.json".into(),
            "models/profile.json".into(),
        ] {
            if !self.root.join(id).join(required).is_file() {
                return Err("Native OCR installation is incomplete; reinstall its authenticated runtime/models".into());
            }
        }
        Ok(profile)
    }
    pub fn list(&self) -> Result<Vec<NativeOcrModelState>, String> {
        let client = self.client()?;
        let bytes = client.native_catalog(None)?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        profiles(
            &bytes,
            &self.trust.as_ref().ok_or("No model trust")?.public_key,
            now,
        )?
        .into_iter()
        .map(|profile| {
            let (installed_revision, reason) = match self.installed_profile(&profile.id) {
                Ok(installed) => (Some(installed.revision()?), None),
                Err(reason) => (None, Some(reason)),
            };
            Ok(NativeOcrModelState {
                profile_revision: profile.revision()?,
                installed: installed_revision.is_some(),
                installed_revision,
                reason,
                profile,
            })
        })
        .collect::<Result<Vec<_>, String>>()
    }
    pub fn inventory(&self) -> Result<(Vec<NativeOcrModelState>, Option<String>), String> {
        match self.list() {
            Ok(models) => Ok((models, None)),
            Err(reason) => {
                let mut models = Vec::new();
                let entries = match fs::read_dir(&self.root) {
                    Ok(entries) => entries,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        return Ok((models, Some(reason)));
                    }
                    Err(error) => return Err(error.to_string()),
                };
                for (count, entry) in entries.enumerate() {
                    if count >= 64 {
                        return Err("Native model directory exceeds its bounded inventory".into());
                    }
                    let entry = entry.map_err(|e| e.to_string())?;
                    let name = entry.file_name();
                    let Some(id) = name.to_str().filter(|s| !s.starts_with('.')) else {
                        continue;
                    };
                    if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                        models.push(NativeOcrModelState {
                            profile_revision: self.installed_profile(id)?.revision()?,
                            installed_revision: Some(self.installed_profile(id)?.revision()?),
                            profile: self.installed_profile(id)?,
                            installed: true,
                            reason: None,
                        });
                    }
                }
                Ok((models, Some(reason)))
            }
        }
    }
    pub fn status(&self) -> Result<Response, String> {
        self.installs.current_status().map_err(|e| e.to_string())
    }
    pub fn cancel_install(&self) -> Result<Response, String> {
        let Response::PackageInstallStatus { status } = self.status()? else {
            return Err("Invalid install status".into());
        };
        match status {
            Some(status) => self
                .installs
                .status(&status.command.command_id, true)
                .map_err(|e| e.to_string()),
            None => Ok(Response::PackageInstallStatus { status: None }),
        }
    }
    pub fn install(&self, id: &str) -> Result<(), String> {
        native_profile_id(id)?;
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let _mutation = self
            .mutations
            .try_lock()
            .map_err(|_| "Native model installation/removal is busy")?;
        let command = self.installs.legacy_command(id.into());
        let transfer = match self.installs.begin(command).map_err(|e| e.to_string())? {
            InstallStart::Started(transfer) => transfer,
            InstallStart::Replay(_) => return Err("Unexpected model install replay".into()),
        };
        let outcome = (|| {
            let client = self.client()?;
            let receipt = client.native_catalog(Some(&transfer))?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_secs();
            let profile = profiles(
                &receipt,
                &self.trust.as_ref().ok_or("No model trust")?.public_key,
                now,
            )?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or("Native OCR profile is absent from authenticated catalog")?;
            transfer.total_bytes(
                profile
                    .runtime
                    .byte_length
                    .checked_add(profile.models.byte_length)
                    .ok_or("Native model size overflow")?,
            )?;
            let staging = tempfile::Builder::new()
                .prefix(".install-")
                .tempdir_in(&self.root)
                .map_err(|e| e.to_string())?;
            for (name, artifact) in [
                ("runtime.zip", &profile.runtime),
                ("models.zip", &profile.models),
            ] {
                let mut file =
                    File::create(staging.path().join(name)).map_err(|e| e.to_string())?;
                client.native_download(artifact, &mut file, &transfer)?;
                file.sync_all().map_err(|e| e.to_string())?;
            }
            transfer.validating()?;
            // Extract once during the explicit installation, not on the first
            // page. Signed per-file inventories authenticate offline restores.
            unpack(staging.path(), staging.path(), &profile, Some(&transfer))?;
            for name in ["runtime.zip", "models.zip"] {
                fs::remove_file(staging.path().join(name)).map_err(|e| e.to_string())?;
            }
            fs::write(staging.path().join("receipt.json"), receipt).map_err(|e| e.to_string())?;
            let mut cached = self
                .snapshot
                .try_lock()
                .map_err(|_| "Native resource admission is busy")?;
            if cached.as_ref().is_some_and(|s| Arc::strong_count(s) > 1) {
                return Err("Cancel active OCR before replacing its native runtime/models".into());
            }
            transfer
                .commit(|| {
                    let destination = self.root.join(id);
                    let backup = self.root.join(format!(".{id}-previous"));
                    if backup.exists() {
                        fs::remove_dir_all(&backup).map_err(|e| e.to_string())?;
                    }
                    if destination.exists() {
                        fs::rename(&destination, &backup).map_err(|e| e.to_string())?;
                    }
                    if let Err(error) = fs::rename(staging.path(), &destination) {
                        if backup.exists() {
                            fs::rename(&backup, &destination).map_err(|e| e.to_string())?;
                        }
                        return Err(error.to_string().into());
                    }
                    if backup.exists() {
                        fs::remove_dir_all(backup).map_err(|e| e.to_string())?;
                    }
                    *cached = Some(Arc::new(Snapshot {
                        installation: NativeOcrInstallation {
                            profile: profile.clone(),
                            directory: destination,
                        },
                    }));
                    Ok((
                        Response::Installed {
                            plugin: PluginSummary {
                                id: id.into(),
                                display_name: Some(profile.label.clone()),
                                version: profile.revision()?,
                                capabilities: vec!["native.ocr.v1".into()],
                            },
                        },
                        None,
                    ))
                })
                .map(|v| v.0)
                .map_err(|e| e.to_string())
        })();
        transfer
            .finish(outcome.map_err(crate::execution::Failure::Operation))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    pub fn admit(&self, id: &str) -> Result<NativeOcrLease, String> {
        self.admit_with_cancellation(id, None)
    }
    pub fn admit_cancellable(
        &self,
        id: &str,
        cancel: &tokio::sync::watch::Receiver<bool>,
    ) -> Result<NativeOcrLease, String> {
        self.admit_with_cancellation(id, Some(cancel))
    }
    fn admit_with_cancellation(
        &self,
        id: &str,
        cancel: Option<&tokio::sync::watch::Receiver<bool>>,
    ) -> Result<NativeOcrLease, String> {
        if cancel.is_some_and(|r| *r.borrow()) {
            return Err("Native model admission cancelled".into());
        }
        let profile = self.installed_profile(id)?;
        let mut cached = self
            .snapshot
            .lock()
            .map_err(|_| "Native snapshot lock poisoned")?;
        if let Some(snapshot) = cached.as_ref()
            && snapshot.installation.profile.revision()? == profile.revision()?
        {
            return Ok(NativeOcrLease(snapshot.clone()));
        }
        if cached.as_ref().is_some_and(|s| Arc::strong_count(s) > 1) {
            return Err("A native OCR resource lease is still active".into());
        }
        let installed = self.root.join(id);
        verify_installed(&installed, &profile, cancel)?;
        let snapshot = Arc::new(Snapshot {
            installation: NativeOcrInstallation {
                profile,
                directory: installed,
            },
        });
        *cached = Some(snapshot.clone());
        Ok(NativeOcrLease(snapshot))
    }
    pub fn installed(&self, id: &str) -> Result<NativeOcrProfile, String> {
        self.installed_profile(id)
    }
    pub fn remove(&self, id: &str) -> Result<(), String> {
        native_profile_id(id)?;
        let _mutation = self
            .mutations
            .try_lock()
            .map_err(|_| "Native model installation/removal is busy")?;
        if let Response::PackageInstallStatus {
            status: Some(status),
        } = self.status()?
            && matches!(
                status.phase,
                PackageInstallPhase::Downloading | PackageInstallPhase::Validating
            )
        {
            return Err("Cancel the active model installation before removal".into());
        }
        let path = self.root.join(id);
        let mut snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "Native snapshot lock poisoned")?;
        if snapshot.as_ref().is_some_and(|s| Arc::strong_count(s) > 1) {
            return Err("Cancel active OCR before removing its native runtime/models".into());
        }
        if snapshot
            .as_ref()
            .is_some_and(|s| s.installation.profile.id == id)
        {
            *snapshot = None;
        }
        if path.exists() {
            fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
fn safe_relative(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 512
        || Path::new(value).components().count() > 32
        || Path::new(value)
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
        || value.contains('\\')
    {
        return Err("Unsafe native artifact path".into());
    }
    Ok(())
}
fn native_profile_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err("Invalid native OCR profile identity".into());
    }
    Ok(())
}
fn bounded_file(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err("Native artifact metadata must be an ordinary bounded file".into());
    }
    let mut value = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut value)
        .map_err(|e| e.to_string())?;
    if value.len() as u64 > limit {
        return Err("Native artifact metadata exceeds bound".into());
    }
    Ok(value)
}
#[derive(Deserialize)]
struct InventoryEntry {
    sha256: String,
    byte_length: usize,
}
fn verify_model_executor(installed: &Path, profile: &NativeOcrProfile) -> Result<(), String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Envelope {
        schema_version: u32,
        executor: String,
    }
    let envelope: Envelope = serde_json::from_slice(&bounded_file(
        &installed.join("models/profile.json"),
        65536,
    )?)
    .map_err(|e| e.to_string())?;
    if envelope.schema_version != 1 || envelope.executor != profile.executor {
        return Err(
            "Authenticated model executor does not match its native catalog profile".into(),
        );
    }
    Ok(())
}
struct CheckedReader<'a, R, F> {
    input: R,
    check: &'a F,
}
impl<R: Read, F: Fn() -> Result<(), String>> Read for CheckedReader<'_, R, F> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        (self.check)().map_err(std::io::Error::other)?;
        self.input.read(buffer)
    }
}
fn verify_installed(
    installed: &Path,
    profile: &NativeOcrProfile,
    cancel: Option<&tokio::sync::watch::Receiver<bool>>,
) -> Result<(), String> {
    let check = || {
        if cancel.is_some_and(|r| *r.borrow()) {
            Err("Native model admission cancelled".to_owned())
        } else {
            Ok(())
        }
    };
    for (name, digest) in [
        ("runtime", &profile.runtime_index_sha256),
        ("models", &profile.models_index_sha256),
    ] {
        check()?;
        let index = bounded_file(
            &installed.join(format!("{name}-index.json")),
            16 * 1024 * 1024,
        )?;
        if format!("{:x}", Sha256::digest(&index)) != *digest {
            return Err("Installed native inventory authentication failed".into());
        }
        let mut inventory: BTreeMap<String, InventoryEntry> =
            serde_json::from_slice(&index).map_err(|e| e.to_string())?;
        if inventory.len() > 65536 {
            return Err("Native inventory exceeds its file bound".into());
        }
        let target = installed.join(name);
        if !fs::symlink_metadata(&target)
            .map_err(|e| e.to_string())?
            .is_dir()
        {
            return Err("Native resource tree is not an ordinary directory".into());
        }
        let mut directories = vec![(target, String::new())];
        let mut entries = 0usize;
        let mut total = 0u64;
        while let Some((directory, prefix)) = directories.pop() {
            check()?;
            for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
                check()?;
                entries = entries
                    .checked_add(1)
                    .ok_or("Native entry count overflow")?;
                if entries > 131072 {
                    return Err("Native resource tree exceeds its file/directory bound".into());
                }
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name();
                let name = name.to_str().ok_or("Non-UTF8 native resource name")?;
                let key = if prefix.is_empty() {
                    name.to_owned()
                } else {
                    format!("{prefix}/{name}")
                };
                safe_relative(&key)?;
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                if kind.is_dir() {
                    directories.push((entry.path(), key));
                    continue;
                }
                if !kind.is_file() {
                    return Err("Native resources cannot contain symlinks or special files".into());
                }
                let expected = inventory
                    .remove(&key)
                    .ok_or("Unlisted executable/runtime resource; reinstall the model")?;
                total = total
                    .checked_add(
                        u64::try_from(expected.byte_length)
                            .map_err(|_| "Native resource size overflow")?,
                    )
                    .ok_or("Native resource size overflow")?;
                if total > 4 * 1024 * 1024 * 1024 {
                    return Err(
                        "Installed native resources exceed their separate byte budget".into(),
                    );
                }
                let input = File::open(entry.path()).map_err(|e| e.to_string())?;
                if input.metadata().map_err(|e| e.to_string())?.len() != expected.byte_length as u64
                {
                    return Err("Installed native resource size changed".into());
                }
                copy_content(
                    &expected.sha256,
                    expected.byte_length,
                    &mut CheckedReader {
                        input,
                        check: &check,
                    },
                    &mut std::io::sink(),
                )?;
            }
        }
        if !inventory.is_empty() {
            return Err("Installed native resources are missing; reinstall the model".into());
        }
    }
    verify_model_executor(installed, profile)
}
fn unpack(
    installed: &Path,
    destination: &Path,
    profile: &NativeOcrProfile,
    transfer: Option<&InstallTransfer>,
) -> Result<(), String> {
    unpack_cancellable(installed, destination, profile, transfer, None)
}
fn unpack_cancellable(
    installed: &Path,
    destination: &Path,
    profile: &NativeOcrProfile,
    transfer: Option<&InstallTransfer>,
    cancel: Option<&tokio::sync::watch::Receiver<bool>>,
) -> Result<(), String> {
    let check = || {
        if let Some(transfer) = transfer {
            transfer.check()?;
        }
        if cancel.is_some_and(|r| *r.borrow()) {
            return Err("Native model admission cancelled".to_owned());
        }
        Ok(())
    };
    for (name, artifact, index_hash) in [
        ("runtime", &profile.runtime, &profile.runtime_index_sha256),
        ("models", &profile.models, &profile.models_index_sha256),
    ] {
        let mut input =
            File::open(installed.join(format!("{name}.zip"))).map_err(|e| e.to_string())?;
        copy_artifact(
            artifact,
            &mut CheckedReader {
                input: &mut input,
                check: &check,
            },
            &mut std::io::sink(),
        )?;
        let mut archive = zip::ZipArchive::new(
            File::open(installed.join(format!("{name}.zip"))).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        if archive.len() > 65536 {
            return Err("Native runtime exceeds 65536 files".into());
        }
        let mut index = Vec::new();
        archive
            .by_name("inventory.json")
            .map_err(|e| e.to_string())?
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut index)
            .map_err(|e| e.to_string())?;
        if index.len() > 16 * 1024 * 1024 || format!("{:x}", Sha256::digest(&index)) != *index_hash
        {
            return Err("Native runtime inventory authentication failed".into());
        }
        let inventory: BTreeMap<String, InventoryEntry> =
            serde_json::from_slice(&index).map_err(|e| e.to_string())?;
        if archive.len() != inventory.len() + 1 {
            return Err("Native archive inventory membership mismatch".into());
        }
        fs::write(destination.join(format!("{name}-index.json")), &index)
            .map_err(|e| e.to_string())?;
        let target = destination.join(name);
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        let mut total = 0u64;
        let mut seen = BTreeSet::new();
        let mut parents = BTreeSet::new();
        for i in 0..archive.len() {
            check()?;
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            // Inventory identity uses the ZIP name, not enclosed_name's native
            // PathBuf separators (backslashes for nested files on Windows).
            let key = entry.name().map_err(|e| e.to_string())?.into_owned();
            safe_relative(&key)?;
            let path = entry.enclosed_name().ok_or("Unsafe native archive entry")?;
            if path
                .to_str()
                .ok_or("Non-UTF8 native archive path")?
                .replace('\\', "/")
                != key
            {
                return Err("Noncanonical native archive path".into());
            }
            if key == "inventory.json" {
                continue;
            }
            if !entry.is_file() || entry.is_symlink() || !seen.insert(key.clone()) {
                return Err("Native archives require unique ordinary files".into());
            }
            let expected = inventory.get(&key).ok_or("Unlisted native artifact")?;
            if entry.size() != expected.byte_length as u64 {
                return Err("Native artifact inventory size mismatch".into());
            }
            total = total
                .checked_add(entry.size())
                .ok_or("Native artifact size overflow")?;
            if total > 4 * 1024 * 1024 * 1024 {
                return Err("Native archive exceeds separate 4 GiB expanded budget".into());
            }
            let output = target.join(&path);
            for parent in path
                .ancestors()
                .skip(1)
                .filter(|p| !p.as_os_str().is_empty())
            {
                parents.insert(parent.to_owned());
                if parents.len() > 65536 {
                    return Err("Native archive exceeds its directory budget".into());
                }
            }
            fs::create_dir_all(output.parent().ok_or("Native artifact parent missing")?)
                .map_err(|e| e.to_string())?;
            let mut file = File::options()
                .write(true)
                .create_new(true)
                .open(&output)
                .map_err(|e| e.to_string())?;
            copy_content(
                &expected.sha256,
                expected.byte_length,
                &mut CheckedReader {
                    input: &mut entry,
                    check: &check,
                },
                &mut file,
            )?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                // No setuid, group/other write or archive-provided executable policy.
                let mode = if entry.unix_mode().is_some_and(|m| m & 0o111 != 0) {
                    0o500
                } else {
                    0o400
                };
                fs::set_permissions(&output, fs::Permissions::from_mode(mode))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    if !destination
        .join("runtime")
        .join(native_ocr_library())
        .is_file()
        || !destination.join("models/profile.json").is_file()
    {
        return Err(
            "Native OCR installation lacks its pinned ONNX Runtime or model profile".into(),
        );
    }
    verify_model_executor(destination, profile)
}

#[cfg(test)]
#[path = "native_ocr_tests.rs"]
mod tests;
