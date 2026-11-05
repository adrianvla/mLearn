use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::Mutex,
};

/// Resource interpretation is declared by the authenticated manifest, not a path.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceKind { BytesV1, KeyValueSqliteV1 }

enum Storage {
    Bytes(Mutex<File>),
    Index { connection: Mutex<Connection>, _snapshot: tempfile::NamedTempFile },
}

/// Private snapshot with no writable handle exposed to runtime callers or guests.
/// Verification and copying use a fixed buffer; the admitted path is never reopened.
pub struct Resource { storage: Storage, size: usize, digest: String }
impl Resource {
    pub fn open(path: &Path, size: usize, digest: &str, kind: ResourceKind) -> Result<Self, String> {
        if size == 0 || size > 128 * 1024 * 1024 || digest.len() != 64 {
            return Err("Resource exceeds supported size or digest contract".into());
        }
        let mut input = File::open(path).map_err(|e| e.to_string())?;
        if input.metadata().map_err(|e| e.to_string())?.len() != size as u64 {
            return Err("Resource size mismatch".into());
        }
        let mut snapshot = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut buffer = [0; 65536];
        let mut copied = 0usize;
        loop {
            let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 { break; }
            copied = copied.checked_add(count).ok_or("Resource size overflow")?;
            if copied > size { return Err("Resource grew during admission".into()); }
            hash.update(&buffer[..count]);
            snapshot.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
        }
        let actual = format!("{:x}", hash.finalize());
        if copied != size || !actual.eq_ignore_ascii_case(digest) { return Err("Resource digest or size mismatch".into()); }
        snapshot.flush().map_err(|e| e.to_string())?;
        let storage = match kind {
            ResourceKind::BytesV1 => Storage::Bytes(Mutex::new(snapshot.into_file())),
            ResourceKind::KeyValueSqliteV1 => {
                let connection = Connection::open_with_flags(snapshot.path(), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| e.to_string())?;
                connection.pragma_update(None, "trusted_schema", false).map_err(|e| e.to_string())?;
                connection.pragma_update(None, "query_only", true).map_err(|e| e.to_string())?;
                connection.pragma_update(None, "cache_size", -2048).map_err(|e| e.to_string())?;
                connection.pragma_update(None, "mmap_size", 0).map_err(|e| e.to_string())?;
                let kind: String = connection.query_row("SELECT type FROM sqlite_schema WHERE name='resource_entries'", [], |r| r.get(0)).map_err(|e| e.to_string())?;
                let columns = connection.prepare("PRAGMA table_info(resource_entries)").map_err(|e| e.to_string())?.query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, u32>(5)?))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
                if kind != "table" || columns != vec![("key".into(), "TEXT".into(), 1), ("value".into(), "BLOB".into(), 0)] {
                    return Err("Indexed resources require an ordinary primary-key TEXT / BLOB table".into());
                }
                Storage::Index { connection: Mutex::new(connection), _snapshot: snapshot }
            }
        };
        Ok(Self { storage, size, digest: actual })
    }
    pub fn size(&self) -> Option<usize> {
        match self.storage { Storage::Bytes(_) => Some(self.size), Storage::Index { .. } => None }
    }
    pub fn digest(&self) -> &str { &self.digest }
    pub fn byte_length(&self) -> usize { self.size }
    pub fn read_at(&self, offset: u64, output: &mut [u8]) -> Result<(), String> {
        if output.len() > 65536 || offset.checked_add(output.len() as u64).is_none_or(|end| end > self.size as u64) {
            return Err("Resource range outside declared size".into());
        }
        match &self.storage {
            Storage::Bytes(file) => {
                let mut file = file.lock().map_err(|_| "Resource lock poisoned")?;
                file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
                file.read_exact(output).map_err(|e| e.to_string())
            }
            Storage::Index { .. } => Err("Resource is not binary".into()),
        }
    }
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        match &self.storage {
            Storage::Index { connection, .. } => connection.lock().map_err(|_| "Resource lock poisoned")?
                .query_row("SELECT substr(value,1,65537) FROM resource_entries WHERE key=?1", [key], |r| r.get(0)).optional().map_err(|e| e.to_string()),
            Storage::Bytes(_) => Err("Resource is not an index".into()),
        }
    }
}
