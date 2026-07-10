use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
};

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
        match read_key(path) {
            Ok(key) => return Ok(Self::from_signing_key(key)),
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(key_error("read", path, error)),
        }

        let signing_key = SigningKey::generate(&mut OsRng);
        persist_new_key(path, &signing_key)?;
        let signing_key = read_key(path).map_err(|error| key_error("read", path, error))?;
        Ok(Self::from_signing_key(signing_key))
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

fn read_key(path: &Path) -> std::io::Result<SigningKey> {
    #[cfg(not(unix))]
    {
        if fs::symlink_metadata(path)?.file_type().is_symlink() {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "refusing policy signing key symlink",
            ));
        }
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    let mut file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(std::io::Error::new(
            ErrorKind::InvalidData,
            "policy signing key must be a regular file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        if file.metadata()?.permissions().mode() & 0o7777 != 0o600 {
            return Err(std::io::Error::new(
                ErrorKind::PermissionDenied,
                "policy signing key permissions must be 0600",
            ));
        }
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        std::io::Error::new(
            ErrorKind::InvalidData,
            "policy signing key must be 32 bytes",
        )
    })?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn persist_new_key(path: &Path, signing_key: &SigningKey) -> Result<(), AppError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    if let Some(parent) = parent {
        fs::create_dir_all(parent)
            .map_err(|error| key_error("create directory for", path, error))?;
    }
    let temp_path = temporary_key_path(path);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp_path)
        .map_err(|error| key_error("create temporary", path, error))?;
    let result = (|| {
        file.write_all(&signing_key.to_bytes())?;
        file.sync_all()?;
        match fs::hard_link(&temp_path, path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    })();
    drop(file);
    let _ = fs::remove_file(&temp_path);
    result.map_err(|error| key_error("persist", path, error))
}

fn temporary_key_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("policy-signing-key");
    path.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::now_v7()))
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
