use crate::{execution::Failure, media_import::io_failure};
use mlearn_core::{AuthoredMedia, AuthoredMediaId, MaterialMediaImport};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

const ASSET_BYTES: u64 = 128 * 1024 * 1024;

pub(super) fn same_bytes(first: &Path, second: &Path) -> Result<bool, Failure> {
    let second = match fs::File::open(second) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(io_failure(e)),
    };
    let mut first = fs::File::open(first).map_err(io_failure)?;
    let mut second = second;
    let mut a = [0; 65536];
    let mut b = [0; 65536];
    loop {
        let x = first.read(&mut a).map_err(io_failure)?;
        let y = second.read(&mut b).map_err(io_failure)?;
        if x != y || a[..x] != b[..y] {
            return Ok(false);
        }
        if x == 0 {
            return Ok(true);
        }
    }
}

pub(super) fn copy_asset(
    import: &MaterialMediaImport,
    destination: &Path,
) -> Result<(AuthoredMedia, u64), Failure> {
    let mut input = fs::File::open(&import.path).map_err(io_failure)?;
    let before = input.metadata().map_err(io_failure)?;
    if !before.is_file() || before.len() == 0 || before.len() > ASSET_BYTES {
        return Err(Failure::Operation(
            "Select an ordinary media file up to 128 MiB".into(),
        ));
    }
    let mut output = fs::File::create(destination).map_err(io_failure)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    let mut header = Vec::new();
    let mut bytes = 0u64;
    loop {
        let count = input.read(&mut buffer).map_err(io_failure)?;
        if count == 0 {
            break;
        }
        if header.is_empty() {
            header.extend_from_slice(&buffer[..count.min(16)]);
        }
        bytes = bytes
            .checked_add(u64::try_from(count).map_err(|e| Failure::Operation(e.to_string()))?)
            .ok_or_else(|| Failure::Operation("Media size overflow".into()))?;
        if bytes > ASSET_BYTES {
            return Err(Failure::Operation("Media exceeds 128 MiB".into()));
        }
        output.write_all(&buffer[..count]).map_err(io_failure)?;
        hash.update(&buffer[..count]);
    }
    let after = input.metadata().map_err(io_failure)?;
    if before.len() != after.len()
        || bytes != before.len()
        || before.modified().map_err(io_failure)? != after.modified().map_err(io_failure)?
    {
        return Err(Failure::Operation(
            "Media changed while copying; select it again".into(),
        ));
    }
    output.sync_all().map_err(io_failure)?;
    let mime_type = super::media_format::mime(&header, import.kind)?;
    Ok((
        AuthoredMedia {
            id: AuthoredMediaId(format!("media-{:x}", hash.finalize())),
            kind: import.kind,
            name: import.name.clone(),
            mime_type: mime_type.into(),
            byte_length: u32::try_from(bytes).map_err(|e| Failure::Operation(e.to_string()))?,
        },
        bytes,
    ))
}
