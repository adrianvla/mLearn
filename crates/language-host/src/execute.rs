use mlearn_language_sdk::{Call, ABI_VERSION, MAX_MESSAGE_BYTES};
use std::{collections::BTreeMap, sync::{Arc,Mutex},path::PathBuf};
use rusqlite::{Connection,OpenFlags,OptionalExtension};
pub type ResourcePaths = BTreeMap<String,PathBuf>;
use wasmi::{Caller, Config, Engine, Extern, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

pub type AssetMap = BTreeMap<String, Arc<[u8]>>;
const MAX_CODE_BYTES: usize = 4 * 1024 * 1024;
const MEMORY_LIMIT: usize = 64 * 1024 * 1024;
const HOST_READ_BUDGET: usize = 8 * 1024 * 1024;
const FUEL: u64 = 32_000_000;

struct State { assets: Arc<AssetMap>, limits: StoreLimits, read_bytes: usize,resources:Arc<BTreeMap<String,Mutex<Connection>>>, resource_queries:usize }

fn key(caller: &Caller<'_, State>, pointer: i32, length: i32) -> Option<String> {
    if pointer < 0 || !(1..=256).contains(&length) { return None; }
    let memory = caller.get_export("memory")?.into_memory()?;
    let mut bytes = vec![0; length as usize];
    memory.read(caller, pointer as usize, &mut bytes).ok()?;
    String::from_utf8(bytes).ok()
}

/// Compilation is reusable; each invocation has fresh bounded memory and fuel.
/// Stateful tokenizer instance pooling is intentionally outside ABI v1's hello-world proof.
pub struct CompiledPlugin { engine: Engine, module: Module, assets: Arc<AssetMap>,resources:Arc<BTreeMap<String,Mutex<Connection>>> }
impl CompiledPlugin {
    pub fn new(code: &[u8], assets: AssetMap) -> Result<Self, String> {
        Self::with_resources(code,assets,BTreeMap::new())
    }
    pub fn with_resources(code:&[u8], assets:AssetMap, paths:ResourcePaths)->Result<Self,String> {
        let mut resources=BTreeMap::new();
        if paths.len()>8 {return Err("At most eight indexed resources are supported".into());}
        for (key,path) in paths {
            let connection=Connection::open_with_flags(path,OpenFlags::SQLITE_OPEN_READ_ONLY|OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e|e.to_string())?;
            let kind:String=connection.query_row("SELECT type FROM sqlite_schema WHERE name='resource_entries'",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            if kind!="table"{return Err("Indexed resources require an ordinary key/value table".into());}
            let columns=connection.prepare("PRAGMA table_info(resource_entries)").map_err(|e|e.to_string())?.query_map([],|r|Ok((r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,u32>(5)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
            if columns!=vec![("key".into(),"TEXT".into(),1),("value".into(),"BLOB".into(),0)]{return Err("Indexed resources require a primary-key TEXT key and BLOB value".into());}
            connection.pragma_update(None,"trusted_schema",false).map_err(|e|e.to_string())?;
            connection.pragma_update(None,"query_only",true).map_err(|e|e.to_string())?;
            connection.pragma_update(None,"cache_size",-2048).map_err(|e|e.to_string())?;
            connection.prepare("SELECT substr(value,1,65537) FROM resource_entries WHERE key=?1").map_err(|e|e.to_string())?;
            resources.insert(key,Mutex::new(connection));
        }
        if code.len() > MAX_CODE_BYTES { return Err("Plugin module exceeds 4 MiB".into()); }
        if assets.values().map(|v| v.len()).sum::<usize>() > HOST_READ_BUDGET { return Err("Fixture plugin assets exceed 8 MiB".into()); }
        let mut config = Config::default();
        config.consume_fuel(true);
        let engine = Engine::new(&config);
        let module = Module::new(&engine, code).map_err(|e| e.to_string())?;
        Ok(Self { engine, module, assets: Arc::new(assets),resources:Arc::new(resources) })
    }

    pub fn invoke(&self, capability: &str, input: serde_json::Value) -> Result<serde_json::Value, String> {
        let bytes = serde_json::to_vec(&Call { capability: capability.into(), input }).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE_BYTES { return Err("Plugin input exceeds message limit".into()); }
        let limits = StoreLimitsBuilder::new().memory_size(MEMORY_LIMIT).memories(1).instances(1).tables(1).table_elements(4096).trap_on_grow_failure(true).build();
        let mut store = Store::new(&self.engine, State { assets: self.assets.clone(), limits, read_bytes: 0,resources:self.resources.clone(),resource_queries:0 });
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
        // Generic immutable indexed resources, not ambient SQL/database access.
        // Keys, calls and output bytes are bounded per invocation; no guest SQL.
        linker.func_wrap("mlearn","resource_get",|mut caller:Caller<'_,State>,rp:i32,rl:i32,kp:i32,kl:i32,out:i32,cap:i32|->i32 {
            let Some(resource)=key(&caller,rp,rl) else{return -1;};
            let Some(entry)=key(&caller,kp,kl) else{return -1;};
            if out<0 || !(1..=65536).contains(&cap) || caller.data().resource_queries>=1024 {return -1;}
            caller.data_mut().resource_queries+=1;
            let result=(||{
                let db=caller.data().resources.get(&resource)?.lock().ok()?;
                db.query_row("SELECT substr(value,1,65537) FROM resource_entries WHERE key=?1",[entry],|r|r.get::<_,Vec<u8>>(0)).optional().ok()
            })();
            let bytes=match result {Some(Some(v))=>v,Some(None)=>return -2,None=>return -1};
            if bytes.len()>65536 || caller.data().read_bytes+bytes.len()>HOST_READ_BUDGET {return -1;}
            if bytes.len()>cap as usize{return bytes.len() as i32;}
            let Some(memory)=caller.get_export("memory").and_then(Extern::into_memory) else{return -1;};
            caller.data_mut().read_bytes+=bytes.len();
            if memory.write(&mut caller,out as usize,&bytes).is_err(){return -1;}
            bytes.len() as i32
        }).map_err(|e|e.to_string())?;
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
        let started=std::time::Instant::now();
        let outcome=call.call(&mut store,(pointer,bytes.len() as i32));
        if cfg!(debug_assertions) && std::env::var_os("MLEARN_PLUGIN_METRICS").is_some(){eprintln!("plugin-work elapsed_us={} fuel_used={} resource_queries={} resource_bytes={}",started.elapsed().as_micros(),FUEL-store.get_fuel().unwrap_or(0),store.data().resource_queries,store.data().read_bytes);}
        let packed=outcome.map_err(|e|e.to_string())? as u64;
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
