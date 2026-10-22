use crate::StorageError;
use mlearn_core::{MaterialContent, SourceLocator};
use sha2::{Digest, Sha256};

pub(crate) struct Identity {
    pub exact: Vec<u8>,
    pub capture: Vec<u8>,
}

pub(crate) fn identity(content: &MaterialContent) -> Result<Identity, StorageError> {
    match &content.target_id {
        Some(target) => {
            // A selected sense is a snapshot scoped to its package and target.
            let capture = Sha256::digest(serde_json::to_vec(&(
                &content.package_id,
                target,
                &content.sense,
            ))?)
            .to_vec();
            let mut source = content.source.clone();
            if let Some(anchor) = &mut source {
                match &mut anchor.locator {
                    SourceLocator::Video {
                        position_ms,
                        subtitle_offset_ms,
                        playback_rate,
                        ..
                    } => {
                        *position_ms = 0;
                        *subtitle_offset_ms = 0;
                        *playback_rate = 1.0;
                    }
                }
            }
            let exact = Sha256::digest(serde_json::to_vec(&(
                &capture,
                &content.package_revision,
                source,
            ))?)
            .to_vec();
            Ok(Identity { exact, capture })
        }
        None => {
            // Manual material has no inferred linguistic identity.
            let exact = Sha256::digest(serde_json::to_vec(content)?).to_vec();
            Ok(Identity {
                capture: exact.clone(),
                exact,
            })
        }
    }
}

pub(crate) fn digest(operation: &str, payload: &[u8]) -> Vec<u8> {
    let mut hash = Sha256::new();
    hash.update(operation.as_bytes());
    hash.update([0]);
    hash.update(payload);
    hash.finalize().to_vec()
}
