//! Small, versioned core-Wasm ABI. No language-specific types or native OS imports.
//! ABI v1 is experimental until representative real analyzers pass device benchmarks.
use serde::{Deserialize, Serialize};
pub use serde_json;
pub const ABI_VERSION: u32 = 1;
pub const MAX_MESSAGE_BYTES: usize = 262_144;

#[derive(Serialize, Deserialize)]
pub struct Call {
    pub capability: String,
    pub input: serde_json::Value,
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "mlearn")]
unsafe extern "C" {
    #[link_name="resource_get"]
    fn host_resource_get(resource:*const u8,resource_len:usize,key:*const u8,key_len:usize,output:*mut u8,capacity:usize)->i32;
    fn asset_len(key: *const u8, key_len: usize) -> i32;
    fn asset_read(key: *const u8, key_len: usize, output: *mut u8, capacity: usize) -> i32;
}

pub fn read_asset(key: &str) -> Result<Vec<u8>, String> {
    #[cfg(target_arch = "wasm32")]
    {
        // SAFETY: host reads only this valid borrowed UTF-8 key; output allocation is owned here.
        let size = unsafe { asset_len(key.as_ptr(), key.len()) };
        if size < 0 || size as usize > 8 * 1024 * 1024 { return Err("Asset missing or exceeds SDK limit".into()); }
        let mut bytes = vec![0; size as usize];
        let written = unsafe { asset_read(key.as_ptr(), key.len(), bytes.as_mut_ptr(), bytes.len()) };
        if written != size { return Err("Asset read failed".into()); }
        Ok(bytes)
    }
    #[cfg(not(target_arch = "wasm32"))]
    { let _ = key; Err("Assets are supplied by the Wasm host".into()) }
}

/// Exports one batch entry point. The host owns calls to alloc/dealloc; plugin logic owns no host state.
#[macro_export]
macro_rules! export_plugin {
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
            let value = match result {
                Ok(value) => $crate::serde_json::json!({"ok": true, "value": value}),
                Err(error) => $crate::serde_json::json!({"ok": false, "error": error}),
            };
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
pub fn resource_get(resource:&str,key:&str)->Result<Option<Vec<u8>>,String> {
 #[cfg(target_arch="wasm32")] {
  let mut bytes=vec![0;4096];
  // SAFETY: all spans point to live owned/borrowed buffers, with exact lengths.
  let mut count=unsafe {host_resource_get(resource.as_ptr(),resource.len(),key.as_ptr(),key.len(),bytes.as_mut_ptr(),bytes.len())};
  if count==-2{return Ok(None);}
  if count>bytes.len() as i32 && count<=65536 {
   bytes.resize(count as usize,0);
   // SAFETY: same immutable resource/key; the resized output owns this span.
   count=unsafe{host_resource_get(resource.as_ptr(),resource.len(),key.as_ptr(),key.len(),bytes.as_mut_ptr(),bytes.len())};
  }
  if count<0 || count as usize>bytes.len(){return Err("Indexed resource unavailable or query/output budget exceeded".into());}
  bytes.truncate(count as usize);Ok(Some(bytes))
 }
 #[cfg(not(target_arch="wasm32"))] {let _=(resource,key);Err("Indexed resources are supplied by the Wasm host".into())}
}
