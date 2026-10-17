mod watch;
pub mod catalog;
use catalog::{CatalogClient, CatalogTrust, Manifest, verify_artifact};
use mlearn_core::{PluginSummary, Request, Response, Snapshot, PROTOCOL_VERSION};
use mlearn_language_host::{Resource,Resources,AssetMap, CodeOrigin, CodePolicy, CompiledPlugin};
use mlearn_storage::{ProfileStore, StorageError};
use std::{collections::BTreeMap, path::{Path, PathBuf}, sync::Arc};

pub struct BundledPlugin {
    pub manifest: Manifest,
    pub code: Vec<u8>,
    pub assets: BTreeMap<String, std::borrow::Cow<'static, [u8]>>,
}
struct Installed { manifest: Manifest, compiled: CompiledPlugin }

/// Independent of Tauri, Expo and React. Native hosts schedule calls on blocking workers.
pub struct Runtime {
    store: ProfileStore,
    cancellation:Arc<std::sync::atomic::AtomicU64>,
    request_epoch:u64,
    root: PathBuf,
    policy: CodePolicy,
    catalog: Option<CatalogClient>,
    installed: BTreeMap<String, Installed>,
    analysis_cache:std::collections::VecDeque<(String,Vec<mlearn_core::CueAnalysis>)>,
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
        let catalog = trust.map(CatalogClient::new).transpose()?;
        let mut runtime = Self { store, cancellation:Arc::new(std::sync::atomic::AtomicU64::new(0)),request_epoch:0,root: root.into(), policy, catalog, installed: BTreeMap::new(),analysis_cache:std::collections::VecDeque::new() };
        if policy == CodePolicy::DesktopDownloaded {
            for stored in runtime.store.plugin_manifests().map_err(|e| e.to_string())? {
                let manifest: Manifest = serde_json::from_str(&stored).map_err(|e| e.to_string())?;
                manifest.validate()?;
                let code = runtime.read_blob(&manifest.code)?;
                let compiled = runtime.compile(&manifest,&code)?;
                runtime.installed.insert(manifest.id.clone(), Installed { manifest, compiled });
            }
        }
        for plugin in bundled {
            plugin.manifest.validate()?;
            verify_artifact(&plugin.manifest.code, &plugin.code)?;
            for (key,artifact) in &plugin.manifest.assets {
                let bytes=plugin.assets.get(key).ok_or("Bundled asset missing")?;
                runtime.write_blob(artifact,bytes)?;
            }
            let compiled=runtime.compile(&plugin.manifest,&plugin.code)?;
            if runtime.installed.insert(plugin.manifest.id.clone(), Installed { manifest: plugin.manifest, compiled }).is_some() { return Err("Duplicate bundled plugin id".into()); }
        }
        Ok(runtime)
    }

    pub fn cancellation_handle(&self)->Arc<std::sync::atomic::AtomicU64>{self.cancellation.clone()}
    fn compile(&self,manifest:&Manifest,code:&[u8])->Result<CompiledPlugin,String> {
        let mut assets=AssetMap::new();let mut resources=Resources::new();
        for (key,artifact) in &manifest.assets {
            if let Some(kind) = manifest.resource_kind(key) {
                resources.insert(key.clone(),Resource::open(&self.root.join("plugin-blobs").join(&artifact.sha256),artifact.byte_length,&artifact.sha256,kind)?);
            } else {assets.insert(key.clone(),Arc::from(self.read_blob(artifact)?));}
        }
        CompiledPlugin::with_verified_resources(code,assets,resources,manifest.execution)
    }
    fn read_blob(&self, artifact: &catalog::Artifact) -> Result<Vec<u8>, String> {
        let path = self.root.join("plugin-blobs").join(&artifact.sha256);
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() != artifact.byte_length as u64 { return Err("Installed plugin blob has changed".into()); }
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        verify_artifact(artifact, &bytes)?;
        Ok(bytes)
    }
    fn write_blob(&self, artifact: &catalog::Artifact, bytes: &[u8]) -> Result<(), String> {
        verify_artifact(artifact, bytes)?;
        let directory = self.root.join("plugin-blobs");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join(&artifact.sha256);
        if path.exists() {
            catalog::copy_artifact(artifact,&mut std::fs::File::open(&path).map_err(|e|e.to_string())?,&mut std::io::sink())?;
            return Ok(());
        }
        let temporary = directory.join(format!("{}.part", artifact.sha256));
        {
            use std::io::Write;
            let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
        }
        std::fs::rename(temporary, path).map_err(|e| e.to_string())?;
        Ok(())
    }
    fn install(&mut self, id: &str) -> Result<PluginSummary, String> {
        self.policy.authorize(CodeOrigin::Download)?;
        let catalog = self.catalog.as_ref().ok_or("No trusted desktop plugin catalog configured")?;
        let manifest = catalog.manifests()?.into_iter().find(|m| m.id == id).ok_or("Plugin is not in the trusted catalog")?;
        let code = catalog.artifact(&manifest.code)?;
        for artifact in manifest.assets.values() {
            let directory=self.root.join("plugin-blobs");
            std::fs::create_dir_all(&directory).map_err(|e|e.to_string())?;
            let mut temporary=tempfile::NamedTempFile::new_in(&directory).map_err(|e|e.to_string())?;
            catalog.download(artifact,&mut temporary)?;
            temporary.as_file().sync_all().map_err(|e|e.to_string())?;
            temporary.persist(directory.join(&artifact.sha256)).map_err(|e|e.to_string())?;
        }
        let compiled=self.compile(&manifest,&code)?;
        self.write_blob(&manifest.code, &code)?;
        self.store.activate_plugin(&manifest.id, &serde_json::to_string(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let result = summary(&manifest);
        self.installed.insert(manifest.id.clone(), Installed { manifest, compiled });
        Ok(result)
    }
    fn dispatch(&mut self, request: Request) -> Result<Response, (String, String)> {
        let failure = |message: String| ("operation_failed".into(), message);
        match request {
            request @ (Request::RecentSources|Request::OpenSource{..}|Request::ResumeSource{..}|Request::AttachSubtitles{..}|Request::SourceWindow{..}|Request::SavePosition{..}|Request::AnalyzeSource{..}|Request::DescribeLanguage{..}|Request::InspectTarget{..}|Request::Knowledge{..}|Request::ChangeClaim{..})=>self.watch(request).map_err(failure),
            Request::AvailablePackages=>Ok(Response::Packages{plugins:self.catalog.as_ref().ok_or_else(||failure("No trusted catalog configured".into()))?.manifests().map_err(failure)?.iter().map(summary).collect()}),
            Request::Snapshot => {
                let (revision, theme) = self.store.preferences().map_err(|e| failure(e.to_string()))?;
                Ok(Response::Snapshot { snapshot: Snapshot { protocol_version: PROTOCOL_VERSION, revision, theme, code_policy: self.policy.label().into(), catalog_configured: self.catalog.is_some(), available_plugins: vec![], installed_plugins: self.installed.values().map(|p| summary(&p.manifest)).collect() } })
            }
            Request::SaveTheme { document, expected_revision, command_id } => {
                let revision = self.store.save_theme(&document, expected_revision, &command_id).map_err(|e| {
                    let code = if matches!(e, StorageError::Conflict) { "conflict" } else { "invalid_settings" };
                    (code.into(), e.to_string())
                })?;
                Ok(Response::Saved { revision })
            }
            Request::InstallPlugin { plugin_id } => Ok(Response::Installed { plugin: self.install(&plugin_id).map_err(failure)? }),
            Request::InvokePlugin { plugin_id, capability, input } => {
                let plugin = self.installed.get(&plugin_id).ok_or_else(|| failure("Plugin not installed".into()))?;
                if !plugin.manifest.capabilities.contains(&capability) { return Err(failure("Plugin does not declare this capability".into())); }
                Ok(Response::PluginResult { output: plugin.compiled.invoke_cancellable(&capability, input,self.cancellation.clone(),self.request_epoch).map_err(failure)? })
            }
        }
    }
    pub fn execute(&mut self, request: &str) -> String {
        self.request_epoch=self.cancellation.load(std::sync::atomic::Ordering::Relaxed);
        let result = if request.len() > 262_144 { Err(("request_too_large".into(), "Request exceeds 256 KiB".into())) }
            else { serde_json::from_str::<Request>(request).map_err(|e| ("invalid_request".into(), e.to_string())).and_then(|request| self.dispatch(request)) };
        let response = result.unwrap_or_else(|(code, message)| Response::Error { code, message: message.chars().take(2048).collect() });
        let encoded=serde_json::to_string(&response).expect("Runtime response types are JSON serializable");
        if encoded.len()>524288 {return r#"{"type":"error","code":"response_too_large","message":"Native response exceeds 512 KiB; select a smaller source range."}"#.into();}
        encoded
    }
}
