use mlearn_language_host::{AssetMap, CompiledPlugin};
use serde_json::Value;

fn fixture(body: &str) -> Vec<u8> {
    wat::parse_str(format!(r#"(module
        (memory (export "memory") 1)
        (func (export "mlearn_abi_version") (result i32) i32.const 1)
        (func (export "mlearn_alloc") (param i32) (result i32) i32.const 64)
        (func (export "mlearn_dealloc") (param i32 i32))
        (func (export "mlearn_call") (param i32 i32) (result i64) {body})
    )"#)).unwrap()
}

#[test]
fn runaway_guest_is_stopped_by_fuel() {
    let code = fixture("(loop $forever br $forever) i64.const 0");
    let plugin = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
    let error = plugin.invoke("test::loop", Value::Null).unwrap_err();
    assert!(error.contains("fuel"), "Unexpected failure: {error}");
}

#[test]
fn invalid_guest_pointer_is_an_error_not_a_native_memory_access() {
    let code = fixture("i64.const -4294967295");
    let plugin = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
    assert!(plugin.invoke("test::invalid", Value::Null).is_err());
}

#[test]
fn undeclared_host_imports_are_unavailable() {
    let code = wat::parse_str(r#"(module (import "wasi_snapshot_preview1" "fd_write" (func)))"#).unwrap();
    let plugin = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
    assert!(plugin.invoke("test::escape", Value::Null).is_err());
}

#[test]
fn malformed_binary_is_rejected_before_instantiation() {
    assert!(CompiledPlugin::new(b"not-wasm", AssetMap::new()).is_err());
}

#[test]
fn admission_rejects_compilable_but_unusable_abi_and_initialization() {
    use mlearn_language_host::{ExecutionPolicy, Resources};
    // Given compilable modules with distinct linking, start, ABI and export failures.
    let module = r#"(module
        (memory (export "memory") 1)
        (func (export "mlearn_abi_version") (result i32) i32.const 1)
        (func (export "mlearn_alloc") (param i32) (result i32) i32.const 64)
        (func (export "mlearn_dealloc") (param i32 i32))
        (func (export "mlearn_call") (param i32 i32) (result i64) unreachable)
    )"#;
    let cases = [
        (
            "ABI",
            module.replace("i32.const 1)", "i32.const 2)"),
            ExecutionPolicy::Fresh,
        ),
        (
            "memory",
            module.replace("(export \"memory\")", ""),
            ExecutionPolicy::Fresh,
        ),
        (
            "allocation",
            module.replace("(param i32) (result i32)", "(param i64) (result i32)"),
            ExecutionPolicy::Fresh,
        ),
        (
            "deallocation",
            module.replace("mlearn_dealloc", "missing_free"),
            ExecutionPolicy::Fresh,
        ),
        (
            "call",
            module.replace("mlearn_call", "missing_call"),
            ExecutionPolicy::Fresh,
        ),
        (
            "imports",
            module.replacen(
                "(module",
                "(module (import \"unavailable\" \"function\" (func))",
                1,
            ),
            ExecutionPolicy::Fresh,
        ),
        (
            "start",
            module.replacen(
                "(module",
                "(module (func $start unreachable) (start $start)",
                1,
            ),
            ExecutionPolicy::Fresh,
        ),
        (
            "missing initialization",
            module.to_owned(),
            ExecutionPolicy::PersistentV1,
        ),
        (
            "rejected initialization",
            module.replacen(
                "(module",
                "(module (func (export \"mlearn_initialize\") (result i32) i32.const 1)",
                1,
            ),
            ExecutionPolicy::PersistentV1,
        ),
        (
            "trapped initialization",
            module.replacen(
                "(module",
                "(module (func (export \"mlearn_initialize\") (result i32) unreachable)",
                1,
            ),
            ExecutionPolicy::PersistentV1,
        ),
    ];
    for (name, source, policy) in cases {
        let code = wat::parse_str(source).unwrap();
        let plugin = CompiledPlugin::with_verified_resources(
            &code,
            AssetMap::new(),
            Resources::new(),
            policy,
        )
        .unwrap();
        // When admission checks the real module before any durable installation.
        let result = plugin.validate();
        // Then every unusable contract is rejected without inventing a capability call.
        assert!(result.is_err(), "{name} was admitted");
    }
    // A valid ABI is admissible even though an arbitrary capability call traps.
    let plugin = CompiledPlugin::new(&wat::parse_str(module).unwrap(), AssetMap::new()).unwrap();
    plugin.validate().unwrap();
    assert!(
        plugin
            .invoke("not-an-admission-probe", Value::Null)
            .is_err()
    );
}

#[test]
fn real_sdk_module_runs_with_downloadable_asset() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let path = std::env::var_os("MLEARN_TEST_PLUGIN").map(std::path::PathBuf::from)
        .unwrap_or_else(|| root.join("target/wasm32-unknown-unknown/release/mlearn_example_hello.wasm"));
    let code = std::fs::read(path).expect("Run npm run build:plugin before the native integration tests");
    let assets = [("greeting.json".into(), std::sync::Arc::<[u8]>::from(&b"{\"prefix\":\"Hello, \"}"[..]))].into_iter().collect();
    let plugin = CompiledPlugin::new(&code, assets).unwrap();
    plugin.validate().unwrap();
    assert_eq!(plugin.invoke("example::hello", serde_json::json!({"name":"Adrian"})).unwrap()["message"], "Hello, Adrian!");
    assert_eq!(plugin.invoke("example::hello", serde_json::json!({"name":"アドリアン"})).unwrap()["message"], "Hello, アドリアン!");
    assert!(plugin.invoke("example::hello", serde_json::json!({"name":""})).is_err());
}
#[test]
fn indexed_resource_sizes_are_bounded_and_guest_capacity_is_negotiated(){
 use mlearn_language_host::ResourcePaths;
 let dir=tempfile::tempdir().unwrap();let path=dir.path().join("resource.sqlite");
 let db=rusqlite::Connection::open(&path).unwrap();db.execute_batch("CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL) WITHOUT ROWID").unwrap();
 db.execute("INSERT INTO resource_entries VALUES('key',?1)",[vec![b'x';5000]]).unwrap();drop(db);
 let code=wat::parse_str(r#"(module
 (import "mlearn" "resource_get" (func $get (param i32 i32 i32 i32 i32 i32)(result i32)))
 (memory (export "memory") 1)
 (data(i32.const 0) "dictionary") (data(i32.const 16) "key")
 (data(i32.const 32) "{\22ok\22:true,\22value\22:true}")
 (func(export "mlearn_abi_version")(result i32) i32.const 1)
 (func(export "mlearn_alloc")(param i32)(result i32)i32.const 20000)
 (func(export "mlearn_dealloc")(param i32 i32))
 (func(export "mlearn_call")(param i32 i32)(result i64)
  i32.const 0 i32.const 10 i32.const 16 i32.const 3 i32.const 128 i32.const 4 call $get i32.const 5000 i32.ne
  if i64.const 0 return end
  i32.const 128 i32.load8_u if i64.const 0 return end
  i32.const 0 i32.const 10 i32.const 16 i32.const 3 i32.const 128 i32.const 5000 call $get i32.const 5000 i32.ne
  if i64.const 0 return end
  i32.const 128 i32.load8_u i32.const 120 i32.ne if i64.const 0 return end
  i64.const 137438953496
 ))"#).unwrap();
 let resources=ResourcePaths::from([("dictionary".into(),path)]);
 let plugin=CompiledPlugin::with_resources(&code,AssetMap::new(),resources).unwrap();
 assert_eq!(plugin.invoke("resource.test",Value::Null).unwrap(),Value::Bool(true));
}
