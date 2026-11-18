//! Small, versioned core-Wasm ABI. No language-specific types or native OS imports.
//! ABI v1 is experimental until representative real analyzers pass device benchmarks.
use serde::{Deserialize, Serialize};
pub use serde_json;
pub const ABI_VERSION: u32 = 1;
pub const MAX_MESSAGE_BYTES: usize = 262_144;
pub mod learning;

#[derive(Serialize, Deserialize)]
pub struct Call {
    pub capability: String,
    pub input: serde_json::Value,
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "mlearn")]
unsafe extern "C" {
    fn resource_len(key: *const u8, key_len: usize) -> i64;
    fn resource_digest(key: *const u8, key_len: usize, output: *mut u8) -> i32;
    fn resource_read_at(
        key: *const u8,
        key_len: usize,
        offset: i64,
        output: *mut u8,
        capacity: usize,
    ) -> i32;
    #[link_name = "resource_get"]
    fn host_resource_get(
        resource: *const u8,
        resource_len: usize,
        key: *const u8,
        key_len: usize,
        output: *mut u8,
        capacity: usize,
    ) -> i32;
    #[link_name = "resource_keys"]
    fn host_resource_keys(
        resource: *const u8,
        resource_len: usize,
        prefix: *const u8,
        prefix_len: usize,
        after: *const u8,
        after_len: usize,
        limit: usize,
        output: *mut u8,
        capacity: usize,
    ) -> i32;
    fn asset_len(key: *const u8, key_len: usize) -> i32;
    fn asset_read(key: *const u8, key_len: usize, output: *mut u8, capacity: usize) -> i32;
}

/// Consume an authenticated immutable binary resource through bounded ranges.
/// The expected identity is package-owned; no guest path or SQL is accepted.
pub fn read_resource(
    key: &str,
    expected_size: usize,
    expected_sha256: &str,
) -> Result<Vec<u8>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        if expected_size > 128 * 1024 * 1024 || expected_sha256.len() != 64 {
            return Err("Invalid binary resource expectation".into());
        }
        // SAFETY: the imported host receives live borrowed key and owned output spans.
        let size = unsafe { resource_len(key.as_ptr(), key.len()) };
        let mut digest = [0u8; 64];
        // SAFETY: resource_digest writes at most its fixed 64-byte contract.
        let count = unsafe { resource_digest(key.as_ptr(), key.len(), digest.as_mut_ptr()) };
        if size != expected_size as i64 || count != 64 || digest != expected_sha256.as_bytes() {
            return Err("Authenticated resource identity does not match this plugin".into());
        }
        let mut bytes = vec![0; expected_size];
        for (index, chunk) in bytes.chunks_mut(65536).enumerate() {
            // SAFETY: each output is a disjoint, live initialized chunk of this allocation.
            let count = unsafe {
                resource_read_at(
                    key.as_ptr(),
                    key.len(),
                    (index * 65536) as i64,
                    chunk.as_mut_ptr(),
                    chunk.len(),
                )
            };
            if count != chunk.len() as i32 {
                return Err("Binary resource read failed or exceeded its budget".into());
            }
        }
        Ok(bytes)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (key, expected_size, expected_sha256);
        Err("Resources are supplied by the Wasm host".into())
    }
}

pub fn read_asset(key: &str) -> Result<Vec<u8>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        // SAFETY: host reads only this valid borrowed UTF-8 key; output allocation is owned here.
        let size = unsafe { asset_len(key.as_ptr(), key.len()) };
        if size < 0 || size as usize > 8 * 1024 * 1024 {
            return Err("Asset missing or exceeds SDK limit".into());
        }
        let mut bytes = vec![0; size as usize];
        let written =
            unsafe { asset_read(key.as_ptr(), key.len(), bytes.as_mut_ptr(), bytes.len()) };
        if written != size {
            return Err("Asset read failed".into());
        }
        Ok(bytes)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = key;
        Err("Assets are supplied by the Wasm host".into())
    }
}

/// Exports one batch entry point. The host owns calls to alloc/dealloc; plugin logic owns no host state.
#[macro_export]
macro_rules! export_plugin {
    ($handler:path, $initialize:path) => {
        $crate::export_plugin!($handler);
        #[cfg(target_arch = "wasm32")]
        #[unsafe(no_mangle)]
        pub extern "C" fn mlearn_initialize() -> i32 {
            match $initialize() { Ok(()) => 0, Err(_) => -1 }
        }
    };
    ($handler:path) => {
        #[cfg(target_arch = "wasm32")]
        #[unsafe(no_mangle)]
        pub extern "C" fn mlearn_abi_version() -> u32 { $crate::ABI_VERSION }
        #[cfg(target_arch = "wasm32")]
        #[unsafe(no_mangle)]
        pub extern "C" fn mlearn_alloc(length: u32) -> u32 {
            if length == 0 || length as usize > $crate::MAX_MESSAGE_BYTES { return 0; }
            Box::into_raw(vec![0u8; length as usize].into_boxed_slice()) as *mut u8 as u32
        }
        #[cfg(target_arch = "wasm32")]
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn mlearn_dealloc(pointer: u32, length: u32) {
            if pointer != 0 && length != 0 {
                // SAFETY: ABI host returns only the exact pointer/length allocated by this module.
                unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(pointer as *mut u8, length as usize))); }
            }
        }
        #[cfg(target_arch = "wasm32")]
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn mlearn_call(pointer: u32, length: u32) -> u64 {
            if pointer == 0 || length == 0 || length as usize > $crate::MAX_MESSAGE_BYTES { return 0; }
            // SAFETY: the host allocated and initialized this exact input span through mlearn_alloc.
            let input = unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) };
            let result = $crate::serde_json::from_slice::<$crate::Call>(input)
                .map_err(|e| e.to_string()).and_then($handler);
            let mut value = $crate::serde_json::json!({"ok": result.is_ok()});
            // Move an already serialized tree into its ABI envelope. json!(value)
            // serializes it into another tree, spending guest fuel on a full copy.
            match result {
                Ok(output) => value["value"] = output,
                Err(error) => value["error"] = $crate::serde_json::Value::String(error),
            }
            let Ok(bytes) = $crate::serde_json::to_vec(&value) else { return 0; };
            if bytes.is_empty() || bytes.len() > $crate::MAX_MESSAGE_BYTES { return 0; }
            let len = bytes.len() as u32;
            let ptr = Box::into_raw(bytes.into_boxed_slice()) as *mut u8 as u32;
            ((ptr as u64) << 32) | len as u64
        }
    };
}

/// Read one bounded value from a declared immutable SQLite resource's key index.
/// The host supplies no query language or access to the learner database.
pub fn resource_get(resource: &str, key: &str) -> Result<Option<Vec<u8>>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        let mut bytes = vec![0; 4096];
        // SAFETY: all spans point to live owned/borrowed buffers, with exact lengths.
        let mut count = unsafe {
            host_resource_get(
                resource.as_ptr(),
                resource.len(),
                key.as_ptr(),
                key.len(),
                bytes.as_mut_ptr(),
                bytes.len(),
            )
        };
        if count == -2 {
            return Ok(None);
        }
        if count > bytes.len() as i32 && count <= 65536 {
            bytes.resize(count as usize, 0);
            // SAFETY: same immutable resource/key; the resized output owns this span.
            count = unsafe {
                host_resource_get(
                    resource.as_ptr(),
                    resource.len(),
                    key.as_ptr(),
                    key.len(),
                    bytes.as_mut_ptr(),
                    bytes.len(),
                )
            };
        }
        if count < 0 || count as usize > bytes.len() {
            return Err("Indexed resource unavailable or query/output budget exceeded".into());
        }
        bytes.truncate(count as usize);
        Ok(Some(bytes))
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (resource, key);
        Err("Indexed resources are supplied by the Wasm host".into())
    }
}

/// Bounds shared by the SDK and host's ordered indexed-resource import.
pub const RESOURCE_KEYS_MAX_PAGE_SIZE: usize = 64;
pub const RESOURCE_KEYS_MAX_OUTPUT_BYTES: usize = 131072;

/// Bytewise ordered keys from an immutable, declared indexed resource.
/// `next` is the last returned key when another matching key exists.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceKeyPage {
    pub keys: Vec<String>,
    pub next: Option<String>,
}

/// Enumerate up to 64 nonempty keys, each at most 256 UTF-8 bytes.
/// Prefixes are literal, may be empty, and require a BINARY primary-key index.
/// Pass `next` back as `after`; no offsets, raw SQL or resource paths are accepted.
pub fn resource_keys(
    resource: &str,
    prefix: &str,
    after: Option<&str>,
    limit: usize,
) -> Result<ResourceKeyPage, String> {
    #[cfg(target_arch = "wasm32")]
    {
        read_resource_keys(resource, prefix, after, limit, host_resource_keys)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (resource, prefix, after, limit);
        Err("Indexed resources are supplied by the Wasm host".into())
    }
}

// The same adapter runs against a Rust implementation of the host's span
// contract under Miri; real Wasmi tests separately verify the foreign import.
#[cfg(any(target_arch = "wasm32", test))]
type ResourceKeysImport = unsafe extern "C" fn(
    *const u8,
    usize,
    *const u8,
    usize,
    *const u8,
    usize,
    usize,
    *mut u8,
    usize,
) -> i32;

#[cfg(any(target_arch = "wasm32", test))]
fn read_resource_keys(
    resource: &str,
    prefix: &str,
    after: Option<&str>,
    limit: usize,
    import: ResourceKeysImport,
) -> Result<ResourceKeyPage, String> {
    if resource.is_empty()
        || resource.len() > 256
        || prefix.len() > 256
        || !(1..=RESOURCE_KEYS_MAX_PAGE_SIZE).contains(&limit)
        || after.is_some_and(|key| key.is_empty() || key.len() > 256 || !key.starts_with(prefix))
    {
        return Err("Invalid indexed-resource key window".into());
    }
    let cursor = after.unwrap_or_default();
    let mut bytes = vec![0; RESOURCE_KEYS_MAX_OUTPUT_BYTES];
    // SAFETY: FFI/bounds (8,10): borrowed input spans remain live and immutable.
    // The verified host writes at most capacity into this disjoint owned buffer.
    let count = unsafe {
        import(
            resource.as_ptr(),
            resource.len(),
            prefix.as_ptr(),
            prefix.len(),
            cursor.as_ptr(),
            cursor.len(),
            limit,
            bytes.as_mut_ptr(),
            bytes.len(),
        )
    };
    if count < 0 || count as usize > bytes.len() {
        return Err("Indexed key window unavailable or resource budget exceeded".into());
    }
    let page: ResourceKeyPage =
        serde_json::from_slice(&bytes[..count as usize]).map_err(|error| error.to_string())?;
    if page.keys.len() > limit
        || page.keys.iter().any(|key| {
            key.is_empty()
                || key.len() > 256
                || !key.starts_with(prefix)
                || after.is_some_and(|cursor| key.as_str() <= cursor)
        })
        || page.keys.windows(2).any(|pair| pair[0] >= pair[1])
        || page
            .next
            .as_ref()
            .is_some_and(|next| page.keys.len() != limit || page.keys.last() != Some(next))
    {
        return Err("Malformed indexed-resource key window".into());
    }
    Ok(page)
}

#[cfg(test)]
mod resource_key_tests {
    use super::*;

    unsafe extern "C" fn keys_import(
        resource: *const u8,
        resource_len: usize,
        prefix: *const u8,
        prefix_len: usize,
        after: *const u8,
        after_len: usize,
        limit: usize,
        output: *mut u8,
        capacity: usize,
    ) -> i32 {
        // SAFETY: FFI/bounds (8,10): read_resource_keys supplies live read-only
        // spans and a disjoint initialized capacity-byte allocation for output.
        let (resource, prefix, after, output) = unsafe {
            (
                std::slice::from_raw_parts(resource, resource_len),
                std::slice::from_raw_parts(prefix, prefix_len),
                std::slice::from_raw_parts(after, after_len),
                std::slice::from_raw_parts_mut(output, capacity),
            )
        };
        if prefix != b"entry/" || limit != 2 {
            return -1;
        }
        let bytes: &[u8] = match resource {
            b"fixture" => match after {
                b"" => br#"{"keys":["entry/1","entry/2"],"next":"entry/2"}"#,
                b"entry/2" => br#"{"keys":["entry/3"],"next":null}"#,
                _ => return -1,
            },
            b"duplicate" => br#"{"keys":["entry/1","entry/1"],"next":null}"#,
            b"outside" => br#"{"keys":["other/1"],"next":null}"#,
            b"cursor" => br#"{"keys":["entry/1","entry/2"],"next":"entry/1"}"#,
            b"oversize" => return capacity as i32 + 1,
            b"missing" => return -1,
            _ => b"not JSON",
        };
        if bytes.len() > output.len() {
            return bytes.len() as i32;
        }
        output[..bytes.len()].copy_from_slice(bytes);
        bytes.len() as i32
    }

    #[test]
    fn indexed_key_adapter_preserves_borrowed_spans_and_cursor_progress() {
        let first = read_resource_keys("fixture", "entry/", None, 2, keys_import).unwrap();
        assert_eq!(first.keys, ["entry/1", "entry/2"]);
        assert_eq!(first.next.as_deref(), Some("entry/2"));
        let last =
            read_resource_keys("fixture", "entry/", first.next.as_deref(), 2, keys_import).unwrap();
        assert_eq!(last.keys, ["entry/3"]);
        assert_eq!(last.next, None);
    }

    #[test]
    fn indexed_key_adapter_rejects_invalid_windows_and_host_results() {
        for resource in [
            "duplicate",
            "outside",
            "cursor",
            "oversize",
            "missing",
            "bad-json",
        ] {
            assert!(read_resource_keys(resource, "entry/", None, 2, keys_import).is_err());
        }
        assert!(read_resource_keys("fixture", "entry/", None, 0, keys_import).is_err());
        assert!(read_resource_keys("fixture", "entry/", None, 65, keys_import).is_err());
        assert!(read_resource_keys("fixture", "entry/", Some("outside"), 2, keys_import).is_err());
        assert!(read_resource_keys("fixture", &"x".repeat(257), None, 2, keys_import).is_err());
    }
}
