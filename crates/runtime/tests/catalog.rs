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
