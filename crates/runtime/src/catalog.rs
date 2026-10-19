use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use mlearn_language_host::{ExecutionPolicy, ResourceKind};
use std::{collections::BTreeMap, io::Read, time::{Duration, SystemTime, UNIX_EPOCH}};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTrust { pub url: String, pub public_key: String }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact { pub path: String, pub sha256: String, pub byte_length: usize }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub version: String,
    pub abi_version: u32,
    pub capabilities: Vec<String>,
    pub code: Artifact,
    pub assets: BTreeMap<String, Artifact>,
    #[serde(default)]
    pub resources: BTreeMap<String, ResourceKind>,
    #[serde(default)]
    pub execution: ExecutionPolicy,
}
impl Manifest {
    pub fn resource_kind(&self, key: &str) -> Option<ResourceKind> {
        // Compatibility at the manifest boundary for already installed ABI-v1
        // English packages. New resources declare their interpretation explicitly.
        self.resources.get(key).copied().or_else(|| key.ends_with(".sqlite").then_some(ResourceKind::KeyValueSqliteV1))
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.id.len() > 128 || !self.id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) { return Err("Invalid plugin package id".into()); }
        if self.display_name.as_ref().is_some_and(|name| name.trim().is_empty() || name.len() > 256 || name.chars().any(char::is_control)) {
            return Err("Invalid package display name".into());
        }
        if self.version.is_empty() || self.version.len() > 128 || self.abi_version != 1 { return Err("Unsupported plugin version/ABI".into()); }
        if self.capabilities.is_empty() || self.capabilities.len() > 64 || self.capabilities.iter().any(|v| v.is_empty() || v.len() > 256) { return Err("Invalid capability declarations".into()); }
        if self.assets.len() > 32 || self.resources.len() > 8 || self.resources.keys().any(|k| !self.assets.contains_key(k)) { return Err("Invalid resource declarations".into()); }
        let extended = self.execution == ExecutionPolicy::PersistentV1;
        for (key, artifact) in &self.assets {
            let limit = match (self.resource_kind(key), extended) {
                (Some(ResourceKind::BytesV1 | ResourceKind::KeyValueSqliteV1), true) => 128 * 1024 * 1024,
                (Some(ResourceKind::KeyValueSqliteV1), false) => 32 * 1024 * 1024,
                (None, _) | (Some(ResourceKind::BytesV1), false) => 8 * 1024 * 1024,
            };
            if key.is_empty() || key.len() > 256 || artifact.byte_length > limit { return Err("Invalid asset declaration".into()); }
            validate_artifact(artifact)?;
        }
        let total_limit = if extended { 256 * 1024 * 1024 } else { 40 * 1024 * 1024 };
        if self.assets.values().map(|a| a.byte_length).sum::<usize>() > total_limit || self.code.byte_length > 4 * 1024 * 1024 { return Err("Plugin exceeds runtime resource budget".into()); }
        if self.execution == ExecutionPolicy::PersistentV1 && self.assets.keys().any(|k| !self.resources.contains_key(k)) {
            return Err("Persistent packages require explicit versioned resource kinds".into());
        }
        validate_artifact(&self.code)
    }
}

#[derive(Deserialize)]
struct Envelope { payload: String, signature: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog { schema_version: u32, expires_at: u64, plugins: Vec<Manifest> }

fn validate_artifact(artifact: &Artifact) -> Result<(), String> {
    if artifact.sha256.len() != 64 || !artifact.sha256.bytes().all(|b| b.is_ascii_hexdigit()) || artifact.byte_length == 0 { return Err("Invalid artifact digest/size".into()); }
    if artifact.path.is_empty() || artifact.path.starts_with('/') || artifact.path.split('/').any(|p| p.is_empty() || p == "." || p == ".." || !p.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))) { return Err("Artifact path must be a safe relative path".into()); }
    Ok(())
}

pub fn verify_artifact(artifact: &Artifact, bytes: &[u8]) -> Result<(), String> {
    validate_artifact(artifact)?;
    let actual = format!("{:x}", Sha256::digest(bytes));
    if bytes.len() != artifact.byte_length || !actual.eq_ignore_ascii_case(&artifact.sha256) { return Err("Artifact digest or size mismatch".into()); }
    Ok(())
}

pub fn copy_artifact(artifact: &Artifact, input: &mut impl Read, output: &mut impl std::io::Write) -> Result<(), String> {
    validate_artifact(artifact)?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 65536];
    let mut total = 0usize;
    loop {
        let count = input.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        total = total.checked_add(count).ok_or("Artifact size overflow")?;
        if total > artifact.byte_length { return Err("Artifact exceeds declared size".into()); }
        hash.update(&bytes[..count]);
        output.write_all(&bytes[..count]).map_err(|e| e.to_string())?;
    }
    if total != artifact.byte_length || !format!("{:x}", hash.finalize()).eq_ignore_ascii_case(&artifact.sha256) {
        return Err("Artifact digest or size mismatch".into());
    }
    Ok(())
}

pub fn verify_catalog(bytes: &[u8], key: &str, now: u64) -> Result<Vec<Manifest>, String> {
    if bytes.len() > 512 * 1024 { return Err("Catalog exceeds 512 KiB".into()); }
    let envelope: Envelope = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let payload = STANDARD.decode(envelope.payload).map_err(|e| e.to_string())?;
    let public: [u8; 32] = STANDARD.decode(key).map_err(|e| e.to_string())?.try_into().map_err(|_| "Invalid public key length")?;
    let signature = Signature::from_slice(&STANDARD.decode(envelope.signature).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    VerifyingKey::from_bytes(&public).map_err(|e| e.to_string())?.verify_strict(&payload, &signature).map_err(|_| "Catalog signature rejected")?;
    let catalog: Catalog = serde_json::from_slice(&payload).map_err(|e| e.to_string())?;
    if catalog.schema_version != 1 || catalog.expires_at <= now || catalog.plugins.len() > 64 { return Err("Catalog expired or unsupported".into()); }
    let mut seen = std::collections::BTreeSet::new();
    for manifest in &catalog.plugins {
        manifest.validate()?;
        if !seen.insert(&manifest.id) { return Err("Duplicate plugin id in catalog".into()); }
    }
    Ok(catalog.plugins)
}

pub struct CatalogClient {
    trust: CatalogTrust,
    client: reqwest::Client,
    base: reqwest::Url,
    io: std::sync::Mutex<tokio::runtime::Runtime>,
}
impl CatalogClient {
    pub fn new(trust: CatalogTrust) -> Result<Self, String> {
        let base = reqwest::Url::parse(&trust.url).map_err(|e| e.to_string())?;
        let loopback = cfg!(debug_assertions) && base.scheme() == "http" && base.host_str() == Some("127.0.0.1");
        if base.scheme() != "https" && !loopback { return Err("Catalog requires HTTPS (debug permits numeric loopback only)".into()); }
        if !base.username().is_empty() || base.password().is_some() || base.fragment().is_some() { return Err("Invalid catalog URL".into()); }
        // The current-thread reactor is parked between calls, so it cannot observe
        // an idle peer closing. Do not reuse those undriven idle connections.
        let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).pool_max_idle_per_host(0).redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
        let io = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
        Ok(Self { trust, client, base, io: std::sync::Mutex::new(io) })
    }
    async fn response(&self, url: reqwest::Url, transfer: Option<&crate::packages::InstallTransfer>) -> Result<reqwest::Response, String> {
        tokio::select! {
            biased;
            () = cancelled(transfer) => Err("Package installation cancelled".into()),
            response = self.client.get(url).send() => response.map_err(|e| e.to_string()),
        }
    }
    async fn chunk(response: &mut reqwest::Response, transfer: Option<&crate::packages::InstallTransfer>) -> Result<Option<impl AsRef<[u8]>>, String> {
        tokio::select! {
            biased;
            () = cancelled(transfer) => Err("Package installation cancelled".into()),
            chunk = response.chunk() => chunk.map_err(|e| e.to_string()),
        }
    }
    async fn get(&self, url: reqwest::Url, limit: usize, transfer: Option<&crate::packages::InstallTransfer>) -> Result<Vec<u8>, String> {
        let mut response = self.response(url, transfer).await?;
        if !response.status().is_success() || response.content_length().is_some_and(|n| n > limit as u64) { return Err("Download rejected by status/size limits".into()); }
        let mut bytes = Vec::new();
        while let Some(chunk) = Self::chunk(&mut response, transfer).await? {
            let chunk = chunk.as_ref();
            if chunk.len() > limit.saturating_sub(bytes.len()) { return Err("Download exceeds size limit".into()); }
            bytes.extend_from_slice(chunk);
        }
        Ok(bytes)
    }
    pub fn manifests(&self) -> Result<Vec<Manifest>, String> {
        self.manifests_for(None)
    }
    pub(super) fn install_manifests(&self, transfer: &crate::packages::InstallTransfer) -> Result<Vec<Manifest>, String> {
        self.manifests_for(Some(transfer))
    }
    fn manifests_for(&self, transfer: Option<&crate::packages::InstallTransfer>) -> Result<Vec<Manifest>, String> {
        let bytes = self.io.lock().map_err(|_| "Catalog I/O lock poisoned")?.block_on(self.get(self.base.clone(), 512 * 1024, transfer))?;
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
        verify_catalog(&bytes, &self.trust.public_key, now)
    }
    pub fn artifact(&self, artifact: &Artifact) -> Result<Vec<u8>, String> {
        validate_artifact(artifact)?;
        if artifact.byte_length > 4 * 1024 * 1024 { return Err("Large artifacts require the streaming download path".into()); }
        let url = self.base.join(&artifact.path).map_err(|e| e.to_string())?;
        if url.origin() != self.base.origin() { return Err("Artifact must share the trusted catalog origin".into()); }
        let bytes = self.io.lock().map_err(|_| "Catalog I/O lock poisoned")?.block_on(self.get(url, artifact.byte_length, None))?;
        verify_artifact(artifact, &bytes)?;
        Ok(bytes)
    }
    pub fn download(&self, artifact: &Artifact, output: &mut impl std::io::Write) -> Result<(), String> {
        self.download_for(artifact, output, None)
    }
    pub(super) fn install_download(&self, artifact: &Artifact, output: &mut impl std::io::Write, transfer: &crate::packages::InstallTransfer) -> Result<(), String> {
        self.download_for(artifact, output, Some(transfer))
    }
    fn download_for(&self, artifact: &Artifact, output: &mut impl std::io::Write, transfer: Option<&crate::packages::InstallTransfer>) -> Result<(), String> {
        validate_artifact(artifact)?;
        let url = self.base.join(&artifact.path).map_err(|e| e.to_string())?;
        if url.origin() != self.base.origin() { return Err("Artifact must share the trusted catalog origin".into()); }
        self.io.lock().map_err(|_| "Catalog I/O lock poisoned")?.block_on(async {
        let mut response = self.response(url, transfer).await?;
        if !response.status().is_success() || response.content_length().is_some_and(|n| n != artifact.byte_length as u64) {
            return Err("Download rejected by status/size limits".into());
        }
        let mut hash = Sha256::new();
        let mut total = 0usize;
        while let Some(chunk) = Self::chunk(&mut response, transfer).await? {
            let chunk = chunk.as_ref();
            total = total.checked_add(chunk.len()).ok_or("Artifact size overflow")?;
            if total > artifact.byte_length { return Err("Artifact exceeds declared size".into()); }
            for bytes in chunk.chunks(65536) {
                if let Some(transfer) = transfer { transfer.check()?; }
                output.write_all(bytes).map_err(|e| e.to_string())?;
                hash.update(bytes);
                if let Some(transfer) = transfer { transfer.progress(bytes.len())?; }
            }
        }
        if total != artifact.byte_length || !format!("{:x}", hash.finalize()).eq_ignore_ascii_case(&artifact.sha256) {
            return Err("Artifact digest or size mismatch".into());
        }
        Ok(())
        })
    }
}

async fn cancelled(transfer: Option<&crate::packages::InstallTransfer>) {
    match transfer {
        Some(transfer) => transfer.cancelled().await,
        None => std::future::pending().await,
    }
}
