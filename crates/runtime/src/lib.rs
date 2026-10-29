mod analysis;
mod capture;
pub mod catalog;
mod collection;
mod conversation;
mod conversation_execution;
mod conversation_provider;
mod document;
mod document_import;
mod document_projection;
mod document_recovery;
mod document_transport;
mod execution;
mod graph;
mod guest;
mod language;
mod linguistic;
mod material;
mod material_bulk;
mod material_generation;
mod material_media;
mod material_proposal;
mod material_source;
mod media_file;
mod media_format;
mod media_import;
mod media_recovery;
pub mod native_ocr;
mod ocr;
pub mod ocr_package;
mod ocr_source;
mod packages;
mod review;
mod source_file;
mod watch;
use catalog::{verify_artifact, CatalogClient, CatalogTrust, Manifest};
pub use execution::RuntimeExecutor;
use mlearn_core::{PackageIssue, PluginSummary, Request, Response, Snapshot, PROTOCOL_VERSION};
use mlearn_language_host::{CodeOrigin, CodePolicy, CompiledPlugin};
use mlearn_storage::{ProfileStore, StorageError};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

pub struct BundledPlugin {
    pub manifest: Manifest,
    pub code: Vec<u8>,
    pub assets: BTreeMap<String, std::borrow::Cow<'static, [u8]>>,
}
#[derive(Clone)]
struct Installed {
    manifest: Manifest,
    compiled: Arc<CompiledPlugin>,
}
impl Installed {
    fn revision(&self) -> Result<String, execution::Failure> {
        use sha2::{Digest, Sha256};
        let bytes = serde_json::to_vec(&self.manifest)
            .map_err(|e| execution::Failure::Operation(e.to_string()))?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
}

/// Independent of Tauri, Expo and React. Native hosts use RuntimeExecutor.
pub struct Runtime {
    store: ProfileStore,
    cancellation: Arc<std::sync::atomic::AtomicU64>,
    root: PathBuf,
    policy: CodePolicy,
    catalog: Option<Arc<CatalogClient>>,
    installs: Arc<packages::InstallOwner>,
    installed: BTreeMap<String, Installed>,
    package_issues: BTreeMap<String, String>,
    analysis_cache: std::collections::VecDeque<(String, Vec<Vec<mlearn_core::AnalyzedToken>>)>,
    ocr_admission: Option<(String, u64)>,
}
fn summary(manifest: &Manifest) -> PluginSummary {
    PluginSummary {
        id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        version: manifest.version.clone(),
        capabilities: manifest.capabilities.clone(),
    }
}
impl Runtime {
    pub fn open(
        root: &Path,
        policy: CodePolicy,
        trust: Option<CatalogTrust>,
        bundled: Vec<BundledPlugin>,
    ) -> Result<Self, String> {
        if policy == CodePolicy::MobileBundled && trust.is_some() {
            return Err("Mobile executable catalogs are prohibited".into());
        }
        if !bundled.is_empty() {
            policy.authorize(CodeOrigin::Bundle)?;
        }
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let mut store =
            ProfileStore::open(&root.join("profile.sqlite3")).map_err(|e| e.to_string())?;
        store
            .interrupt_conversation_generations()
            .map_err(|error| error.to_string())?;
        store.interrupt_ocr().map_err(|error| error.to_string())?;
        store
            .interrupt_material_bulk()
            .map_err(|error| error.to_string())?;
        let catalog = trust.map(CatalogClient::new).transpose()?.map(Arc::new);
        let mut runtime = Self {
            store,
            cancellation: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            root: root.into(),
            policy,
            catalog,
            installs: Arc::new(packages::InstallOwner::default()),
            installed: BTreeMap::new(),
            package_issues: BTreeMap::new(),
            analysis_cache: std::collections::VecDeque::new(),
            ocr_admission: None,
        };
        if policy == CodePolicy::DesktopDownloaded {
            for (id, stored) in runtime
                .store
                .plugin_manifests()
                .map_err(|e| e.to_string())?
            {
                let restored = (|| -> Result<Installed, String> {
                    let manifest: Manifest =
                        serde_json::from_str(&stored).map_err(|e| e.to_string())?;
                    manifest.validate()?;
                    if manifest.id != id {
                        return Err("Stored package identity does not match its manifest".into());
                    }
                    let code = packages::read_blob(root, &manifest.code)?;
                    let compiled = Arc::new(packages::compile(root, &manifest, &code)?);
                    Ok(Installed { manifest, compiled })
                })();
                match restored {
                    Ok(installed) => {
                        runtime.installed.insert(id, installed);
                    }
                    Err(message) => {
                        runtime.package_issues.insert(id, message);
                    }
                }
            }
        }
        let mut bundled_ids = std::collections::BTreeSet::new();
        for plugin in bundled {
            let id = plugin.manifest.id.clone();
            if !bundled_ids.insert(id.clone()) {
                return Err("Duplicate bundled plugin id".into());
            }
            let restored = (|| -> Result<Installed, String> {
                plugin.manifest.validate()?;
                verify_artifact(&plugin.manifest.code, &plugin.code)?;
                for (key, artifact) in &plugin.manifest.assets {
                    let bytes = plugin.assets.get(key).ok_or("Bundled asset missing")?;
                    packages::write_blob(root, artifact, bytes)?;
                }
                let compiled = Arc::new(packages::compile(root, &plugin.manifest, &plugin.code)?);
                Ok(Installed {
                    manifest: plugin.manifest,
                    compiled,
                })
            })();
            match restored {
                Ok(installed) => {
                    runtime.installed.insert(id, installed);
                }
                Err(message) => {
                    runtime.package_issues.insert(id, message);
                }
            }
        }
        runtime
            .recover_material_media()
            .map_err(|error| error.to_string())?;
        runtime
            .recover_document_files()
            .map_err(|error| error.to_string())?;
        Ok(runtime)
    }
    pub fn cancellation_handle(&self) -> Arc<std::sync::atomic::AtomicU64> {
        self.cancellation.clone()
    }
    /// Synchronous owner compatibility, using the same preparation and completion as native hosts.
    pub fn execute(&mut self, request: &str) -> String {
        execution::encode(execution::parse(request).and_then(|request| {
            let epoch = self.cancellation.load(std::sync::atomic::Ordering::Relaxed);
            match self.prepare(request, epoch)? {
                guest::Prepared::Immediate(response) => Ok(*response),
                guest::Prepared::Work(work) => {
                    let result = (|| {
                        let mut output = work.run()?;
                        #[cfg(test)]
                        watch::source_execution_tests::hold_guest_result(work.capability());
                        let (response, retired) = self.complete(&work, &mut output)?;
                        drop(retired);
                        Ok(response)
                    })();
                    self.finish_work(&work, result)
                }
            }
        }))
    }
    fn finish_work(
        &mut self,
        work: &guest::GuestWork,
        result: Result<Response, execution::Failure>,
    ) -> Result<Response, execution::Failure> {
        let result = work.finish(result);
        if let (guest::GuestWork::Install { transfer, .. }, Err(error)) = (work, &result) {
            let command = transfer.command()?;
            if !command.command_id.starts_with("native:") {
                self.store
                    .record_install_failure(&command, &execution::error_response(error))
                    .map_err(|e| execution::Failure::Operation(e.to_string()))?;
            }
        }
        result
    }
    fn metadata(&mut self, request: Request) -> Result<Response, execution::Failure> {
        use execution::Failure;
        match request {
            Request::Collection { query } => self.collection_query(query),
            Request::CreateCollectionSelection { command } => {
                self.create_collection_selection(command)
            }
            Request::CollectionSelection { id } => Ok(Response::CollectionSelection {
                selection: self
                    .store
                    .collection_selection(&id)
                    .map_err(|error| Failure::Operation(error.to_string()))?,
            }),
            Request::CollectionSelections => Ok(Response::CollectionSelections {
                selections: self
                    .store
                    .collection_selections()
                    .map_err(|error| Failure::Operation(error.to_string()))?,
            }),
            Request::CollectionSelectionMembership {
                id,
                package_id,
                surface,
                items,
            } => Ok(Response::CollectionSelectionMembership {
                items: self
                    .store
                    .collection_selection_membership(&id, package_id.as_deref(), surface, &items)
                    .map_err(|error| Failure::Operation(error.to_string()))?,
                id,
            }),
            Request::CollectionSelectionPage { id, after } => {
                Ok(Response::CollectionSelectionPage {
                    page: self
                        .store
                        .collection_selection_page(&id, after.as_deref())
                        .map_err(|error| Failure::Operation(error.to_string()))?,
                    id,
                })
            }
            Request::ReleaseCollectionSelection { id } => {
                self.store
                    .release_collection_selection(&id)
                    .map_err(|error| Failure::Operation(error.to_string()))?;
                Ok(Response::CollectionSelectionReleased { id })
            }
            Request::Snapshot => {
                let (revision, theme) = self
                    .store
                    .preferences()
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                Ok(Response::Snapshot {
                    snapshot: Snapshot {
                        protocol_version: PROTOCOL_VERSION,
                        revision,
                        theme,
                        view_preferences: Some(
                            self.store
                                .view_preferences()
                                .map_err(|e| Failure::Operation(e.to_string()))?,
                        ),
                        code_policy: self.policy.label().into(),
                        catalog_configured: self.catalog.is_some(),
                        available_plugins: vec![],
                        installed_plugins: self
                            .installed
                            .values()
                            .map(|p| summary(&p.manifest))
                            .collect(),
                        package_issues: self
                            .package_issues
                            .iter()
                            .map(|(package_id, message)| PackageIssue {
                                package_id: package_id.clone(),
                                message: message.clone(),
                            })
                            .collect(),
                    },
                })
            }
            Request::SaveTheme {
                document,
                expected_revision,
                command_id,
            } => {
                let revision = self
                    .store
                    .save_theme(&document, expected_revision, &command_id)
                    .map_err(|e| {
                        let code = if matches!(e, StorageError::Conflict) {
                            "conflict"
                        } else {
                            "invalid_settings"
                        };
                        Failure::Protocol(code, e.to_string())
                    })?;
                Ok(Response::Saved { revision })
            }
            Request::SaveInlineLevelScale {
                scale_id,
                expected_revision,
                command_id,
            } => {
                let revision = self
                    .store
                    .save_inline_level_scale(scale_id.as_deref(), expected_revision, &command_id)
                    .map_err(|e| {
                        Failure::Protocol(
                            if matches!(e, StorageError::Conflict) {
                                "conflict"
                            } else {
                                "invalid_settings"
                            },
                            e.to_string(),
                        )
                    })?;
                Ok(Response::Saved { revision })
            }
            Request::SaveStarCollapse {
                collapse,
                expected_revision,
                command_id,
            } => {
                let revision = self
                    .store
                    .save_star_collapse(collapse, expected_revision, &command_id)
                    .map_err(|e| {
                        Failure::Protocol(
                            if matches!(e, StorageError::Conflict) {
                                "conflict"
                            } else {
                                "invalid_settings"
                            },
                            e.to_string(),
                        )
                    })?;
                Ok(Response::Saved { revision })
            }
            request @ (Request::MaterialProposals { .. }
            | Request::MaterialGeneration { .. }
            | Request::MaterialGenerations { .. }
            | Request::CollectMaterialGeneration { .. }
            | Request::MaterialProposal { .. }
            | Request::SuggestMaterial { .. }
            | Request::ReviewMaterialProposal { .. }
            | Request::ReturnMaterialProposalSource { .. }) => self.material_proposal_metadata(
                request,
                self.cancellation.load(std::sync::atomic::Ordering::Relaxed),
            ),
            request @ (Request::Materials { .. }
            | Request::PlanMaterialMedia { .. }
            | Request::MaterialMedia { .. }
            | Request::Material { .. }
            | Request::UpdateMaterial { .. }
            | Request::RemoveMaterial { .. }
            | Request::MaterialEligibility { .. }
            | Request::SetCaptureExclusion { .. }
            | Request::ReturnMaterialSource { .. }) => self.material_metadata(
                request,
                self.cancellation.load(std::sync::atomic::Ordering::Relaxed),
            ),
            request => self
                .watch(
                    request,
                    self.cancellation.load(std::sync::atomic::Ordering::Relaxed),
                )
                .map_err(Failure::Operation),
        }
    }
}
