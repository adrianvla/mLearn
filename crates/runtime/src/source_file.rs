use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Read,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

/// Original bytes identify every local source, independently of its presentation.
pub(super) fn revision(
    path: &Path,
    cancellation: &AtomicU64,
    epoch: u64,
) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Source unavailable; reselect the original file: {error}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        if cancellation.load(Ordering::Relaxed) != epoch {
            return Err("Source opening cancelled; saved progress is unchanged".into());
        }
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
