use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use std::io::Write;
use zip::write::SimpleFileOptions;

fn archive(root: &Path, name: &str, files: &[(&str, &[u8])]) -> (Artifact, String) {
    let file = File::create(root.join(format!("{name}.zip"))).unwrap();
    let mut archive = zip::ZipWriter::new(file);
    let mut inventory = BTreeMap::new();
    for &(path, bytes) in files {
        archive
            .start_file(path, SimpleFileOptions::default().unix_permissions(0o755))
            .unwrap();
        archive.write_all(bytes).unwrap();
        inventory.insert(path,serde_json::json!({"sha256":format!("{:x}",Sha256::digest(bytes)),"byte_length":bytes.len()}));
    }
    let index = serde_json::to_vec(&inventory).unwrap();
    archive
        .start_file("inventory.json", SimpleFileOptions::default())
        .unwrap();
    archive.write_all(&index).unwrap();
    archive.finish().unwrap();
    let bytes = fs::read(root.join(format!("{name}.zip"))).unwrap();
    (
        Artifact {
            path: format!("{name}.zip"),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            byte_length: bytes.len(),
        },
        format!("{:x}", Sha256::digest(index)),
    )
}
fn fixture(root: &Path) -> NativeOcrProfile {
    let (runtime, runtime_index_sha256) = archive(
        root,
        "runtime",
        &[
            (native_ocr_library(), b"native runtime"),
            ("lib/dependency", b"read-only runtime"),
        ],
    );
    let (models, models_index_sha256) = archive(
        root,
        "models",
        &[
            ("manga/weights", b"actual fixture bytes"),
            (
                "profile.json",
                br#"{"schemaVersion":1,"executor":"paddle-manga-onnx-v1"}"#,
            ),
        ],
    );
    NativeOcrProfile {
        id: "fixture.ocr".into(),
        label: "Test fixture".into(),
        target: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        executor: "paddle-manga-onnx-v1".into(),
        runtime,
        models,
        runtime_index_sha256,
        models_index_sha256,
    }
}
#[test]
fn signed_native_catalog_separates_authentication_target_and_expiry() {
    let input = tempfile::tempdir().unwrap();
    let profile = fixture(input.path());
    let key = SigningKey::from_bytes(&[19; 32]);
    let public = STANDARD.encode(key.verifying_key().to_bytes());
    let payload = serde_json::to_vec(
        &serde_json::json!({"schemaVersion":1,"expiresAt":100,"nativeOcr":[profile]}),
    )
    .unwrap();
    let envelope=serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(&payload),"signature":STANDARD.encode(key.sign(&payload).to_bytes())})).unwrap();
    assert_eq!(profiles(&envelope, &public, 99).unwrap().len(), 1);
    assert!(profiles(&envelope, &public, 100).is_err());
    // Offline restore checks the signature, not the old download expiry.
    assert_eq!(profiles(&envelope, &public, 0).unwrap().len(), 1);
    assert!(
        profiles(
            &envelope,
            &STANDARD.encode(SigningKey::from_bytes(&[20; 32]).verifying_key().to_bytes()),
            0
        )
        .is_err()
    );
}
#[test]
fn authenticated_archives_unpack_only_inventory_bytes_and_reject_tampering() {
    let input = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let profile = fixture(input.path());
    unpack(input.path(), output.path(), &profile, None).unwrap();
    assert_eq!(
        fs::read(output.path().join("runtime/lib/dependency")).unwrap(),
        b"read-only runtime"
    );
    fs::write(input.path().join("models.zip"), b"tampered").unwrap();
    let replacement = tempfile::tempdir().unwrap();
    assert!(unpack(input.path(), replacement.path(), &profile, None).is_err());
}
#[test]
fn native_inventory_rejects_unlisted_path_traversal() {
    assert!(safe_relative("../outside").is_err());
    assert!(safe_relative("/outside").is_err());
    assert!(safe_relative("nested/../../outside").is_err());
    assert!(safe_relative("runtime/libonnxruntime.so").is_ok());
}

#[test]
fn installed_resources_restore_offline_without_reextracting_archives() {
    let input = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let profile = fixture(input.path());
    unpack(input.path(), output.path(), &profile, None).unwrap();
    fs::remove_file(input.path().join("runtime.zip")).unwrap();
    fs::remove_file(input.path().join("models.zip")).unwrap();
    verify_installed(output.path(), &profile, None).unwrap();
    assert!(!output.path().join("runtime.zip").exists());
}
#[test]
fn authenticated_models_cannot_select_a_different_executor() {
    let input = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let mut profile = fixture(input.path());
    // Both executors are admitted host capabilities. The authenticated model
    // envelope still has to match this catalog entry, not choose the other one.
    profile.executor = "paddle-ctc-onnx-v1".into();
    profile.validate().unwrap();
    assert!(unpack(input.path(), output.path(), &profile, None).is_err());
}
#[test]
fn installed_resources_reject_unlisted_executable_files() {
    let input = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let profile = fixture(input.path());
    unpack(input.path(), output.path(), &profile, None).unwrap();
    fs::write(
        output.path().join("runtime/injected.dll"),
        b"untrusted native library",
    )
    .unwrap();
    assert!(verify_installed(output.path(), &profile, None).is_err());
}
#[test]
fn installed_resources_reject_changed_bytes_and_cancelled_admission() {
    let input = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let profile = fixture(input.path());
    unpack(input.path(), output.path(), &profile, None).unwrap();
    fs::remove_file(output.path().join("runtime/lib/dependency")).unwrap();
    fs::write(
        output.path().join("runtime/lib/dependency"),
        b"replaced runtime",
    )
    .unwrap();
    assert!(verify_installed(output.path(), &profile, None).is_err());
    let (_sender, cancelled) = tokio::sync::watch::channel(true);
    assert!(
        verify_installed(output.path(), &profile, Some(&cancelled))
            .unwrap_err()
            .contains("cancelled")
    );
}

fn installed_fixture() -> (tempfile::TempDir, NativeOcrModels) {
    let root = tempfile::tempdir().unwrap();
    let input = tempfile::tempdir().unwrap();
    let profile = fixture(input.path());
    let destination = root.path().join("native-ocr").join(&profile.id);
    fs::create_dir_all(&destination).unwrap();
    unpack(input.path(), &destination, &profile, None).unwrap();
    let key = SigningKey::from_bytes(&[21; 32]);
    let payload = serde_json::to_vec(
        &serde_json::json!({"schemaVersion":1,"expiresAt":100,"nativeOcr":[profile]}),
    )
    .unwrap();
    let receipt=serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(&payload),"signature":STANDARD.encode(key.sign(&payload).to_bytes())})).unwrap();
    fs::write(destination.join("receipt.json"), receipt).unwrap();
    let models = NativeOcrModels::new(
        root.path(),
        Some(CatalogTrust {
            url: "http://127.0.0.1:7780/catalog.json".into(),
            public_key: STANDARD.encode(key.verifying_key().to_bytes()),
        }),
    )
    .unwrap();
    (root, models)
}
#[test]
fn resource_removal_cannot_invalidate_a_running_native_lease() {
    let (_root, models) = installed_fixture();
    let lease = models.admit("fixture.ocr").unwrap();
    assert!(
        models
            .remove("fixture.ocr")
            .unwrap_err()
            .contains("Cancel active OCR")
    );
    assert!(
        lease
            .installation()
            .directory
            .join("runtime")
            .join(native_ocr_library())
            .is_file()
    );
}
#[test]
fn released_resources_are_actually_removed_without_a_learner_write() {
    let (root, models) = installed_fixture();
    drop(models.admit("fixture.ocr").unwrap());
    models.remove("fixture.ocr").unwrap();
    assert!(models.installed("fixture.ocr").is_err());
    assert!(!root.path().join("native-ocr/fixture.ocr").exists());
    assert!(!root.path().join("profile.sqlite3").exists());
}
#[test]
fn cancelled_native_installation_cannot_start_extraction_or_activation() {
    let input = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let profile = fixture(input.path());
    let owner = InstallOwner::default();
    let command = owner.legacy_command(profile.id.clone());
    let InstallStart::Started(transfer) = owner.begin(command.clone()).unwrap() else {
        panic!("fresh install must start");
    };
    owner.status(&command.command_id, true).unwrap();
    assert!(
        unpack(input.path(), output.path(), &profile, Some(&transfer))
            .unwrap_err()
            .contains("cancelled")
    );
    assert!(
        !output
            .path()
            .join("runtime")
            .join(native_ocr_library())
            .exists()
    );
}

#[test]
fn packaged_python_executor_is_not_a_native_onnx_profile() {
    let input = tempfile::tempdir().unwrap();
    let mut profile = fixture(input.path());
    profile.executor = "paddle-manga-cpu-v1".into();
    assert!(profile.validate().is_err());
}
