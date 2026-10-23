//! Desktop-only inference. A dedicated Rust worker owns the optional native
//! runtime and its model sessions so terminating it releases every allocation
//! and loaded library before signed resources are replaced or removed.
pub mod beam;
pub mod ctc;
pub mod detector;
pub mod manga;
pub mod manga_pixels;
pub mod pdf;
pub mod raster;
mod raster_helper;
pub mod session;
pub mod worker;

pub(crate) fn bounded_text(path: &std::path::Path, limit: u64) -> Result<String, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut text = String::new();
    file.take(limit + 1)
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    if text.len() as u64 > limit {
        return Err("Native OCR metadata exceeds its byte bound".into());
    }
    Ok(text)
}

/// Bound persisted provider/cache identity to the shipped native executor,
/// including resolved dependencies, instead of the replaced Python script.
pub fn executor_revision() -> &'static str {
    static REVISION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    REVISION.get_or_init(|| {
        use sha2::{Digest, Sha256};
        let mut digest = Sha256::new();
        for bytes in [
            include_bytes!("lib.rs").as_slice(),
            include_bytes!("worker.rs").as_slice(),
            include_bytes!("beam.rs").as_slice(),
            include_bytes!("ctc.rs").as_slice(),
            include_bytes!("detector.rs").as_slice(),
            include_bytes!("manga.rs").as_slice(),
            include_bytes!("manga_pixels.rs").as_slice(),
            include_bytes!("session.rs").as_slice(),
            include_bytes!("raster.rs").as_slice(),
            include_bytes!("raster_helper.rs").as_slice(),
            include_bytes!("pdf.rs").as_slice(),
            include_bytes!("../Cargo.toml").as_slice(),
            include_bytes!("../../../Cargo.lock").as_slice(),
        ] {
            digest.update((bytes.len() as u64).to_le_bytes());
            digest.update(bytes);
        }
        format!("{digest:x}", digest = digest.finalize())
    })
}
