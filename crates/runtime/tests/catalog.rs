use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use mlearn_runtime::catalog::{verify_artifact, verify_catalog, Artifact};
use sha2::{Digest, Sha256};

#[test]
fn signature_and_expiry_are_verified_before_accepting_catalog() {
    let key = SigningKey::from_bytes(&[42; 32]); // Test-only key, never trusted by application hosts.
    let payload = br#"{"schemaVersion":1,"expiresAt":100,"plugins":[]}"#;
    let signature = key.sign(payload);
    let envelope = serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(payload),"signature":STANDARD.encode(signature.to_bytes())})).unwrap();
    let public = STANDARD.encode(key.verifying_key().to_bytes());
    assert!(verify_catalog(&envelope, &public, 99).is_ok());
    assert!(verify_catalog(&envelope, &public, 100).is_err());
    assert!(verify_catalog(&envelope, &STANDARD.encode([3; 32]), 99).is_err());
    let changed = serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(b"{}"),"signature":STANDARD.encode(signature.to_bytes())})).unwrap();
    assert!(verify_catalog(&changed, &public, 99).is_err());
}

#[test]
fn digest_size_and_safe_paths_are_required() {
    let bytes = b"sample";
    let mut artifact = Artifact { path: "objects/sample.wasm".into(), sha256: format!("{:x}", Sha256::digest(bytes)), byte_length: bytes.len() };
    assert!(verify_artifact(&artifact, bytes).is_ok());
    assert!(verify_artifact(&artifact, b"tamper").is_err());
    artifact.path = "../escape".into();
    assert!(verify_artifact(&artifact, bytes).is_err());
}

#[test]
fn streamed_artifacts_reject_truncation_overflow_and_wrong_digest() {
    use mlearn_runtime::catalog::copy_artifact;
    let bytes = vec![42; 65536 * 3 + 11];
    let artifact = Artifact { path: "objects/data.bin".into(), sha256: format!("{:x}", Sha256::digest(&bytes)), byte_length: bytes.len() };
    let mut output = Vec::new();
    copy_artifact(&artifact, &mut bytes.as_slice(), &mut output).unwrap();
    assert_eq!(output, bytes);
    assert!(copy_artifact(&artifact, &mut &bytes[..bytes.len()-1], &mut std::io::sink()).is_err());
    let mut extra = bytes.clone(); extra.push(0);
    assert!(copy_artifact(&artifact, &mut extra.as_slice(), &mut std::io::sink()).is_err());
    extra.pop(); extra[1] ^= 1;
    assert!(copy_artifact(&artifact, &mut extra.as_slice(), &mut std::io::sink()).is_err());
}

#[test]
fn unknown_resource_compatibility_and_unbounded_manifest_are_rejected() {
    use mlearn_runtime::catalog::Manifest;
    let artifact = serde_json::json!({"path":"objects/data.bin","sha256":"a".repeat(64),"byteLength":32});
    let mut value = serde_json::json!({"id":"test.package","version":"1","abiVersion":1,"capabilities":["test"],"code":artifact,"assets":{"dict":artifact},"resources":{"dict":"bytes-v1"},"execution":"persistent-v1"});
    assert!(serde_json::from_value::<Manifest>(value.clone()).unwrap().validate().is_ok());
    value["resources"]["dict"] = "bytes-v999".into();
    assert!(serde_json::from_value::<Manifest>(value.clone()).is_err());
    value["resources"]["dict"] = "bytes-v1".into();
    value["assets"]["dict"]["byteLength"] = (128 * 1024 * 1024 + 1).into();
    assert!(serde_json::from_value::<Manifest>(value).unwrap().validate().is_err());
}

#[test]
fn abi1_defaults_keep_legacy_asset_count_digest_case_and_small_budgets() {
    use mlearn_language_host::ExecutionPolicy;
    use mlearn_runtime::catalog::{Manifest, copy_artifact};
    let bytes = b"legacy";
    let artifact = serde_json::json!({"path":"objects/legacy.bin","sha256":format!("{:X}",Sha256::digest(bytes)),"byteLength":bytes.len()});
    let assets = (0..32).map(|i| (format!("asset-{i}.json"), artifact.clone())).collect::<serde_json::Map<_, _>>();
    let value = serde_json::json!({"id":"existing.package","version":"1","abiVersion":1,"capabilities":["existing"],"code":artifact,"assets":assets});
    let manifest: Manifest = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(manifest.execution, ExecutionPolicy::Fresh);
    assert!(manifest.resources.is_empty());
    manifest.validate().unwrap();
    verify_artifact(&manifest.code, bytes).unwrap();
    copy_artifact(&manifest.code, &mut bytes.as_slice(), &mut std::io::sink()).unwrap();
    let mut oversized = value;
    oversized["assets"]["asset-0.json"]["byteLength"] = (8 * 1024 * 1024 + 1).into();
    assert!(serde_json::from_value::<Manifest>(oversized).unwrap().validate().is_err());

    let mut indexed = manifest.clone();
    indexed.assets.clear();
    let mut index = manifest.code.clone();
    index.byte_length = 32 * 1024 * 1024;
    indexed.assets.insert("lexicon.sqlite".into(), index.clone());
    indexed.validate().unwrap();
    indexed.assets.get_mut("lexicon.sqlite").unwrap().byte_length += 1;
    assert!(indexed.validate().is_err());

    indexed.assets.clear();
    index.byte_length = 20 * 1024 * 1024;
    indexed.assets.insert("one.sqlite".into(), index.clone());
    indexed.assets.insert("two.sqlite".into(), index);
    indexed.validate().unwrap();
    indexed.assets.insert("extra.json".into(), manifest.code.clone());
    assert!(indexed.validate().is_err());
}
