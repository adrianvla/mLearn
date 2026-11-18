use mlearn_language_sdk::{ResourceKeyPage, RESOURCE_KEYS_MAX_PAGE_SIZE};
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
pub enum ResourceKind {
    BytesV1,
    KeyValueSqliteV1,
}

enum Storage {
    Bytes(Mutex<File>),
    Index {
        connection: Mutex<Connection>,
        binary_keys: bool,
        _snapshot: tempfile::NamedTempFile,
    },
}

/// Private snapshot with no writable handle exposed to runtime callers or guests.
/// Verification and copying use a fixed buffer; the admitted path is never reopened.
pub struct Resource {
    storage: Storage,
    size: usize,
    digest: String,
}
impl Resource {
    pub fn open(
        path: &Path,
        size: usize,
        digest: &str,
        kind: ResourceKind,
    ) -> Result<Self, String> {
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
            if count == 0 {
                break;
            }
            copied = copied.checked_add(count).ok_or("Resource size overflow")?;
            if copied > size {
                return Err("Resource grew during admission".into());
            }
            hash.update(&buffer[..count]);
            snapshot
                .write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
        }
        let actual = format!("{:x}", hash.finalize());
        if copied != size || !actual.eq_ignore_ascii_case(digest) {
            return Err("Resource digest or size mismatch".into());
        }
        snapshot.flush().map_err(|e| e.to_string())?;
        let storage = match kind {
            ResourceKind::BytesV1 => Storage::Bytes(Mutex::new(snapshot.into_file())),
            ResourceKind::KeyValueSqliteV1 => {
                let connection = Connection::open_with_flags(
                    snapshot.path(),
                    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                )
                .map_err(|e| e.to_string())?;
                connection
                    .pragma_update(None, "trusted_schema", false)
                    .map_err(|e| e.to_string())?;
                connection
                    .pragma_update(None, "query_only", true)
                    .map_err(|e| e.to_string())?;
                connection
                    .pragma_update(None, "cache_size", -2048)
                    .map_err(|e| e.to_string())?;
                connection
                    .pragma_update(None, "mmap_size", 0)
                    .map_err(|e| e.to_string())?;
                let kind: String = connection
                    .query_row(
                        "SELECT type FROM sqlite_schema WHERE name='resource_entries'",
                        [],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                let columns = connection
                    .prepare("PRAGMA table_info(resource_entries)")
                    .map_err(|e| e.to_string())?
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, u32>(5)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                if kind != "table"
                    || columns
                        != vec![
                            ("key".into(), "TEXT".into(), 1),
                            ("value".into(), "BLOB".into(), 0),
                        ]
                {
                    return Err(
                        "Indexed resources require an ordinary primary-key TEXT / BLOB table"
                            .into(),
                    );
                }
                let collation: String = connection
                    .query_row(
                        "SELECT x.coll FROM pragma_index_list('resource_entries') i
                     JOIN pragma_index_xinfo(i.name) x
                     WHERE i.origin='pk' AND x.name='key' AND x.\"key\"=1",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                Storage::Index {
                    connection: Mutex::new(connection),
                    binary_keys: collation.eq_ignore_ascii_case("BINARY"),
                    _snapshot: snapshot,
                }
            }
        };
        Ok(Self {
            storage,
            size,
            digest: actual,
        })
    }
    pub fn size(&self) -> Option<usize> {
        match self.storage {
            Storage::Bytes(_) => Some(self.size),
            Storage::Index { .. } => None,
        }
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    pub fn byte_length(&self) -> usize {
        self.size
    }
    pub fn read_at(&self, offset: u64, output: &mut [u8]) -> Result<(), String> {
        if output.len() > 65536
            || offset
                .checked_add(output.len() as u64)
                .is_none_or(|end| end > self.size as u64)
        {
            return Err("Resource range outside declared size".into());
        }
        match &self.storage {
            Storage::Bytes(file) => {
                let mut file = file.lock().map_err(|_| "Resource lock poisoned")?;
                file.seek(SeekFrom::Start(offset))
                    .map_err(|e| e.to_string())?;
                file.read_exact(output).map_err(|e| e.to_string())
            }
            Storage::Index { .. } => Err("Resource is not binary".into()),
        }
    }
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        match &self.storage {
            Storage::Index { connection, .. } => connection
                .lock()
                .map_err(|_| "Resource lock poisoned")?
                .query_row(
                    "SELECT substr(value,1,65537) FROM resource_entries WHERE key=?1",
                    [key],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string()),
            Storage::Bytes(_) => Err("Resource is not an index".into()),
        }
    }
    pub fn keys(
        &self,
        prefix: &str,
        after: Option<&str>,
        limit: usize,
    ) -> Result<ResourceKeyPage, String> {
        if prefix.len() > 256
            || !(1..=RESOURCE_KEYS_MAX_PAGE_SIZE).contains(&limit)
            || after
                .is_some_and(|key| key.is_empty() || key.len() > 256 || !key.starts_with(prefix))
        {
            return Err("Invalid indexed-resource key window".into());
        }
        let Storage::Index {
            connection,
            binary_keys,
            ..
        } = &self.storage
        else {
            return Err("Resource is not an index".into());
        };
        // A differently collated primary key cannot supply a bounded binary
        // range. Keep its existing point lookups, never substitute a full scan.
        if !binary_keys {
            return Err("Ordered keys require a BINARY primary-key index".into());
        }
        let connection = connection.lock().map_err(|_| "Resource lock poisoned")?;
        let (sql, start) = match after {
            Some(key) => ("SELECT substr(CAST(key AS BLOB),1,257) FROM resource_entries WHERE key>?1 ORDER BY key LIMIT ?2", key),
            None => ("SELECT substr(CAST(key AS BLOB),1,257) FROM resource_entries WHERE key>=?1 ORDER BY key LIMIT ?2", prefix),
        };
        let mut statement = connection.prepare_cached(sql).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(rusqlite::params![start, limit + 1], |row| {
                row.get::<_, Vec<u8>>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut keys = Vec::with_capacity(limit + 1);
        for row in rows {
            let bytes = row.map_err(|e| e.to_string())?;
            if !bytes.starts_with(prefix.as_bytes()) {
                break;
            }
            if bytes.is_empty() || bytes.len() > 256 {
                return Err("Indexed resource key exceeds the key contract".into());
            }
            keys.push(String::from_utf8(bytes).map_err(|_| "Indexed resource key is not UTF-8")?);
        }
        let next = if keys.len() > limit {
            keys.truncate(limit);
            keys.last().cloned()
        } else {
            None
        };
        Ok(ResourceKeyPage { keys, next })
    }
}
