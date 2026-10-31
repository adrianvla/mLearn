use mlearn_language_host::{
    AssetMap, CompiledPlugin, ExecutionPolicy, Resource, ResourceKind, Resources,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn resource(path: &std::path::Path, bytes: &[u8]) -> Resource {
    std::fs::write(path, bytes).unwrap();
    Resource::open(
        path,
        bytes.len(),
        &format!("{:x}", Sha256::digest(bytes)),
        ResourceKind::BytesV1,
    )
    .unwrap()
}
fn indexed_resource(path: &std::path::Path, schema: &str, keys: &[String]) -> Resource {
    let connection = rusqlite::Connection::open(path).unwrap();
    connection.execute_batch(schema).unwrap();
    for key in keys.iter().rev() {
        connection
            .execute(
                "INSERT INTO resource_entries VALUES(?1,?2)",
                rusqlite::params![key, b"entry".as_slice()],
            )
            .unwrap();
    }
    drop(connection);
    let bytes = std::fs::read(path).unwrap();
    Resource::open(
        path,
        bytes.len(),
        &format!("{:x}", Sha256::digest(&bytes)),
        ResourceKind::KeyValueSqliteV1,
    )
    .unwrap()
}
fn persistent(body: &str) -> Vec<u8> {
    wat::parse_str(format!(
        r#"(module
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
    )"#
    ))
    .unwrap()
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
    let plugin = CompiledPlugin::with_verified_resources(
        &code,
        AssetMap::new(),
        Resources::from([("logical".into(), pinned)]),
        ExecutionPolicy::Fresh,
    )
    .unwrap();
    assert_eq!(plugin.invoke("test", Value::Null).unwrap(), json!(true));
}
#[test]
fn single_slot_reuses_evicts_and_cancellation_prevents_publication() {
    let _serial = SERIAL.lock().unwrap();
    // This one ordered scenario is the global slot's contract, not timing-based
    // parallel assertions about private call counts.
    let code = persistent("");
    let a = CompiledPlugin::with_verified_resources(
        &code,
        AssetMap::new(),
        Resources::new(),
        ExecutionPolicy::PersistentV1,
    )
    .unwrap();
    let b = CompiledPlugin::with_verified_resources(
        &code,
        AssetMap::new(),
        Resources::new(),
        ExecutionPolicy::PersistentV1,
    )
    .unwrap();
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(1));
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(2));
    assert_eq!(b.invoke("test", Value::Null).unwrap(), json!(1));
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(1));
    let cancelled = Arc::new(AtomicU64::new(0));
    cancelled.fetch_add(1, Ordering::Relaxed);
    assert!(a
        .invoke_cancellable("test", Value::Null, cancelled, 0)
        .unwrap_err()
        .contains("cancelled"));
    assert_eq!(a.invoke("test", Value::Null).unwrap(), json!(1));
    let fresh = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
    assert_eq!(fresh.invoke("test", Value::Null).unwrap(), json!(1));
    assert_eq!(fresh.invoke("test", Value::Null).unwrap(), json!(1));
    let traps = persistent("global.get $calls i32.const 1 i32.eq if unreachable end");
    let trapping = CompiledPlugin::with_verified_resources(
        &traps,
        AssetMap::new(),
        Resources::new(),
        ExecutionPolicy::PersistentV1,
    )
    .unwrap();
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
    let plugin = CompiledPlugin::with_verified_resources(
        &code,
        AssetMap::new(),
        Resources::new(),
        ExecutionPolicy::PersistentV1,
    )
    .unwrap();
    assert_eq!(plugin.invoke("test", Value::Null).unwrap(), json!(1));
    let excessive = persistent("i32.const 1024 memory.grow i32.const -1 i32.ne if unreachable end");
    let plugin = CompiledPlugin::new(&excessive, AssetMap::new()).unwrap();
    assert_eq!(plugin.invoke("test", Value::Null).unwrap(), json!(1));
}

#[test]
fn real_sdk_rejects_an_authenticated_but_incompatible_dictionary_identity() {
    let _serial = SERIAL.lock().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
    let manifests: Value = serde_json::from_slice(
        &std::fs::read(root.join("bundle.json")).expect("Prepare offline plugins first"),
    )
    .unwrap();
    let manifest = manifests
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "org.mlearn.japanese")
        .unwrap();
    let code = std::fs::read(root.join(manifest["code"]["path"].as_str().unwrap())).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let incompatible = resource(&dir.path().join("different-data"), b"authentic but wrong");
    let plugin = CompiledPlugin::with_verified_resources(
        &code,
        AssetMap::new(),
        Resources::from([("sudachi.dic".into(), incompatible)]),
        ExecutionPolicy::PersistentV1,
    )
    .unwrap();
    assert!(plugin
        .invoke("language.describe.v1", Value::Null)
        .unwrap_err()
        .contains("pinned resources"));

    // Keep the exact size and parseable dictionary structure, but change its
    // timestamp metadata. Size-only admission must not authorize this variant.
    use std::io::{Read, Seek, SeekFrom, Write};
    let dictionary = dir.path().join("different-identity.dic");
    std::fs::copy(
        root.join(manifest["assets"]["sudachi.dic"]["path"].as_str().unwrap()),
        &dictionary,
    )
    .unwrap();
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&dictionary)
        .unwrap();
    file.seek(SeekFrom::Start(8)).unwrap();
    let mut byte = [0];
    file.read_exact(&mut byte).unwrap();
    file.seek(SeekFrom::Start(8)).unwrap();
    file.write_all(&[byte[0] ^ 1]).unwrap();
    drop(file);
    let lexical = dir.path().join("metadata.sqlite");
    let connection = rusqlite::Connection::open(&lexical).unwrap();
    connection
        .execute_batch("CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL)")
        .unwrap();
    connection.execute("INSERT INTO resource_entries VALUES('metadata',?1)", [serde_json::to_vec(&json!({
        "schemaVersion":1,"source":{"sha256":"eb7cb9c5179c23154f3897eddb0f78f2ef374837fcaef0474cf9875d42161d9b"}
    })).unwrap()]).unwrap();
    drop(connection);
    let mut resources = Resources::new();
    for (key, path, kind) in [
        ("sudachi.dic", dictionary, ResourceKind::BytesV1),
        ("lexicon.sqlite", lexical, ResourceKind::KeyValueSqliteV1),
    ] {
        let mut file = std::fs::File::open(&path).unwrap();
        let size = file.metadata().unwrap().len() as usize;
        let mut hash = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            let count = file.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        resources.insert(
            key.into(),
            Resource::open(&path, size, &format!("{:x}", hash.finalize()), kind).unwrap(),
        );
    }
    let plugin = CompiledPlugin::with_verified_resources(
        &code,
        AssetMap::new(),
        resources,
        ExecutionPolicy::PersistentV1,
    )
    .unwrap();
    assert!(plugin
        .invoke("language.describe.v1", Value::Null)
        .unwrap_err()
        .contains("pinned resources"));
}

#[test]
fn indexed_key_pages_are_immutable_bounded_and_binary_ordered() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index.sqlite");
    let mut expected: Vec<String> = (0..68).map(|index| format!("entry/{index:03}")).collect();
    expected.extend(["entry/\0", "entry/%", "entry/_", "entry/漢字"].map(str::to_owned));
    expected.sort();
    let mut input = expected.clone();
    input.extend(["before", "entry0/after", "metadata"].map(str::to_owned));
    let pinned = indexed_resource(
        &path,
        "CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL) WITHOUT ROWID",
        &input,
    );
    std::fs::write(&path, b"changed original").unwrap();
    let mut actual = Vec::new();
    let mut after = None;
    for _ in 0..=expected.len() {
        let page = pinned.keys("entry/", after.as_deref(), 3).unwrap();
        assert!(page.keys.len() <= 3);
        if let Some(next) = page.next.as_ref() {
            assert_eq!(page.keys.last(), Some(next));
        }
        let finished = page.next.is_none();
        actual.extend(page.keys);
        after = page.next;
        if finished {
            break;
        }
    }
    assert_eq!(actual, expected);
    assert_eq!(
        pinned.keys("missing/", None, 3).unwrap().keys,
        Vec::<String>::new()
    );
    assert!(pinned.keys("entry/", None, 0).is_err());
    assert!(pinned.keys("entry/", None, 65).is_err());
    assert!(pinned.keys(&"x".repeat(257), None, 3).is_err());
    assert!(pinned.keys("entry/", Some("metadata"), 3).is_err());
    assert!(pinned.keys("entry/", Some(""), 3).is_err());
}

#[test]
fn indexed_key_pages_reject_unsupported_ordering_and_oversized_keys() {
    let dir = tempfile::tempdir().unwrap();
    let case_insensitive = indexed_resource(
        &dir.path().join("case.sqlite"),
        "CREATE TABLE resource_entries(key TEXT PRIMARY KEY COLLATE NOCASE,value BLOB)",
        &["entry/alpha".into()],
    );
    assert_eq!(
        case_insensitive.get("ENTRY/ALPHA").unwrap(),
        Some(b"entry".to_vec())
    );
    assert!(case_insensitive.keys("entry/", None, 3).is_err());
    let long_key = indexed_resource(
        &dir.path().join("long.sqlite"),
        "CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB)",
        &[format!("entry/{}", "x".repeat(251))],
    );
    assert!(long_key.keys("entry/", None, 3).is_err());
}

fn indexed_key_module(body: &str) -> Vec<u8> {
    let header_length = b"{\"ok\":true,\"value\":".len();
    wat::parse_str(format!(r#"(module
      (import "mlearn" "resource_keys" (func $keys (param i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 3)
      (global $out i32 (i32.const {output}))
      (data (i32.const 0) "lexicon")
      (data (i32.const 32) "entry/")
      (data (i32.const 64) "entry/001")
      (data (i32.const 80) "missing")
      (data (i32.const 96) "metadata")
      (data (i32.const 128) "true")
      (data (i32.const 4096) "{{\22ok\22:true,\22value\22:")
      (func (export "mlearn_abi_version") (result i32) i32.const 1)
      (func (export "mlearn_alloc") (param i32) (result i32) i32.const 1024)
      (func (export "mlearn_dealloc") (param i32 i32))
      (func (export "mlearn_call") (param i32 i32) (result i64)
        (local $length i32) (local $calls i32) (local $status i32)
        {body}
        global.get $out local.get $length i32.add i32.const 125 i32.store8
        i64.const {pointer}
        local.get $length i32.const {overhead} i32.add i64.extend_i32_u i64.or)
    )"#, output = 4096 + header_length, pointer = 4096u64 << 32,
        overhead = header_length + 1)).unwrap()
}

#[test]
fn indexed_key_import_validates_ranges_and_preserves_prefix_cursor_and_limit() {
    let _serial = SERIAL.lock().unwrap();
    let invalid = [
        [-1, 7, 32, 6, 0, 0, 2, 0, 1],
        [80, 7, 32, 6, 0, 0, 2, 0, 1],
        [0, 7, -1, 0, 0, 0, 2, 0, 1],
        [0, 7, 196607, 6, 0, 0, 2, 0, 1],
        [0, 7, 32, 6, -1, 0, 2, 0, 1],
        [0, 7, 32, 6, 0, 0, 0, 0, 1],
        [0, 7, 32, 6, 0, 0, 65, 0, 1],
        [0, 7, 32, 6, 0, 0, 2, 196607, 2],
        [0, 7, 32, 6, 0, 0, 2, 0, 131073],
        [0, 7, 32, 6, 96, 8, 2, 0, 1],
    ]
    .into_iter()
    .map(|arguments| {
        let arguments = arguments
            .map(|value| format!("i32.const {value} "))
            .concat();
        format!("{arguments} call $keys i32.const -1 i32.ne if unreachable end\n")
    })
    .collect::<String>();
    let cases = [
        (
            6,
            0,
            0,
            json!({"keys":["entry/000","entry/001"],"next":"entry/001"}),
        ),
        (6, 64, 9, json!({"keys":["entry/002"],"next":null})),
        (
            0,
            0,
            0,
            json!({"keys":["before","entry/000"],"next":"entry/000"}),
        ),
    ];
    let dir = tempfile::tempdir().unwrap();
    for (index, (prefix_length, after, after_length, expected)) in cases.into_iter().enumerate() {
        let code = indexed_key_module(&format!(
            r#"{invalid}
          i32.const 0 i32.const 7 i32.const 32 i32.const {prefix_length}
          i32.const {after} i32.const {after_length} i32.const 2
          global.get $out i32.const 131072 call $keys local.set $length"#
        ));
        let pinned = indexed_resource(
            &dir.path().join(format!("{index}.sqlite")),
            "CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB)",
            &[
                "before",
                "entry/000",
                "entry/001",
                "entry/002",
                "entry0/after",
                "metadata",
            ]
            .map(str::to_owned),
        );
        let plugin = CompiledPlugin::with_verified_resources(
            &code,
            AssetMap::new(),
            Resources::from([("lexicon".into(), pinned)]),
            ExecutionPolicy::Fresh,
        )
        .unwrap();
        assert_eq!(plugin.invoke("test", Value::Null).unwrap(), expected);
    }
}

#[test]
fn indexed_key_negotiation_obeys_shared_query_and_byte_budgets() {
    let _serial = SERIAL.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let cases = [
        ("queries", vec!["entry/000".to_owned()], 1024, 1024),
        (
            "bytes",
            (0..64)
                .map(|index| format!("entry/{index:02}/{}", "\0".repeat(247)))
                .collect(),
            1,
            128,
        ),
    ];
    for (name, keys, minimum, maximum) in cases {
        let body = format!(
            r#"
          block $done
            loop $next
              i32.const 0 i32.const 7 i32.const 32 i32.const 6
              i32.const 0 i32.const 0 i32.const 64
              global.get $out i32.const 1 call $keys local.tee $status
              i32.const -1 i32.eq br_if $done
              local.get $status i32.const 1 i32.le_s if unreachable end
              local.get $calls i32.const 1 i32.add local.tee $calls
              i32.const 1024 i32.gt_u if unreachable end
              br $next
            end
          end
          local.get $calls i32.const {minimum} i32.lt_u if unreachable end
          local.get $calls i32.const {maximum} i32.gt_u if unreachable end
          global.get $out i32.const 128 i32.const 4 memory.copy
          i32.const 4 local.set $length"#
        );
        let pinned = indexed_resource(
            &dir.path().join(format!("{name}.sqlite")),
            "CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB)",
            &keys,
        );
        let plugin = CompiledPlugin::with_verified_resources(
            &indexed_key_module(&body),
            AssetMap::new(),
            Resources::from([("lexicon".into(), pinned)]),
            ExecutionPolicy::Fresh,
        )
        .unwrap();
        assert_eq!(plugin.invoke("test", Value::Null).unwrap(), json!(true));
    }
}
