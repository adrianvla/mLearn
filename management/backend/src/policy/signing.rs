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
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{error::AppError, policy::PolicyDocument};

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
    let mut output = Vec::new();
    write_canonical_json(&value, &mut output)?;
    Ok(output)
}

fn write_canonical_json(value: &Value, output: &mut Vec<u8>) -> Result<(), AppError> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_writer(output, value).map_err(|error| {
                AppError::Internal(format!("policy canonicalization failed: {error}"))
            })?;
        }
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_canonical_json(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_unstable_by(|left, right| left.0.cmp(right.0));
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                serde_json::to_writer(&mut *output, key).map_err(|error| {
                    AppError::Internal(format!("policy canonicalization failed: {error}"))
                })?;
                output.push(b':');
                write_canonical_json(value, output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn read_key(path: &Path) -> std::io::Result<SigningKey> {
    if fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(std::io::Error::new(
            ErrorKind::PermissionDenied,
            "refusing policy signing key symlink",
        ));
    }
    #[cfg(unix)]
    fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    let mut bytes = Vec::new();
    OpenOptions::new()
        .read(true)
        .open(path)?
        .read_to_end(&mut bytes)?;
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
    use std::collections::BTreeMap;

    use serde_json::json;

    use crate::policy::{model::PolicyAncestryEntry, LlmPolicy, PolicyDocument, SettingRule};

    use super::PolicySigner;

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
}
