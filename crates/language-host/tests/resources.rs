use mlearn_language_host::{AssetMap, CompiledPlugin, ExecutionPolicy, Resource, ResourceKind, Resources};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn resource(path: &std::path::Path, bytes: &[u8]) -> Resource {
    std::fs::write(path, bytes).unwrap();
    Resource::open(path, bytes.len(), &format!("{:x}", Sha256::digest(bytes)), ResourceKind::BytesV1).unwrap()
}
fn persistent(body: &str) -> Vec<u8> {
    wat::parse_str(format!(r#"(module
      (memory (export "memory") 1)
      (global $calls (mut i32) (i32.const 0))
      (data (i32.const 64) "{{\22ok\22:true,\22value\22:1}}")
      (func (export "mlearn_abi_version") (result i32) i32.const 1)
      (func (export "mlearn_initialize") (result i32) i32.const 0)
      (func (export "mlearn_alloc") (param i32) (result i32) i32.const 1024)
      (func (export "mlearn_dealloc") (param i32 i32))
      (func (export "mlearn_call") (param i32 i32) (result i64)
        {body}
        global.get $calls i32.const 1 i32.add global.set $calls
        i32.const 83 global.get $calls i32.const 48 i32.add i32.store8
        i64.const 274877906965)
    )"#)).unwrap()
}
#[test]
fn snapshots_reject_tampering_and_do_not_reopen_mutable_paths() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("asset");
    let pinned = resource(&path, b"original");
    std::fs::write(&path, b"tampered").unwrap();
    let mut bytes = [0; 8];
    pinned.read_at(0, &mut bytes).unwrap();
    assert_eq!(&bytes, b"original");
    assert!(Resource::open(&path, 8, pinned.digest(), ResourceKind::BytesV1).is_err());
    assert!(pinned.read_at(u64::MAX, &mut bytes).is_err());
    assert!(pinned.read_at(1, &mut bytes).is_err());
    assert!(pinned.get("arbitrary SQL").is_err());
}
#[test]
fn resource_offsets_destinations_and_identity_are_bounded_through_wasm() {
    let _serial = SERIAL.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let pinned = resource(&dir.path().join("asset"), b"original");
    let code = wat::parse_str(r#"(module
      (import "mlearn" "resource_read_at" (func $read (param i32 i32 i64 i32 i32) (result i32)))
      (import "mlearn" "resource_len" (func $len (param i32 i32) (result i64)))
      (memory (export "memory") 1)
      (data (i32.const 0) "logical")
      (data (i32.const 16) "../escape")
      (data (i32.const 64) "{\22ok\22:true,\22value\22:true}")
      (func (export "mlearn_abi_version") (result i32) i32.const 1)
      (func (export "mlearn_alloc") (param i32) (result i32) i32.const 1024)
      (func (export "mlearn_dealloc") (param i32 i32))
      (func (export "mlearn_call") (param i32 i32) (result i64)
       i32.const 16 i32.const 9 call $len i64.const -1 i64.ne if unreachable end
       i32.const 0 i32.const 7 i64.const -1 i32.const 128 i32.const 1 call $read i32.const -1 i32.ne if unreachable end
       i32.const 0 i32.const 7 i64.const 9223372036854775807 i32.const 128 i32.const 8 call $read i32.const -1 i32.ne if unreachable end
       i32.const 0 i32.const 7 i64.const 0 i32.const 65535 i32.const 8 call $read i32.const -1 i32.ne if unreachable end
       i32.const 0 i32.const 7 i64.const 0 i32.const 128 i32.const 65537 call $read i32.const -1 i32.ne if unreachable end
       i32.const 0 i32.const 7 i64.const 0 i32.const 128 i32.const 8 call $read i32.const 8 i32.ne if unreachable end
       i32.const 128 i32.load8_u i32.const 111 i32.ne if unreachable end
       i64.const 274877906968)
    )"#).unwrap();
    let plugin = CompiledPlugin::with_verified_resources(&code, AssetMap::new(), Resources::from([("logical".into(), pinned)]), ExecutionPolicy::Fresh).unwrap();
    assert_eq!(plugin.invoke("test", Value::Null).unwrap(), json!(true));
}
#[test]
fn single_slot_reuses_evicts_and_cancellation_prevents_publication() {
    let _serial = SERIAL.lock().unwrap();
    // This one ordered scenario is the global slot's contract, not timing-based
    // parallel assertions about private call counts.
    let code = persistent("");
    let a = CompiledPlugin::with_verified_resources(&code, AssetMap::new(), Resources::new(), ExecutionPolicy::PersistentV1).unwrap();
    let b = CompiledPlugin::with_verified_resources(&code, AssetMap::new(), Resources::new(), ExecutionPolicy::PersistentV1).unwrap();
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(1));
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(2));
    assert_eq!(b.invoke("test", Value::Null).unwrap(), json!(1));
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(1));
    let cancelled = Arc::new(AtomicU64::new(0));
    cancelled.fetch_add(1, Ordering::Relaxed);
    assert!(a.invoke_cancellable("test", Value::Null, cancelled, 0).unwrap_err().contains("cancelled"));
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(1));
    let fresh = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
    assert_eq!(fresh.invoke("test", Value::Null).unwrap(), json!(1));
    assert_eq!(fresh.invoke("test", Value::Null).unwrap(), json!(1));
    let traps = persistent("global.get $calls i32.const 1 i32.eq if unreachable end");
    let trapping = CompiledPlugin::with_verified_resources(&traps, AssetMap::new(), Resources::new(), ExecutionPolicy::PersistentV1).unwrap();
    assert_eq!(trapping.invoke("test", Value::Null).unwrap(), json!(1));
    assert!(trapping.invoke("test", Value::Null).is_err());
    assert_eq!(trapping.invoke("test", Value::Null).unwrap(), json!(1));
}
#[test]
fn memory_growth_resumes_fuel_without_relaxing_the_memory_ceiling() {
    let _serial = SERIAL.lock().unwrap();
    // Growing 128 MiB needs more than one fuel slice in Wasmi 2. The earlier
    // trap_on_grow_failure setting turned this legitimate suspension into a trap.
    let code = persistent("i32.const 2048 memory.grow i32.const -1 i32.eq if unreachable end");
    let plugin = CompiledPlugin::with_verified_resources(&code, AssetMap::new(), Resources::new(), ExecutionPolicy::PersistentV1).unwrap();
    assert_eq!(plugin.invoke("test", Value::Null).unwrap(), json!(1));
    let excessive = persistent("i32.const 1024 memory.grow i32.const -1 i32.ne if unreachable end");
    let plugin = CompiledPlugin::new(&excessive, AssetMap::new()).unwrap();
    assert_eq!(plugin.invoke("test", Value::Null).unwrap(), json!(1));
}

#[test]
fn real_sdk_rejects_an_authenticated_but_incompatible_dictionary_identity() {
    let _serial = SERIAL.lock().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Value = serde_json::from_slice(&std::fs::read(root.join("bundle.json")).expect("Prepare offline plugins first")).unwrap();
    let manifest = manifests.as_array().unwrap().iter().find(|m| m["id"] == "org.mlearn.japanese").unwrap();
    let code = std::fs::read(root.join(manifest["code"]["path"].as_str().unwrap())).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let incompatible = resource(&dir.path().join("different-data"), b"authentic but wrong");
    let plugin = CompiledPlugin::with_verified_resources(&code, AssetMap::new(), Resources::from([("sudachi.dic".into(), incompatible)]), ExecutionPolicy::PersistentV1).unwrap();
    assert!(plugin.invoke("language.describe.v1", Value::Null).unwrap_err().contains("pinned resources"));

    // Keep the exact size and parseable dictionary structure, but change its
    // timestamp metadata. Size-only admission must not authorize this variant.
    use std::io::{Read, Seek, SeekFrom, Write};
    let dictionary = dir.path().join("different-identity.dic");
    std::fs::copy(root.join(manifest["assets"]["sudachi.dic"]["path"].as_str().unwrap()), &dictionary).unwrap();
    let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&dictionary).unwrap();
    file.seek(SeekFrom::Start(8)).unwrap();
    let mut byte = [0];
    file.read_exact(&mut byte).unwrap();
    file.seek(SeekFrom::Start(8)).unwrap();
    file.write_all(&[byte[0] ^ 1]).unwrap();
    drop(file);
    let lexical = dir.path().join("metadata.sqlite");
    let connection = rusqlite::Connection::open(&lexical).unwrap();
    connection.execute_batch("CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL)").unwrap();
    connection.execute("INSERT INTO resource_entries VALUES('metadata',?1)", [serde_json::to_vec(&json!({
        "schemaVersion":1,"source":{"sha256":"eb7cb9c5179c23154f3897eddb0f78f2ef374837fcaef0474cf9875d42161d9b"}
    })).unwrap()]).unwrap();
    drop(connection);
    let mut resources = Resources::new();
    for (key, path, kind) in [("sudachi.dic", dictionary, ResourceKind::BytesV1), ("lexicon.sqlite", lexical, ResourceKind::KeyValueSqliteV1)] {
        let mut file = std::fs::File::open(&path).unwrap();
        let size = file.metadata().unwrap().len() as usize;
        let mut hash = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            let count = file.read(&mut buffer).unwrap();
            if count == 0 { break; }
            hash.update(&buffer[..count]);
        }
        resources.insert(key.into(), Resource::open(&path, size, &format!("{:x}", hash.finalize()), kind).unwrap());
    }
    let plugin = CompiledPlugin::with_verified_resources(&code, AssetMap::new(), resources, ExecutionPolicy::PersistentV1).unwrap();
    assert!(plugin.invoke("language.describe.v1", Value::Null).unwrap_err().contains("pinned resources"));
}
