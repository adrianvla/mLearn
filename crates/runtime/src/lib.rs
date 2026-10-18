mod analysis;
mod execution;
mod guest;
mod language;
mod packages;
mod watch;
pub mod catalog;
pub use execution::RuntimeExecutor;
use catalog::{CatalogClient, CatalogTrust, Manifest, verify_artifact};
use mlearn_core::{PluginSummary, Request, Response, Snapshot, PROTOCOL_VERSION};
use mlearn_language_host::{CodeOrigin, CodePolicy, CompiledPlugin};
use mlearn_storage::{ProfileStore, StorageError};
use std::{collections::BTreeMap, path::{Path, PathBuf}, sync::Arc};

pub struct BundledPlugin {
    pub manifest: Manifest,
    pub code: Vec<u8>,
    pub assets: BTreeMap<String, std::borrow::Cow<'static, [u8]>>,
}
#[derive(Clone)]
struct Installed { manifest: Manifest, compiled: Arc<CompiledPlugin> }

/// Independent of Tauri, Expo and React. Native hosts use RuntimeExecutor.
pub struct Runtime {
    store: ProfileStore,
    cancellation: Arc<std::sync::atomic::AtomicU64>,
    root: PathBuf,
    policy: CodePolicy,
    catalog: Option<Arc<CatalogClient>>,
    installed: BTreeMap<String, Installed>,
    analysis_cache: std::collections::VecDeque<(String, Vec<mlearn_core::CueAnalysis>)>,
}
fn summary(manifest: &Manifest) -> PluginSummary {
    PluginSummary { id: manifest.id.clone(), version: manifest.version.clone(), capabilities: manifest.capabilities.clone() }
}
impl Runtime {
    pub fn open(root: &Path, policy: CodePolicy, trust: Option<CatalogTrust>, bundled: Vec<BundledPlugin>) -> Result<Self, String> {
        if policy == CodePolicy::MobileBundled && trust.is_some() { return Err("Mobile executable catalogs are prohibited".into()); }
        if !bundled.is_empty() { policy.authorize(CodeOrigin::Bundle)?; }
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let store = ProfileStore::open(&root.join("profile.sqlite3")).map_err(|e| e.to_string())?;
        let catalog = trust.map(CatalogClient::new).transpose()?.map(Arc::new);
        let mut runtime = Self { store, cancellation: Arc::new(std::sync::atomic::AtomicU64::new(0)), root: root.into(), policy, catalog, installed: BTreeMap::new(), analysis_cache: std::collections::VecDeque::new() };
        if policy == CodePolicy::DesktopDownloaded {
            for stored in runtime.store.plugin_manifests().map_err(|e| e.to_string())? {
                let manifest: Manifest = serde_json::from_str(&stored).map_err(|e| e.to_string())?;
                manifest.validate()?;
                let code = packages::read_blob(root, &manifest.code)?;
                let compiled = Arc::new(packages::compile(root, &manifest, &code)?);
                runtime.installed.insert(manifest.id.clone(), Installed { manifest, compiled });
            }
        }
        for plugin in bundled {
            plugin.manifest.validate()?;
            verify_artifact(&plugin.manifest.code, &plugin.code)?;
            for (key, artifact) in &plugin.manifest.assets {
                let bytes = plugin.assets.get(key).ok_or("Bundled asset missing")?;
                packages::write_blob(root, artifact, bytes)?;
            }
            let compiled = Arc::new(packages::compile(root, &plugin.manifest, &plugin.code)?);
            if runtime.installed.insert(plugin.manifest.id.clone(), Installed { manifest: plugin.manifest, compiled }).is_some() { return Err("Duplicate bundled plugin id".into()); }
        }
        Ok(runtime)
    }
    pub fn cancellation_handle(&self) -> Arc<std::sync::atomic::AtomicU64> { self.cancellation.clone() }
    /// Synchronous owner compatibility, using the same preparation and completion as native hosts.
    pub fn execute(&mut self, request: &str) -> String {
        execution::encode(execution::parse(request).and_then(|request| {
            let epoch = self.cancellation.load(std::sync::atomic::Ordering::Relaxed);
            match self.prepare(request, epoch)? {
                guest::Prepared::Immediate(response) => Ok(*response),
                guest::Prepared::Work(work) => {
                    let mut output = work.run()?;
                    #[cfg(test)]
                    watch::source_execution_tests::hold_guest_result(work.capability());
                    let (response, retired) = self.complete(&work, &mut output)?;
                    drop(retired);
                    Ok(response)
                }
            }
        }))
    }
    fn metadata(&mut self, request: Request) -> Result<Response, execution::Failure> {
        use execution::Failure;
        match request {
            Request::Snapshot => {
                let (revision, theme) = self.store.preferences().map_err(|e| Failure::Operation(e.to_string()))?;
                Ok(Response::Snapshot { snapshot: Snapshot { protocol_version: PROTOCOL_VERSION, revision, theme, code_policy: self.policy.label().into(), catalog_configured: self.catalog.is_some(), available_plugins: vec![], installed_plugins: self.installed.values().map(|p| summary(&p.manifest)).collect() } })
            }
            Request::SaveTheme { document, expected_revision, command_id } => {
                let revision = self.store.save_theme(&document, expected_revision, &command_id).map_err(|e| {
                    let code = if matches!(e, StorageError::Conflict) { "conflict" } else { "invalid_settings" };
                    Failure::Protocol(code, e.to_string())
                })?;
                Ok(Response::Saved { revision })
            }
            request => self.watch(request, self.cancellation.load(std::sync::atomic::Ordering::Relaxed)).map_err(Failure::Operation),
        }
    }
}
