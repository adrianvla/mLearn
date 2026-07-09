use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};

use crate::{api_keys::ApiKeyService, error::AppError, identity::Principal, state::AppState};

static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct AuthRateLimiter {
    state: Arc<Mutex<RateLimitState>>,
    max_attempts: usize,
    window: Duration,
    capacity: usize,
}

#[derive(Default)]
struct RateLimitState {
    entries: HashMap<String, RateLimitEntry>,
}

struct RateLimitEntry {
    attempts: usize,
    window_started_at: Instant,
}

impl AuthRateLimiter {
    pub fn new(max_attempts: usize, window: Duration, capacity: usize) -> Self {
        Self {
            state: Arc::new(Mutex::new(RateLimitState::default())),
            max_attempts,
            window,
            capacity,
        }
    }

    pub fn check(&self, key: &str) -> Result<(), AppError> {
        self.check_at(key, Instant::now())
    }

    fn check_at(&self, key: &str, now: Instant) -> Result<(), AppError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::Internal("auth rate limiter lock poisoned".into()))?;
        state.entries.retain(|_, entry| {
            now.saturating_duration_since(entry.window_started_at) < self.window
        });

        if !state.entries.contains_key(key) && state.entries.len() >= self.capacity {
            return Err(AppError::TooManyRequests);
        }

        let entry = state
            .entries
            .entry(key.to_string())
            .or_insert(RateLimitEntry {
                attempts: 0,
                window_started_at: now,
            });
        if entry.attempts >= self.max_attempts {
            return Err(AppError::TooManyRequests);
        }
        entry.attempts += 1;
        Ok(())
    }

    #[cfg(test)]
    fn entry_count(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.entries.len())
            .unwrap_or_default()
    }
}

pub fn hash_token(token: &str) -> [u8; 32] {
    let digest = Sha256::digest(token.as_bytes());
    let mut hash = [0_u8; 32];
    hash.copy_from_slice(&digest);
    hash
}

pub fn hash_token_hex(token: &str) -> String {
    hex::encode(hash_token(token))
}

pub fn verify_token(provided: &str, expected_hash: &[u8; 32]) -> bool {
    if provided.is_empty() {
        return false;
    }

    let provided_hash = hash_token(provided);
    provided_hash.ct_eq(expected_hash).into()
}

pub fn verify_token_hex(provided: &str, expected_hash_hex: &str) -> bool {
    let decoded = match hex::decode(expected_hash_hex) {
        Ok(decoded) => decoded,
        Err(_) => return false,
    };

    let expected_hash: [u8; 32] = match decoded.try_into() {
        Ok(expected_hash) => expected_hash,
        Err(_) => return false,
    };

    verify_token(provided, &expected_hash)
}

pub fn extract_bearer(auth_header: &str) -> Option<&str> {
    let token = auth_header.strip_prefix("Bearer ")?;

    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

pub fn generate_random_token() -> String {
    let mut random_bytes = [0_u8; 32];

    if File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut random_bytes))
        .is_ok()
    {
        return hex::encode(random_bytes);
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let process_id = std::process::id();
    let counter = TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);

    let mut hasher = Sha256::new();
    hasher.update(now.to_le_bytes());
    hasher.update(process_id.to_le_bytes());
    hasher.update(counter.to_le_bytes());
    hex::encode(hasher.finalize())
}

impl FromRequestParts<AppState> for Principal {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let access_token = extract_bearer(auth_header).ok_or(AppError::Unauthorized)?;
        if access_token.starts_with("mlsk_") {
            return ApiKeyService::new(state.db.clone())
                .authenticate(access_token)
                .await;
        }
        state
            .identity
            .principal_from_access_token(access_token)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn hash_token_matches_known_sha256() {
        assert_eq!(
            hash_token_hex("test"),
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn hash_token_hex_matches_raw_hash() {
        assert_eq!(
            hash_token_hex("admin-token"),
            hex::encode(hash_token("admin-token"))
        );
    }

    #[test]
    fn verify_token_accepts_only_matching_token() {
        let expected = hash_token("correct-token");

        assert!(verify_token("correct-token", &expected));
        assert!(!verify_token("wrong-token", &expected));
        assert!(!verify_token("", &expected));
        assert!(!verify_token("correct-token", &[0; 32]));
    }

    #[test]
    fn verify_token_hex_handles_valid_and_invalid_hashes() {
        let expected = hash_token_hex("correct-token");

        assert!(verify_token_hex("correct-token", &expected));
        assert!(!verify_token_hex("wrong-token", &expected));
        assert!(!verify_token_hex("correct-token", "not-valid-hex"));
        assert!(!verify_token_hex("correct-token", "abcd"));
    }

    #[test]
    fn extract_bearer_accepts_only_bearer_prefix_with_token() {
        assert_eq!(extract_bearer("Bearer abc123"), Some("abc123"));
        assert_eq!(extract_bearer("Bearer  xyz"), Some(" xyz"));
        assert_eq!(extract_bearer("Basic abc"), None);
        assert_eq!(extract_bearer(""), None);
        assert_eq!(extract_bearer("Bearer"), None);
        assert_eq!(extract_bearer("Bearer "), None);
        assert_eq!(extract_bearer(" Bearer abc"), None);
        assert_eq!(extract_bearer("Bearer abc "), Some("abc "));
    }

    #[test]
    fn generate_random_token_returns_unique_hex_tokens() {
        let first = generate_random_token();
        let second = generate_random_token();

        assert_eq!(first.len(), 64);
        assert_eq!(second.len(), 64);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert!(second
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn auth_rate_limiter_enforces_limits_stays_bounded_and_cleans_expired_entries() {
        let limiter = AuthRateLimiter::new(2, Duration::from_secs(60), 2);
        let now = Instant::now();

        assert!(limiter.check_at("first", now).is_ok());
        assert!(limiter.check_at("first", now).is_ok());
        assert!(limiter.check_at("first", now).is_err());
        assert!(limiter.check_at("second", now).is_ok());
        assert!(limiter.check_at("third", now).is_err());
        assert!(limiter.check_at("first", now).is_err());
        assert_eq!(limiter.entry_count(), 2);

        assert!(limiter
            .check_at("after-window", now + Duration::from_secs(61))
            .is_ok());
        assert_eq!(limiter.entry_count(), 1);
    }
}
