use mlearn_language_sdk::{Call, ABI_VERSION, MAX_MESSAGE_BYTES};
use std::{collections::BTreeMap, sync::Arc};
use wasmi::{Caller, Config, Engine, Extern, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

pub type AssetMap = BTreeMap<String, Arc<[u8]>>;
const MAX_CODE_BYTES: usize = 4 * 1024 * 1024;
const MEMORY_LIMIT: usize = 64 * 1024 * 1024;
const HOST_READ_BUDGET: usize = 8 * 1024 * 1024;
const FUEL: u64 = 2_000_000;

struct State { assets: Arc<AssetMap>, limits: StoreLimits, read_bytes: usize }

fn key(caller: &Caller<'_, State>, pointer: i32, length: i32) -> Option<String> {
    if pointer < 0 || !(1..=256).contains(&length) { return None; }
    let memory = caller.get_export("memory")?.into_memory()?;
    let mut bytes = vec![0; length as usize];
    memory.read(caller, pointer as usize, &mut bytes).ok()?;
    String::from_utf8(bytes).ok()
}

/// Compilation is reusable; each invocation has fresh bounded memory and fuel.
/// Stateful tokenizer instance pooling is intentionally outside ABI v1's hello-world proof.
pub struct CompiledPlugin { engine: Engine, module: Module, assets: Arc<AssetMap> }
impl CompiledPlugin {
    pub fn new(code: &[u8], assets: AssetMap) -> Result<Self, String> {
        if code.len() > MAX_CODE_BYTES { return Err("Plugin module exceeds 4 MiB".into()); }
        if assets.values().map(|v| v.len()).sum::<usize>() > HOST_READ_BUDGET { return Err("Fixture plugin assets exceed 8 MiB".into()); }
        let mut config = Config::default();
        config.consume_fuel(true);
        let engine = Engine::new(&config);
        let module = Module::new(&engine, code).map_err(|e| e.to_string())?;
        Ok(Self { engine, module, assets: Arc::new(assets) })
    }

    pub fn invoke(&self, capability: &str, input: serde_json::Value) -> Result<serde_json::Value, String> {
        let bytes = serde_json::to_vec(&Call { capability: capability.into(), input }).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE_BYTES { return Err("Plugin input exceeds message limit".into()); }
        let limits = StoreLimitsBuilder::new().memory_size(MEMORY_LIMIT).memories(1).instances(1).tables(1).table_elements(4096).trap_on_grow_failure(true).build();
        let mut store = Store::new(&self.engine, State { assets: self.assets.clone(), limits, read_bytes: 0 });
        store.limiter(|state| &mut state.limits);
        store.set_fuel(FUEL).map_err(|e| e.to_string())?;
        let mut linker = Linker::<State>::new(&self.engine);
        linker.func_wrap("mlearn", "asset_len", |caller: Caller<'_, State>, pointer: i32, length: i32| -> i32 {
            let Some(key) = key(&caller, pointer, length) else { return -1; };
            caller.data().assets.get(&key).map(|value| value.len() as i32).unwrap_or(-1)
        }).map_err(|e| e.to_string())?;
        linker.func_wrap("mlearn", "asset_read", |mut caller: Caller<'_, State>, pointer: i32, length: i32, output: i32, capacity: i32| -> i32 {
            let Some(key) = key(&caller, pointer, length) else { return -1; };
            let Some(asset) = caller.data().assets.get(&key).cloned() else { return -1; };
            if output < 0 || capacity < 0 || asset.len() > capacity as usize || caller.data().read_bytes.saturating_add(asset.len()) > HOST_READ_BUDGET { return -1; }
            let Some(memory) = caller.get_export("memory").and_then(Extern::into_memory) else { return -1; };
            caller.data_mut().read_bytes += asset.len();
            if memory.write(&mut caller, output as usize, &asset).is_err() { return -1; }
            asset.len() as i32
        }).map_err(|e| e.to_string())?;
        // Start functions are also fuel/memory-limited. No filesystem, network or WASI imports exist.
        let instance = linker.instantiate_and_start(&mut store, &self.module).map_err(|e| e.to_string())?;
        let abi = instance.get_typed_func::<(), i32>(&store, "mlearn_abi_version").map_err(|e| e.to_string())?.call(&mut store, ()).map_err(|e| e.to_string())?;
        if abi != ABI_VERSION as i32 { return Err("Plugin ABI mismatch".into()); }
        let memory = instance.get_memory(&store, "memory").ok_or("Plugin memory export missing")?;
        let alloc = instance.get_typed_func::<i32, i32>(&store, "mlearn_alloc").map_err(|e| e.to_string())?;
        let dealloc = instance.get_typed_func::<(i32, i32), ()>(&store, "mlearn_dealloc").map_err(|e| e.to_string())?;
        let call = instance.get_typed_func::<(i32, i32), i64>(&store, "mlearn_call").map_err(|e| e.to_string())?;
        let pointer = alloc.call(&mut store, bytes.len() as i32).map_err(|e| e.to_string())?;
        if pointer <= 0 { return Err("Plugin input allocation failed".into()); }
        memory.write(&mut store, pointer as usize, &bytes).map_err(|e| e.to_string())?;
        let packed = call.call(&mut store, (pointer, bytes.len() as i32)).map_err(|e| e.to_string())? as u64;
        let output_pointer = (packed >> 32) as u32;
        let output_length = packed as u32;
        if output_pointer == 0 || output_length == 0 || output_length as usize > MAX_MESSAGE_BYTES { return Err("Plugin returned an invalid output span".into()); }
        let mut output = vec![0; output_length as usize];
        memory.read(&store, output_pointer as usize, &mut output).map_err(|e| e.to_string())?;
        dealloc.call(&mut store, (output_pointer as i32, output_length as i32)).map_err(|e| e.to_string())?;
        dealloc.call(&mut store, (pointer, bytes.len() as i32)).map_err(|e| e.to_string())?;
        let reply: serde_json::Value = serde_json::from_slice(&output).map_err(|e| e.to_string())?;
        match reply.get("ok").and_then(serde_json::Value::as_bool) {
            Some(true) => reply.get("value").cloned().ok_or_else(|| "Plugin response has no value".into()),
            Some(false) => Err(reply.get("error").and_then(serde_json::Value::as_str).unwrap_or("Plugin operation failed").chars().take(512).collect()),
            None => Err("Malformed plugin response".into()),
        }
    }
}
