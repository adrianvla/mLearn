use crate::{
    Installed,
    catalog::{self, Artifact, CatalogClient, Manifest},
    execution::Cancellation,
    guest::{LanguageAction, LanguageWork},
};
use mlearn_language_host::{AssetMap, CompiledPlugin, Resource, Resources};
use std::{path::Path, sync::Arc};

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
pub(super) fn install(root: &Path, catalog: &CatalogClient, id: &str) -> Result<Installed, String> {
    let manifest = catalog.manifests()?.into_iter().find(|m| m.id == id).ok_or("Plugin is not in the trusted catalog")?;
    let code = catalog.artifact(&manifest.code)?;
    for artifact in manifest.assets.values() {
        let directory = root.join("plugin-blobs");
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut temporary = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
        catalog.download(artifact, &mut temporary)?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary.persist(directory.join(&artifact.sha256)).map_err(|e| e.to_string())?;
    }
    let compiled = Arc::new(compile(root, &manifest, &code)?);
    compiled.validate()?;
    let installed = Installed { manifest, compiled };
    if installed
        .manifest
        .capabilities
        .iter()
        .any(|c| c == "language.describe.v1")
    {
        LanguageWork {
            package: installed.clone(),
            cancellation: Cancellation::durable(),
            action: LanguageAction::Describe,
        }
        .description()
        .map_err(|e| e.to_string())?;
    }
    write_blob(root, &installed.manifest.code, &code)?;
    Ok(installed)
}
