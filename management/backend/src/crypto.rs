use std::{path::Path, sync::Arc};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use secrecy::{ExposeSecret, SecretBox};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::{error::AppError, secret_file};

const ENVELOPE_VERSION: &str = "v1";
const NONCE_LEN: usize = 12;

#[derive(Clone)]
pub struct SecretCipher {
    key: Arc<SecretBox<[u8; 32]>>,
}

pub struct EncryptedSecret(String);

impl EncryptedSecret {
    pub(crate) fn parse(value: String) -> Result<Self, AppError> {
        let encrypted = Self(value);
        encrypted.parts()?;
        Ok(encrypted)
    }

    pub(crate) fn as_persisted(&self) -> &str {
        &self.0
    }

    fn parts(&self) -> Result<([u8; NONCE_LEN], Vec<u8>), AppError> {
        let mut parts = self.0.split('.');
        let version = parts.next();
        let nonce = parts.next();
        let ciphertext = parts.next();
        if version != Some(ENVELOPE_VERSION)
            || nonce.is_none()
            || ciphertext.is_none()
            || parts.next().is_some()
        {
            return Err(AppError::Internal(
                "encrypted secret envelope is malformed".into(),
            ));
        }
        let nonce: [u8; NONCE_LEN] = URL_SAFE_NO_PAD
            .decode(nonce.unwrap())
            .map_err(|_| AppError::Internal("encrypted secret envelope is malformed".into()))?
            .try_into()
            .map_err(|_| AppError::Internal("encrypted secret envelope is malformed".into()))?;
        let ciphertext = URL_SAFE_NO_PAD
            .decode(ciphertext.unwrap())
            .map_err(|_| AppError::Internal("encrypted secret envelope is malformed".into()))?;
        if ciphertext.len() < 16 {
            return Err(AppError::Internal(
                "encrypted secret envelope is malformed".into(),
            ));
        }
        Ok((nonce, ciphertext))
    }
}

impl SecretCipher {
    pub fn from_key(key: [u8; 32]) -> Self {
        Self {
            key: Arc::new(SecretBox::new(Box::new(key))),
        }
    }

    pub fn load_or_generate(path: impl AsRef<Path>) -> Result<Self, AppError> {
        Ok(Self::from_key(secret_file::load_or_generate_32(
            path.as_ref(),
            "management encryption key",
        )?))
    }

    pub fn from_encoded_key(value: &str) -> Result<Self, AppError> {
        let trimmed = value.trim();
        let bytes = if let Some(hex_value) = trimmed.strip_prefix("hex:") {
            hex::decode(hex_value).ok()
        } else if let Some(base64_value) = trimmed.strip_prefix("base64url:") {
            URL_SAFE_NO_PAD.decode(base64_value).ok()
        } else {
            return Err(AppError::Internal(
                "MLEARN_ENCRYPTION_KEY must use hex: or base64url: encoding".into(),
            ));
        }
        .map(Zeroizing::new)
        .ok_or_else(|| AppError::Internal("MLEARN_ENCRYPTION_KEY is malformed".into()))?;
        let key = bytes.as_slice().try_into().map_err(|_| {
            AppError::Internal("MLEARN_ENCRYPTION_KEY must decode to 32 bytes".into())
        })?;
        Ok(Self::from_key(key))
    }

    pub fn encrypt(
        &self,
        plaintext: &[u8],
        associated_data: &[u8],
    ) -> Result<EncryptedSecret, AppError> {
        let cipher = Aes256Gcm::new_from_slice(self.key.expose_secret())
            .map_err(|_| AppError::Internal("encryption key initialization failed".into()))?;
        let mut nonce = [0_u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: associated_data,
                },
            )
            .map_err(|_| AppError::Internal("secret encryption failed".into()))?;
        Ok(EncryptedSecret(format!(
            "{ENVELOPE_VERSION}.{}.{}",
            URL_SAFE_NO_PAD.encode(nonce),
            URL_SAFE_NO_PAD.encode(ciphertext)
        )))
    }

    pub fn decrypt(
        &self,
        encrypted: &EncryptedSecret,
        associated_data: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>, AppError> {
        let (nonce, ciphertext) = encrypted.parts()?;
        let cipher = Aes256Gcm::new_from_slice(self.key.expose_secret())
            .map_err(|_| AppError::Internal("encryption key initialization failed".into()))?;
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: associated_data,
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| AppError::Internal("secret authentication failed".into()))
    }

    pub(crate) fn idempotency_fingerprint(&self, domain: &str, parts: &[&str]) -> Vec<u8> {
        use hmac::{Hmac, Mac};

        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.key.expose_secret())
            .expect("HMAC accepts a 32-byte deployment key");
        mac.update(b"mlearn:secret-idempotency:v1\0");
        mac.update(&(domain.len() as u64).to_be_bytes());
        mac.update(domain.as_bytes());
        for part in parts {
            mac.update(&(part.len() as u64).to_be_bytes());
            mac.update(part.as_bytes());
        }
        mac.finalize().into_bytes().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{Arc, Barrier},
        thread,
    };

    use super::SecretCipher;

    fn unique_key_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "mlearn-encryption-{label}-{}",
            uuid::Uuid::now_v7()
        ))
    }

    #[test]
    fn ciphertext_round_trips_and_tampering_fails() {
        let cipher = SecretCipher::from_key([7_u8; 32]);
        let encrypted = cipher.encrypt(b"provider-key", b"provider:openai").unwrap();
        assert!(!encrypted.as_persisted().contains("provider-key"));
        assert_eq!(
            cipher
                .decrypt(&encrypted, b"provider:openai")
                .unwrap()
                .as_slice(),
            b"provider-key"
        );
        assert!(cipher.decrypt(&encrypted, b"provider:other").is_err());
    }

    #[test]
    fn random_nonces_make_repeated_encryption_distinct() {
        let cipher = SecretCipher::from_key([9_u8; 32]);
        let first = cipher.encrypt(b"same", b"provider:one").unwrap();
        let second = cipher.encrypt(b"same", b"provider:one").unwrap();
        assert_ne!(first.as_persisted(), second.as_persisted());
    }

    #[test]
    fn malformed_or_modified_envelopes_fail_closed() {
        let cipher = SecretCipher::from_key([5_u8; 32]);
        assert!(super::EncryptedSecret::parse("v2.bad.bad".into()).is_err());
        let original = cipher.encrypt(b"secret", b"provider:one").unwrap();
        let mut changed = original.as_persisted().as_bytes().to_vec();
        let ciphertext_start = changed
            .iter()
            .enumerate()
            .filter(|(_, byte)| **byte == b'.')
            .nth(1)
            .unwrap()
            .0
            + 1;
        changed[ciphertext_start] = if changed[ciphertext_start] == b'A' {
            b'B'
        } else {
            b'A'
        };
        let changed = super::EncryptedSecret::parse(String::from_utf8(changed).unwrap()).unwrap();
        assert!(cipher.decrypt(&changed, b"provider:one").is_err());
    }

    #[test]
    fn deployment_key_persists_and_reloads() {
        let path = unique_key_path("reload");
        let first = SecretCipher::load_or_generate(&path).unwrap();
        let encrypted = first.encrypt(b"persisted", b"test:key").unwrap();
        let second = SecretCipher::load_or_generate(&path).unwrap();
        assert_eq!(
            second.decrypt(&encrypted, b"test:key").unwrap().as_slice(),
            b"persisted"
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn concurrent_key_creation_converges_without_rotation() {
        let path = unique_key_path("concurrent");
        let barrier = Arc::new(Barrier::new(8));
        let handles = (0..8)
            .map(|_| {
                let barrier = barrier.clone();
                let path = path.clone();
                thread::spawn(move || {
                    barrier.wait();
                    SecretCipher::load_or_generate(path).unwrap()
                })
            })
            .collect::<Vec<_>>();
        let ciphers = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        let encrypted = ciphers[0].encrypt(b"shared", b"test:key").unwrap();
        assert!(ciphers
            .iter()
            .all(|cipher| cipher.decrypt(&encrypted, b"test:key").is_ok()));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn malformed_key_fails_without_being_replaced() {
        let path = unique_key_path("malformed");
        fs::write(&path, b"not-a-32-byte-key").unwrap();
        assert!(SecretCipher::load_or_generate(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"not-a-32-byte-key");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn non_regular_key_path_is_rejected() {
        let path = unique_key_path("directory");
        fs::create_dir(&path).unwrap();
        assert!(SecretCipher::load_or_generate(&path).is_err());
        fs::remove_dir(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn generated_key_is_mode_0600_and_symlinks_are_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let path = unique_key_path("permissions");
        SecretCipher::load_or_generate(&path).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
            0o600
        );

        let link = unique_key_path("symlink");
        symlink(&path, &link).unwrap();
        assert!(SecretCipher::load_or_generate(&link).is_err());
        fs::remove_file(link).unwrap();
        fs::remove_file(path).unwrap();
    }
}
