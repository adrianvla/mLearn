use std::{io::ErrorKind, path::Path};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
#[cfg(test)]
use ed25519_dalek::{Signature, Verifier};
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    error::AppError,
    policy::{validate_setting_rule, PolicyDocument},
    secret_file,
};

#[derive(Clone)]
pub struct PolicySigner {
    signing_key: SigningKey,
    key_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyPublicKey {
    pub key_id: String,
    pub algorithm: &'static str,
    pub public_key: String,
}

impl PolicySigner {
    pub fn load_or_generate(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let path = path.as_ref();
        match secret_file::read_32(path, "policy signing key") {
            Ok(key) => return Ok(Self::from_signing_key(SigningKey::from_bytes(&key))),
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(key_error("read", path, error)),
        }

        let signing_key = SigningKey::generate(&mut OsRng);
        secret_file::persist_new_32(path, &signing_key.to_bytes(), "policy signing key")?;
        let signing_key = secret_file::read_32(path, "policy signing key")
            .map_err(|error| key_error("read", path, error))?;
        Ok(Self::from_signing_key(SigningKey::from_bytes(&signing_key)))
    }

    pub fn public_key(&self) -> PolicyPublicKey {
        PolicyPublicKey {
            key_id: self.key_id.clone(),
            algorithm: "Ed25519",
            public_key: URL_SAFE_NO_PAD.encode(self.signing_key.verifying_key().to_bytes()),
        }
    }

    pub fn sign_snapshot(&self, mut snapshot: PolicyDocument) -> Result<PolicyDocument, AppError> {
        for (key, rule) in &snapshot.settings {
            validate_setting_rule(key, &rule.value).map_err(|error| {
                AppError::Internal(format!(
                    "compiled policy setting `{key}` failed signing validation: {error}"
                ))
            })?;
        }
        snapshot.key_id = self.key_id.clone();
        snapshot.signature.clear();
        let bytes = canonical_unsigned_bytes(&snapshot)?;
        snapshot.signature = URL_SAFE_NO_PAD.encode(self.signing_key.sign(&bytes).to_bytes());
        Ok(snapshot)
    }

    fn from_signing_key(signing_key: SigningKey) -> Self {
        let key_id = URL_SAFE_NO_PAD.encode(Sha256::digest(signing_key.verifying_key().to_bytes()));
        Self {
            signing_key,
            key_id,
        }
    }

    #[cfg(test)]
    fn generate_for_test() -> Self {
        Self::from_signing_key(SigningKey::generate(&mut OsRng))
    }

    #[cfg(test)]
    fn verify_for_test(&self, snapshot: &PolicyDocument) -> bool {
        if snapshot.key_id != self.key_id {
            return false;
        }
        let Ok(signature_bytes) = URL_SAFE_NO_PAD.decode(&snapshot.signature) else {
            return false;
        };
        let Ok(signature) = Signature::from_slice(&signature_bytes) else {
            return false;
        };
        let Ok(bytes) = canonical_unsigned_bytes(snapshot) else {
            return false;
        };
        self.signing_key
            .verifying_key()
            .verify(&bytes, &signature)
            .is_ok()
    }
}

fn canonical_unsigned_bytes(snapshot: &PolicyDocument) -> Result<Vec<u8>, AppError> {
    let mut value = serde_json::to_value(snapshot)
        .map_err(|error| AppError::Internal(format!("policy serialization failed: {error}")))?;
    value
        .as_object_mut()
        .ok_or_else(|| AppError::Internal("policy snapshot must serialize as an object".into()))?
        .remove("signature");
    canonical_json_bytes(&value)
}

fn canonical_json_bytes(value: &impl Serialize) -> Result<Vec<u8>, AppError> {
    serde_json_canonicalizer::to_vec(value)
        .map_err(|error| AppError::Internal(format!("policy canonicalization failed: {error}")))
}

fn key_error(action: &str, path: &Path, error: std::io::Error) -> AppError {
    AppError::Internal(format!(
        "failed to {action} policy signing key at {}: {error}",
        path.display()
    ))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        sync::{Arc, Barrier},
        thread,
    };

    use serde_json::json;

    use crate::policy::{model::PolicyAncestryEntry, LlmPolicy, PolicyDocument, SettingRule};

    use super::PolicySigner;

    fn unique_key_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "mlearn-policy-signing-{label}-{}",
            uuid::Uuid::now_v7()
        ))
    }

    fn fixture_snapshot() -> PolicyDocument {
        PolicyDocument {
            schema_version: 1,
            policy_version_id: "policy-version".into(),
            active_group_id: "group-a".into(),
            ancestry: vec![PolicyAncestryEntry {
                id: "group-a".into(),
                name: "Group A".into(),
            }],
            settings: BTreeMap::from([(
                "llmEnabled".into(),
                SettingRule {
                    value: json!(false),
                    source_group_id: "group-a".into(),
                    source_group_name: "Group A".into(),
                    locked: true,
                },
            )]),
            features: BTreeMap::new(),
            llm: LlmPolicy {
                enabled: false,
                allowed_providers: Vec::new(),
                allowed_models: Vec::new(),
                prompt_profile_id: None,
                quotas: Vec::new(),
            },
            issued_at: "2026-07-10T08:00:00Z".into(),
            expires_at: "2026-07-10T08:15:00Z".into(),
            key_id: String::new(),
            signature: String::new(),
        }
    }

    #[test]
    fn signature_fails_after_managed_value_is_changed() {
        let signer = PolicySigner::generate_for_test();
        let signed = signer.sign_snapshot(fixture_snapshot()).unwrap();
        let mut tampered = signed.clone();
        tampered.settings.get_mut("llmEnabled").unwrap().value = json!(true);
        assert!(!signer.verify_for_test(&tampered));
    }

    #[test]
    fn signer_rejects_legacy_unsafe_integer_setting() {
        let signer = PolicySigner::generate_for_test();
        let mut snapshot = fixture_snapshot();
        snapshot.settings.insert(
            "subtitle_font_size".into(),
            SettingRule {
                value: json!(9_007_199_254_740_992_u64),
                source_group_id: "group-a".into(),
                source_group_name: "Group A".into(),
                locked: true,
            },
        );

        assert!(signer.sign_snapshot(snapshot).is_err());
    }

    #[test]
    fn signer_accepts_finite_fractional_setting() {
        let signer = PolicySigner::generate_for_test();
        let mut snapshot = fixture_snapshot();
        snapshot.settings.insert(
            "subtitle_font_size".into(),
            SettingRule {
                value: json!(20.5),
                source_group_id: "group-a".into(),
                source_group_name: "Group A".into(),
                locked: true,
            },
        );

        let signed = signer.sign_snapshot(snapshot).unwrap();
        assert!(signer.verify_for_test(&signed));
    }

    #[test]
    fn rust_matches_shared_rfc8785_vectors() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../test/fixtures/policy-jcs-vectors.json"
        ))
        .unwrap();
        for vector in fixture["vectors"].as_array().unwrap() {
            let bytes = super::canonical_json_bytes(&vector["input"]).unwrap();
            assert_eq!(
                String::from_utf8(bytes).unwrap(),
                vector["canonical"].as_str().unwrap(),
                "{}",
                vector["name"].as_str().unwrap()
            );
        }
        let snapshot: PolicyDocument =
            serde_json::from_value(fixture["signedSnapshot"].clone()).unwrap();
        assert_eq!(
            String::from_utf8(super::canonical_unsigned_bytes(&snapshot).unwrap()).unwrap(),
            fixture["signedSnapshotCanonical"].as_str().unwrap()
        );
    }

    #[test]
    fn signing_key_persists_and_reloads_with_the_same_public_key() {
        let path = unique_key_path("reload");
        let first = PolicySigner::load_or_generate(&path).unwrap();
        let second = PolicySigner::load_or_generate(&path).unwrap();
        assert_eq!(first.public_key(), second.public_key());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn concurrent_creation_converges_on_one_key() {
        let path = unique_key_path("concurrent");
        let barrier = Arc::new(Barrier::new(8));
        let handles = (0..8)
            .map(|_| {
                let barrier = barrier.clone();
                let path = path.clone();
                thread::spawn(move || {
                    barrier.wait();
                    PolicySigner::load_or_generate(path).unwrap().public_key()
                })
            })
            .collect::<Vec<_>>();
        let keys = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert!(keys.iter().all(|key| key == &keys[0]));
        fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn persisted_key_permissions_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let path = unique_key_path("mode");
        PolicySigner::load_or_generate(&path).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
            0o600
        );
        fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn existing_key_permissions_are_repaired_through_the_open_descriptor() {
        use std::os::unix::fs::PermissionsExt;

        let path = unique_key_path("repair-mode");
        fs::write(&path, [7_u8; 32]).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        PolicySigner::load_or_generate(&path).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
            0o600
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn malformed_key_fails_startup_instead_of_rotating() {
        let path = unique_key_path("malformed");
        fs::write(&path, b"not-a-private-key").unwrap();
        assert!(PolicySigner::load_or_generate(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"not-a-private-key");
        fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_key_path_is_rejected() {
        use std::os::unix::fs::symlink;

        let target = unique_key_path("symlink-target");
        let link = unique_key_path("symlink-link");
        fs::write(&target, [7_u8; 32]).unwrap();
        symlink(&target, &link).unwrap();
        assert!(PolicySigner::load_or_generate(&link).is_err());
        fs::remove_file(link).unwrap();
        fs::remove_file(target).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn non_regular_key_path_is_rejected_without_changing_its_mode() {
        use std::os::unix::fs::PermissionsExt;

        let path = unique_key_path("directory");
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(PolicySigner::load_or_generate(&path).is_err());
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o755
        );
        fs::remove_dir(path).unwrap();
    }

    #[test]
    fn signature_fails_after_active_group_is_changed() {
        let signer = PolicySigner::generate_for_test();
        let signed = signer.sign_snapshot(fixture_snapshot()).unwrap();
        let tampered = PolicyDocument {
            active_group_id: "group-b".into(),
            ..signed
        };
        assert!(!signer.verify_for_test(&tampered));
    }

    #[test]
    fn signature_fails_after_expiry_is_changed() {
        let signer = PolicySigner::generate_for_test();
        let signed = signer.sign_snapshot(fixture_snapshot()).unwrap();
        let tampered = PolicyDocument {
            expires_at: "2026-07-10T09:15:00Z".into(),
            ..signed
        };
        assert!(!signer.verify_for_test(&tampered));
    }

    #[test]
    fn signature_fails_after_key_id_is_changed() {
        let signer = PolicySigner::generate_for_test();
        let signed = signer.sign_snapshot(fixture_snapshot()).unwrap();
        let tampered = PolicyDocument {
            key_id: "another-key".into(),
            ..signed
        };
        assert!(!signer.verify_for_test(&tampered));
    }
}
