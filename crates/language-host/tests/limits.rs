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
    assert!(plugin.invoke("test::loop", Value::Null).is_err());
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
fn real_sdk_module_runs_when_provided_by_build_step() {
    let Ok(path) = std::env::var("MLEARN_TEST_PLUGIN") else { return; };
    let code = std::fs::read(path).unwrap();
    let assets = [("greeting.json".into(), std::sync::Arc::<[u8]>::from(&b"{\"prefix\":\"Hello, \"}"[..]))].into_iter().collect();
    let plugin = CompiledPlugin::new(&code, assets).unwrap();
    assert_eq!(plugin.invoke("example::hello", serde_json::json!({"name":"Adrian"})).unwrap()["message"], "Hello, Adrian!");
}
