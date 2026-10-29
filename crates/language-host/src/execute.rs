use crate::{Resource, ResourceKind};
use mlearn_language_sdk::{
    ABI_VERSION, Call, MAX_MESSAGE_BYTES, RESOURCE_KEYS_MAX_OUTPUT_BYTES,
    RESOURCE_KEYS_MAX_PAGE_SIZE,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Read,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        TryLockError,
    },
    time::{Duration, Instant},
};
use wasmi::{
    Caller, Config, Engine, Extern, Instance, Linker, Module, Store, StoreLimits,
    StoreLimitsBuilder, TypedFunc, TypedResumableCall, WasmParams, WasmResults,
};

pub type AssetMap = BTreeMap<String, Arc<[u8]>>;
pub type ResourcePaths = BTreeMap<String, PathBuf>;
pub type Resources = BTreeMap<String, Resource>;

/// Scoped callers must not wait on another executor's process-global guest.
#[derive(Debug)]
pub enum InvocationError {
    Busy,
    Operation(String),
}
impl InvocationError {
    pub fn is_busy(&self) -> bool { matches!(self, Self::Busy) }
}
impl From<String> for InvocationError {
    fn from(message: String) -> Self { Self::Operation(message) }
}
impl std::fmt::Display for InvocationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy => f.write_str("Native language execution is busy; retry the action"),
            Self::Operation(message) => f.write_str(message),
        }
    }
}
impl std::error::Error for InvocationError {}
const HOST_READ_BUDGET: usize = 8 * 1024 * 1024;
const CALL_FUEL: u64 = 32_000_000;
const FUEL_SLICE: u64 = 1_000_000;

/// Host policy, never arbitrary budgets supplied by a guest.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionPolicy {
    #[default]
    Fresh,
    PersistentV1,
}
impl ExecutionPolicy {
    fn memory(self) -> usize {
        // Actual pinned cold/warm guest high-water: 138,805,248 bytes.
        // 160 MiB leaves bounded tokenizer/batch headroom, not the prior 256 MiB experiment.
        match self {
            Self::Fresh => 64 * 1024 * 1024,
            Self::PersistentV1 => 160 * 1024 * 1024,
        }
    }
    fn initialization_fuel(self) -> u64 {
        // Host-attested initialization uses 255,954,738 fuel. Keep 50% headroom;
        // reintroducing the redundant interpreted dictionary hash must not fit.
        match self {
            Self::Fresh => CALL_FUEL,
            Self::PersistentV1 => 384_000_000,
        }
    }
    fn call_fuel(self) -> u64 {
        // The full 13-span reference batch exceeds the fixture's 32M ceiling;
        // per-span measurements and the bounded batch justify a separate allowance.
        match self {
            Self::Fresh => CALL_FUEL,
            Self::PersistentV1 => 64_000_000,
        }
    }
}

struct State {
    assets: Arc<AssetMap>,
    resources: Arc<Resources>,
    limits: StoreLimits,
    read_bytes: usize,
    read_limit: usize,
    resource_queries: usize,
    range_calls: usize,
    metrics_enabled: bool,
    resource_elapsed: Duration,
    cancellation: Arc<AtomicU64>,
    epoch: u64,
    operation: Option<Arc<AtomicBool>>,
    fuel_remaining: u64,
    fuel_granted: u64,
}
impl State {
    fn check(&self) -> Result<(), String> {
        if self.cancellation.load(Ordering::Relaxed) == self.epoch
            && self.operation.as_ref().is_none_or(|flag| !flag.load(Ordering::Acquire))
        {
            Ok(())
        } else {
            Err("Plugin execution cancelled".into())
        }
    }
}
fn key(caller: &Caller<'_, State>, pointer: i32, length: i32) -> Option<String> {
    if pointer < 0 || !(1..=256).contains(&length) {
        return None;
    }
    let memory = caller.get_export("memory")?.into_memory()?;
    let mut bytes = vec![0; length as usize];
    memory.read(caller, pointer as usize, &mut bytes).ok()?;
    String::from_utf8(bytes).ok()
}
fn optional_key(caller: &Caller<'_, State>, pointer: i32, length: i32) -> Option<String> {
    if length == 0 && pointer >= 0 {
        let memory = caller.get_export("memory")?.into_memory()?;
        memory.read(caller, pointer as usize, &mut []).ok()?;
        Some(String::new())
    } else {
        key(caller, pointer, length)
    }
}

struct Active {
    owner: u64,
    store: Store<State>,
    instance: Instance,
}
// One global slot across all profiles/RuntimeBridge objects. No per-source pool.
static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);

/// Compilation owns immutable resources. Execution is globally serialized, lazy,
/// and evicted on switch, shutdown, malformed replies, guest error, trap or cancel.
pub struct CompiledPlugin {
    owner: u64,
    engine: Engine,
    module: Module,
    assets: Arc<AssetMap>,
    resources: Arc<Resources>,
    policy: ExecutionPolicy,
}
impl Drop for CompiledPlugin {
    fn drop(&mut self) {
        let mut slot = ACTIVE.lock().unwrap_or_else(|poison| poison.into_inner());
        if slot
            .as_ref()
            .is_some_and(|active| active.owner == self.owner)
        {
            slot_metrics(self.owner, "evict", "owner-drop");
            *slot = None;
        }
    }
}
impl CompiledPlugin {
    pub fn new(code: &[u8], assets: AssetMap) -> Result<Self, String> {
        Self::with_resources(code, assets, BTreeMap::new())
    }
    /// SDK fixture convenience. Production admission supplies pinned Resources.
    pub fn with_resources(
        code: &[u8],
        assets: AssetMap,
        paths: ResourcePaths,
    ) -> Result<Self, String> {
        let mut resources = Resources::new();
        for (key, path) in paths {
            let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            let size = usize::try_from(file.metadata().map_err(|e| e.to_string())?.len())
                .map_err(|e| e.to_string())?;
            if size > 32 * 1024 * 1024 {
                return Err("Fixture index exceeds 32 MiB".into());
            }
            let mut hash = Sha256::new();
            let mut buffer = [0; 65536];
            loop {
                let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            resources.insert(
                key,
                Resource::open(
                    &path,
                    size,
                    &format!("{:x}", hash.finalize()),
                    ResourceKind::KeyValueSqliteV1,
                )?,
            );
        }
        Self::with_verified_resources(code, assets, resources, ExecutionPolicy::Fresh)
    }
    pub fn with_verified_resources(
        code: &[u8],
        assets: AssetMap,
        resources: Resources,
        policy: ExecutionPolicy,
    ) -> Result<Self, String> {
        if code.len() > 4 * 1024 * 1024 {
            return Err("Plugin module exceeds 4 MiB".into());
        }
        if assets.values().map(|v| v.len()).sum::<usize>() > HOST_READ_BUDGET || resources.len() > 8
        {
            return Err("Plugin resource count or small asset budget exceeded".into());
        }
        let resource_budget = match policy {
            ExecutionPolicy::Fresh => 40 * 1024 * 1024,
            ExecutionPolicy::PersistentV1 => 256 * 1024 * 1024,
        };
        if resources.values().map(Resource::byte_length).sum::<usize>() > resource_budget {
            return Err("Plugin immutable resources exceed aggregate budget".into());
        }
        let mut config = Config::default();
        config.consume_fuel(true);
        // Wasmi 2 lazy translation can surface its internal out-of-fuel error
        // outside the resumable handle. Compile bounded validated code eagerly;
        // execution fuel then measures guest work and remains cancellable.
        config.compilation_mode(wasmi::CompilationMode::Eager);
        let engine = Engine::new(&config);
        let module = Module::new(&engine, code).map_err(|e| e.to_string())?;
        Ok(Self {
            owner: NEXT_OWNER.fetch_add(1, Ordering::Relaxed),
            engine,
            module,
            assets: Arc::new(assets),
            resources: Arc::new(resources),
            policy,
        })
    }

    fn instantiate(
        &self,
        cancellation: Arc<AtomicU64>,
        epoch: u64,
        operation: Option<Arc<AtomicBool>>,
    ) -> Result<Active, String> {
        // Wasmi 2's trap_on_grow_failure also converts resumable fuel exhaustion
        // during memory.grow into a terminal limit trap. Keep ordinary Wasm
        // failed-growth semantics; the same hard byte/count ceilings still apply.
        let limits = StoreLimitsBuilder::new()
            .memory_size(self.policy.memory())
            .memories(1)
            .instances(1)
            .tables(1)
            .table_elements(4096)
            .build();
        let mut store = Store::new(
            &self.engine,
            State {
                assets: self.assets.clone(),
                resources: self.resources.clone(),
                limits,
                read_bytes: 0,
                read_limit: HOST_READ_BUDGET,
                resource_queries: 0,
                range_calls: 0,
                metrics_enabled: std::env::var_os("MLEARN_PLUGIN_METRICS").is_some(),
                resource_elapsed: Duration::ZERO,
                cancellation,
                epoch,
                operation,
                fuel_remaining: 0,
                fuel_granted: CALL_FUEL,
            },
        );
        store.limiter(|s| &mut s.limits);
        store.data().check()?;
        store.set_fuel(CALL_FUEL).map_err(|e| e.to_string())?;
        let mut linker = Linker::<State>::new(&self.engine);
        linker
            .func_wrap(
                "mlearn",
                "asset_len",
                |caller: Caller<'_, State>, p: i32, l: i32| -> i32 {
                    if caller.data().check().is_err() { return -1; }
                    let Some(key) = key(&caller, p, l) else {
                        return -1;
                    };
                    caller
                        .data()
                        .assets
                        .get(&key)
                        .map_or(-1, |a| a.len() as i32)
                },
            )
            .map_err(|e| e.to_string())?;
        linker
            .func_wrap(
                "mlearn",
                "asset_read",
                |mut caller: Caller<'_, State>, p: i32, l: i32, out: i32, cap: i32| -> i32 {
                    let Some(key) = key(&caller, p, l) else {
                        return -1;
                    };
                    let Some(asset) = caller.data().assets.get(&key).cloned() else {
                        return -1;
                    };
                    if out < 0
                        || cap < 0
                        || asset.len() > cap as usize
                        || caller.data().read_bytes + asset.len() > caller.data().read_limit
                        || caller.data().check().is_err()
                    {
                        return -1;
                    }
                    let Some(memory) = caller.get_export("memory").and_then(Extern::into_memory)
                    else {
                        return -1;
                    };
                    caller.data_mut().read_bytes += asset.len();
                    if memory.write(&mut caller, out as usize, &asset).is_err() {
                        return -1;
                    }
                    asset.len() as i32
                },
            )
            .map_err(|e| e.to_string())?;
        linker
            .func_wrap(
                "mlearn",
                "resource_len",
                |caller: Caller<'_, State>, p: i32, l: i32| -> i64 {
                    if caller.data().check().is_err() { return -1; }
                    let Some(key) = key(&caller, p, l) else {
                        return -1;
                    };
                    caller
                        .data()
                        .resources
                        .get(&key)
                        .and_then(Resource::size)
                        .map_or(-1, |s| s as i64)
                },
            )
            .map_err(|e| e.to_string())?;
        linker
            .func_wrap(
                "mlearn",
                "resource_digest",
                |mut caller: Caller<'_, State>, p: i32, l: i32, out: i32| -> i32 {
                    if caller.data().check().is_err() { return -1; }
                    let Some(key) = key(&caller, p, l) else {
                        return -1;
                    };
                    let resources = caller.data().resources.clone();
                    let Some(resource) = resources.get(&key) else {
                        return -1;
                    };
                    if out < 0 {
                        return -1;
                    }
                    let Some(memory) = caller.get_export("memory").and_then(Extern::into_memory)
                    else {
                        return -1;
                    };
                    if memory
                        .write(&mut caller, out as usize, resource.digest().as_bytes())
                        .is_err()
                    {
                        return -1;
                    }
                    64
                },
            )
            .map_err(|e| e.to_string())?;
        linker
            .func_wrap(
                "mlearn",
                "resource_read_at",
                |mut caller: Caller<'_, State>,
                 p: i32,
                 l: i32,
                 offset: i64,
                 out: i32,
                 cap: i32|
                 -> i32 {
                    let Some(key) = key(&caller, p, l) else {
                        return -1;
                    };
                    if offset < 0
                        || out < 0
                        || !(1..=65536).contains(&cap)
                        || caller.data().range_calls >= 4096
                        || caller.data().read_bytes + cap as usize > caller.data().read_limit
                        || caller.data().check().is_err()
                    {
                        return -1;
                    }
                    caller.data_mut().range_calls += 1;
                    let resources = caller.data().resources.clone();
                    let Some(resource) = resources.get(&key) else {
                        return -1;
                    };
                    let Some(memory) = caller.get_export("memory").and_then(Extern::into_memory)
                    else {
                        return -1;
                    };
                    // Validate guest output before touching host storage, then fill guest
                    // memory directly: no second dictionary-sized host allocation.
                    let started = caller.data().metrics_enabled.then(Instant::now);
                    let Some(output) = memory
                        .data_mut(&mut caller)
                        .get_mut(out as usize..out as usize + cap as usize)
                    else {
                        return -1;
                    };
                    let result = resource.read_at(offset as u64, output);
                    if let Some(started) = started {
                        caller.data_mut().resource_elapsed += started.elapsed();
                    }
                    if result.is_err() || caller.data().check().is_err() {
                        return -1;
                    }
                    caller.data_mut().read_bytes += cap as usize;
                    cap
                },
            )
            .map_err(|e| e.to_string())?;
        linker
            .func_wrap(
                "mlearn",
                "resource_get",
                |mut caller: Caller<'_, State>,
                 rp: i32,
                 rl: i32,
                 kp: i32,
                 kl: i32,
                 out: i32,
                 cap: i32|
                 -> i32 {
                    let Some(resource) = key(&caller, rp, rl) else {
                        return -1;
                    };
                    let Some(entry) = key(&caller, kp, kl) else {
                        return -1;
                    };
                    if out < 0
                        || !(1..=65536).contains(&cap)
                        || caller.data().resource_queries >= 1024
                        || caller.data().check().is_err()
                    {
                        return -1;
                    }
                    caller.data_mut().resource_queries += 1;
                    let started = caller.data().metrics_enabled.then(Instant::now);
                    let result = caller
                        .data()
                        .resources
                        .get(&resource)
                        .ok_or_else(|| "Undeclared resource".to_owned())
                        .and_then(|r| r.get(&entry));
                    if let Some(started) = started {
                        caller.data_mut().resource_elapsed += started.elapsed();
                    }
                    let bytes = match result {
                        Ok(Some(v)) => v,
                        Ok(None) => return -2,
                        Err(_) => return -1,
                    };
                    if caller.data().check().is_err()
                        || bytes.len() > 65536
                        || caller.data().read_bytes + bytes.len() > caller.data().read_limit
                    {
                        return -1;
                    }
                    // Charge even capacity negotiation: repeated too-small buffers do not
                    // escape the aggregate host work budget.
                    caller.data_mut().read_bytes += bytes.len();
                    if bytes.len() > cap as usize {
                        return bytes.len() as i32;
                    }
                    let Some(memory) = caller.get_export("memory").and_then(Extern::into_memory)
                    else {
                        return -1;
                    };
                    if memory.write(&mut caller, out as usize, &bytes).is_err() {
                        return -1;
                    }
                    bytes.len() as i32
                },
            )
            .map_err(|e| e.to_string())?;
        linker
            .func_wrap(
                "mlearn",
                "resource_keys",
                |mut caller: Caller<'_, State>,
                 rp: i32,
                 rl: i32,
                 pp: i32,
                 pl: i32,
                 ap: i32,
                 al: i32,
                 limit: i32,
                 out: i32,
                 cap: i32|
                 -> i32 {
                    let Some(resource) = key(&caller, rp, rl) else {
                        return -1;
                    };
                    let Some(prefix) = optional_key(&caller, pp, pl) else {
                        return -1;
                    };
                    let Some(after) = optional_key(&caller, ap, al) else {
                        return -1;
                    };
                    if out < 0
                        || cap < 1
                        || cap as usize > RESOURCE_KEYS_MAX_OUTPUT_BYTES
                        || limit < 1
                        || limit as usize > RESOURCE_KEYS_MAX_PAGE_SIZE
                        || caller.data().resource_queries >= 1024
                        || caller.data().check().is_err()
                    {
                        return -1;
                    }
                    let Some(memory) = caller.get_export("memory").and_then(Extern::into_memory)
                    else {
                        return -1;
                    };
                    let Some(end) = (out as usize).checked_add(cap as usize) else {
                        return -1;
                    };
                    // Reject invalid destinations before native SQL or allocation.
                    if memory.data(&caller).get(out as usize..end).is_none() {
                        return -1;
                    }
                    caller.data_mut().resource_queries += 1;
                    let started = caller.data().metrics_enabled.then(Instant::now);
                    let result = caller
                        .data()
                        .resources
                        .get(&resource)
                        .ok_or_else(|| "Undeclared resource".to_owned())
                        .and_then(|resource| {
                            resource.keys(
                                &prefix,
                                (!after.is_empty()).then_some(after.as_str()),
                                limit as usize,
                            )
                        })
                        .and_then(|page| {
                            serde_json::to_vec(&page).map_err(|error| error.to_string())
                        });
                    if let Some(started) = started {
                        caller.data_mut().resource_elapsed += started.elapsed();
                    }
                    let Ok(bytes) = result else {
                        return -1;
                    };
                    if bytes.len() > RESOURCE_KEYS_MAX_OUTPUT_BYTES
                        || caller.data().read_bytes + bytes.len() > caller.data().read_limit
                    {
                        return -1;
                    }
                    // Negotiation consumes the same query/output budget as a write.
                    caller.data_mut().read_bytes += bytes.len();
                    if caller.data().check().is_err() {
                        return -1;
                    }
                    if bytes.len() > cap as usize {
                        return bytes.len() as i32;
                    }
                    if memory.write(&mut caller, out as usize, &bytes).is_err() {
                        return -1;
                    }
                    bytes.len() as i32
                },
            )
            .map_err(|e| e.to_string())?;
        // Start functions have the small default allowance; substantial setup
        // belongs to the explicit resumable initialization export.
        store.data().check()?;
        let instance = linker
            .instantiate_and_start(&mut store, &self.module)
            .map_err(|e| e.to_string())?;
        store.data().check()?;
        let abi = instance
            .get_typed_func::<(), i32>(&store, "mlearn_abi_version")
            .map_err(|e| e.to_string())?
            .call(&mut store, ())
            .map_err(|e| e.to_string())?;
        store.data().check()?;
        if abi != ABI_VERSION as i32 {
            return Err("Plugin ABI mismatch".into());
        }
        if self.policy == ExecutionPolicy::PersistentV1 {
            let initialize = instance
                .get_typed_func::<(), i32>(&store, "mlearn_initialize")
                .map_err(|e| e.to_string())?;
            reset(
                &mut store,
                self.policy.initialization_fuel(),
                128 * 1024 * 1024,
            )?;
            let started = Instant::now();
            let status = run(&mut store, initialize, ());
            metrics(
                &store,
                self.owner,
                "initialize",
                "mlearn_initialize",
                started,
                status.as_ref().is_ok_and(|status| *status == 0),
            );
            if std::env::var_os("MLEARN_PLUGIN_METRICS").is_some()
                && let Some(memory) = instance.get_memory(&store, "memory")
            {
                eprintln!(
                    "plugin-initialize-memory owner={} bytes={}",
                    self.owner,
                    memory.data_size(&store)
                );
            }
            if status? != 0 {
                return Err("Plugin initialization rejected its pinned resources".into());
            }
        } else {
            // Fresh start/ABI work consumes the same finite allowance. Transfer
            // only its remainder to resumable slices so cancellation is checked
            // between slices without granting the startup fuel a second time.
            let remaining = store.get_fuel().map_err(|e| e.to_string())?;
            store.data_mut().fuel_remaining = remaining;
            store.data_mut().fuel_granted = CALL_FUEL - remaining;
            store.set_fuel(0).map_err(|e| e.to_string())?;
        }
        slot_metrics(self.owner, "initialize", "instance-ready");
        Ok(Active {
            owner: self.owner,
            store,
            instance,
        })
    }

    /// Checks linking, ABI exports and guest initialization before durable activation.
    /// Uses the single execution slot; successful persistent initialization is reused.
    ///
    /// # Errors
    /// Returns an error for incompatible imports/exports, ABI, limits or initialization.
    pub fn validate(&self) -> Result<(), String> {
        let mut slot = ACTIVE
            .lock()
            .map_err(|_| "Plugin execution owner was poisoned")?;
        if let Some(active) = slot.as_ref() {
            slot_metrics(active.owner, "evict", "validation");
        }
        *slot = None;
        let active = self.instantiate(Arc::new(AtomicU64::new(0)), 0, None)?;
        active
            .instance
            .get_memory(&active.store, "memory")
            .ok_or("Plugin memory export missing")?;
        active
            .instance
            .get_typed_func::<i32, i32>(&active.store, "mlearn_alloc")
            .map_err(|e| e.to_string())?;
        active
            .instance
            .get_typed_func::<(i32, i32), ()>(&active.store, "mlearn_dealloc")
            .map_err(|e| e.to_string())?;
        active
            .instance
            .get_typed_func::<(i32, i32), i64>(&active.store, "mlearn_call")
            .map_err(|e| e.to_string())?;
        if self.policy == ExecutionPolicy::PersistentV1 {
            *slot = Some(active);
        } else {
            slot_metrics(self.owner, "evict", "fresh-validation");
        }
        Ok(())
    }

    pub fn invoke(
        &self,
        capability: &str,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        self.invoke_cancellable(capability, input, Arc::new(AtomicU64::new(0)), 0)
    }
    pub fn invoke_cancellable(
        &self,
        capability: &str,
        input: serde_json::Value,
        cancellation: Arc<AtomicU64>,
        epoch: u64,
    ) -> Result<serde_json::Value, String> {
        self.invoke_cancellable_with_operation(capability, input, cancellation, epoch, None)
            .map_err(|error| error.to_string())
    }

    pub fn invoke_cancellable_with_operation(
        &self,
        capability: &str,
        input: serde_json::Value,
        cancellation: Arc<AtomicU64>,
        epoch: u64,
        operation: Option<Arc<AtomicBool>>,
    ) -> Result<serde_json::Value, InvocationError> {
        let check = || -> Result<(), String> {
            if cancellation.load(Ordering::Relaxed) == epoch
                && operation.as_ref().is_none_or(|flag| !flag.load(Ordering::Acquire))
            {
                Ok(())
            } else {
                Err("Plugin execution cancelled".into())
            }
        };
        check()?;
        let bytes = serde_json::to_vec(&Call {
            capability: capability.into(),
            input,
        })
        .map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE_BYTES {
            return Err(InvocationError::Operation("Plugin input exceeds message limit".into()));
        }
        // Source-only users retain their ordinary blocking policy. Scoped reads
        // return typed Busy rather than becoming an uncancellable global waiter.
        let admission = match operation {
            Some(_) => ACTIVE.try_lock(),
            None => ACTIVE.lock().map_err(TryLockError::Poisoned),
        };
        let mut slot = match admission {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => {
                check()?;
                return Err(InvocationError::Busy);
            }
            Err(TryLockError::Poisoned(poison)) => {
                let mut slot = poison.into_inner();
                if let Some(active) = slot.as_ref() {
                    slot_metrics(active.owner, "evict", "poison");
                }
                *slot = None;
                ACTIVE.clear_poison();
                return Err(InvocationError::Operation(
                    "Plugin execution owner was poisoned and evicted".into(),
                ));
            }
        };
        check()?;
        if slot.as_ref().is_none_or(|a| a.owner != self.owner) {
            if let Some(active) = slot.as_ref() {
                slot_metrics(active.owner, "evict", "owner-switch");
            }
            *slot = None;
            *slot = Some(self.instantiate(cancellation.clone(), epoch, operation.clone())?);
        } else {
            slot_metrics(self.owner, "reuse", "same-owner");
        }
        let result: Result<serde_json::Value, String> = (|| {
            check()?;
            let active = slot.as_mut().ok_or("Execution slot unavailable")?;
            active.store.data_mut().cancellation = Arc::clone(&cancellation);
            active.store.data_mut().epoch = epoch;
            active.store.data_mut().operation = operation.clone();
            match self.policy {
                ExecutionPolicy::PersistentV1 => {
                    reset(&mut active.store, self.policy.call_fuel(), HOST_READ_BUDGET)?
                }
                // A fresh Store's start/ABI/allocation/call/deallocation share the
                // original ABI1 allowance, including fuel consumed during startup.
                ExecutionPolicy::Fresh => active.store.data().check()?,
            }
            let output = active.invoke(capability, &bytes)?;
            active.store.data().check()?;
            Ok(output)
        })();
        if result.is_err() || self.policy == ExecutionPolicy::Fresh {
            let cause = if slot
                .as_ref()
                .is_some_and(|active| active.store.data().check().is_err())
            {
                "cancelled"
            } else if result.is_err() {
                "call-error"
            } else {
                "fresh-call"
            };
            slot_metrics(self.owner, "evict", cause);
            *slot = None;
        } else if let Some(active) = slot.as_mut() {
            // Persistent guest reuse must not retain a completed operation's
            // token; the source lifetime and compiled owner remain unchanged.
            active.store.data_mut().operation = None;
        }
        result.map_err(InvocationError::Operation)
    }
}
fn reset(store: &mut Store<State>, fuel: u64, read_limit: usize) -> Result<(), String> {
    store.data().check()?;
    let state = store.data_mut();
    state.read_bytes = 0;
    state.resource_queries = 0;
    state.range_calls = 0;
    state.resource_elapsed = Duration::ZERO;
    state.read_limit = read_limit;
    state.fuel_remaining = fuel;
    state.fuel_granted = 0;
    store.set_fuel(0).map_err(|e| e.to_string())
}
fn replenish(store: &mut Store<State>, required: u64) -> Result<(), String> {
    store.data().check()?;
    let current = store.get_fuel().map_err(|e| e.to_string())?;
    let grant = FUEL_SLICE
        .max(required.saturating_sub(current))
        .min(store.data().fuel_remaining);
    if grant == 0 || current + grant < required {
        return Err("Plugin exhausted its fuel allowance".into());
    }
    store.data_mut().fuel_remaining -= grant;
    store.data_mut().fuel_granted += grant;
    store.set_fuel(current + grant).map_err(|e| e.to_string())
}
fn run<P: WasmParams, R: WasmResults>(
    store: &mut Store<State>,
    function: TypedFunc<P, R>,
    params: P,
) -> Result<R, String> {
    store.data().check()?;
    if store.get_fuel().map_err(|e| e.to_string())? == 0 {
        replenish(store, 1)?;
    }
    let mut result = function
        .call_resumable(&mut *store, params)
        .map_err(|e| e.to_string())?;
    loop {
        store.data().check()?;
        match result {
            TypedResumableCall::Finished(value) => return Ok(value),
            TypedResumableCall::HostTrap(trap) => return Err(trap.host_error().to_string()),
            TypedResumableCall::OutOfFuel(call) => {
                replenish(store, call.required_fuel())?;
                result = call.resume(&mut *store).map_err(|e| e.to_string())?;
            }
        }
    }
}
fn slot_metrics(owner: u64, event: &str, cause: &str) {
    if std::env::var_os("MLEARN_PLUGIN_METRICS").is_some() {
        eprintln!("plugin-slot owner={owner} event={event} cause={cause} count=1");
    }
}
fn metrics(
    store: &Store<State>,
    owner: u64,
    phase: &str,
    capability: &str,
    started: Instant,
    run_success: bool,
) {
    if std::env::var_os("MLEARN_PLUGIN_METRICS").is_some() {
        let elapsed = started.elapsed();
        let resource_elapsed = store.data().resource_elapsed;
        // The remainder includes interpreter/fuel and bridge overhead, not host storage work.
        eprintln!(
            "plugin-work owner={owner} capability={capability:?} phase={phase} run_success={run_success} elapsed_us={} host_resource_us={} interpreter_bridge_us={} fuel_used={} resource_queries={} resource_bytes={} range_calls={}",
            elapsed.as_micros(),
            resource_elapsed.as_micros(),
            elapsed.saturating_sub(resource_elapsed).as_micros(),
            store.data().fuel_granted - store.get_fuel().unwrap_or(0),
            store.data().resource_queries,
            store.data().read_bytes,
            store.data().range_calls
        );
    }
}
impl Active {
    fn invoke(&mut self, capability: &str, bytes: &[u8]) -> Result<serde_json::Value, String> {
        let store = &mut self.store;
        let memory = self
            .instance
            .get_memory(&*store, "memory")
            .ok_or("Plugin memory export missing")?;
        let alloc = self
            .instance
            .get_typed_func::<i32, i32>(&*store, "mlearn_alloc")
            .map_err(|e| e.to_string())?;
        let dealloc = self
            .instance
            .get_typed_func::<(i32, i32), ()>(&*store, "mlearn_dealloc")
            .map_err(|e| e.to_string())?;
        let call = self
            .instance
            .get_typed_func::<(i32, i32), i64>(&*store, "mlearn_call")
            .map_err(|e| e.to_string())?;
        // Fresh start/ABI host work predates this call span.
        store.data_mut().resource_elapsed = Duration::ZERO;
        let started = Instant::now();
        let pointer = run(store, alloc, bytes.len() as i32)?;
        if pointer <= 0 {
            return Err("Plugin input allocation failed".into());
        }
        memory
            .write(&mut *store, pointer as usize, bytes)
            .map_err(|e| e.to_string())?;
        let outcome = run(store, call, (pointer, bytes.len() as i32));
        metrics(
            store,
            self.owner,
            "call",
            capability,
            started,
            outcome.is_ok(),
        );
        if std::env::var_os("MLEARN_PLUGIN_METRICS").is_some() {
            eprintln!(
                "plugin-memory owner={} capability={capability:?} bytes={}",
                self.owner,
                memory.data_size(&*store)
            );
        }
        let packed = outcome? as u64;
        let output_pointer = (packed >> 32) as u32;
        let output_length = packed as u32;
        if output_pointer == 0 || output_length == 0 || output_length as usize > MAX_MESSAGE_BYTES {
            return Err("Plugin returned an invalid output span".into());
        }
        let mut output = vec![0; output_length as usize];
        memory
            .read(&*store, output_pointer as usize, &mut output)
            .map_err(|e| e.to_string())?;
        run(
            store,
            dealloc,
            (output_pointer as i32, output_length as i32),
        )?;
        run(store, dealloc, (pointer, bytes.len() as i32))?;
        store.data().check()?;
        let reply: serde_json::Value =
            serde_json::from_slice(&output).map_err(|e| e.to_string())?;
        match reply.get("ok").and_then(serde_json::Value::as_bool) {
            Some(true) => reply
                .get("value")
                .cloned()
                .ok_or_else(|| "Plugin response has no value".into()),
            Some(false) => Err(reply
                .get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Plugin operation failed")
                .chars()
                .take(512)
                .collect()),
            None => Err("Malformed plugin response".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_execution_slices_only_the_allowance_remaining_after_startup() {
        let code = wat::parse_str(
            r#"(module
          (memory (export "memory") 1)
          (func (export "mlearn_abi_version") (result i32) i32.const 1)
          (func (export "work") (result i32) (local $remaining i32)
            i32.const 300000 local.set $remaining
            (loop $again
              local.get $remaining i32.const 1 i32.sub
              local.tee $remaining br_if $again)
            i32.const 7)
        )"#,
        )
        .unwrap();
        let plugin = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
        let mut active = plugin.instantiate(Arc::new(AtomicU64::new(0)), 0, None).unwrap();
        let available = active.store.get_fuel().unwrap() + active.store.data().fuel_remaining;
        assert!(
            available < CALL_FUEL,
            "startup consumes the original allowance"
        );
        let function = active
            .instance
            .get_typed_func::<(), i32>(&active.store, "work")
            .unwrap();

        assert_eq!(run(&mut active.store, function, ()).unwrap(), 7);

        assert!(
            active.store.get_fuel().unwrap() <= FUEL_SLICE,
            "Fresh execution must not receive the entire remaining allowance at once"
        );
        assert!(active.store.data().fuel_granted < CALL_FUEL);
        assert!(active.store.data().fuel_remaining < available);
    }

    #[test]
    fn cancellation_during_execution_rejects_the_result_before_publication() {
        let code = wat::parse_str(
            r#"(module
          (memory (export "memory") 1)
          (func (export "mlearn_abi_version") (result i32) i32.const 1)
        )"#,
        )
        .unwrap();
        let plugin = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
        let cancellation = Arc::new(AtomicU64::new(0));
        let mut active = plugin.instantiate(cancellation.clone(), 0, None).unwrap();
        reset(&mut active.store, CALL_FUEL, HOST_READ_BUDGET).unwrap();
        // The exact execution event changes the epoch, with no thread timing,
        // sleep or polling. The returned value must never reach the caller.
        let function = wasmi::Func::wrap(&mut active.store, move || -> i32 {
            cancellation.fetch_add(1, Ordering::Relaxed);
            99
        })
        .typed::<(), i32>(&active.store)
        .unwrap();
        assert_eq!(
            run(&mut active.store, function, ()).unwrap_err(),
            "Plugin execution cancelled"
        );
    }

    #[test]
    fn bounded_read_operation_cancellation_interrupts_actual_execution_without_changing_source() {
        // Given a real Wasmi store with conjunctive source/operation cancellation.
        let code = wat::parse_str(r#"(module
            (memory (export "memory") 1)
            (func (export "mlearn_abi_version") (result i32) i32.const 1)
        )"#).unwrap();
        let plugin = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
        let source = Arc::new(AtomicU64::new(0));
        let operation = Arc::new(AtomicBool::new(false));
        let mut active = plugin.instantiate(Arc::clone(&source), 0, Some(Arc::clone(&operation))).unwrap();
        reset(&mut active.store, CALL_FUEL, HOST_READ_BUDGET).unwrap();
        // When the actual execution event signals only its operation flag.
        let function = wasmi::Func::wrap(&mut active.store, move || -> i32 {
            operation.store(true, Ordering::Release);
            99
        }).typed::<(), i32>(&active.store).unwrap();
        assert_eq!(run(&mut active.store, function, ()).unwrap_err(), "Plugin execution cancelled");
        // Then the result is rejected while the same source remains usable.
        assert_eq!(source.load(Ordering::Relaxed), 0);
        let mut sibling = plugin.instantiate(source, 0, None).unwrap();
        reset(&mut sibling.store, CALL_FUEL, HOST_READ_BUDGET).unwrap();
        let function = wasmi::Func::wrap(&mut sibling.store, || -> i32 { 7 })
            .typed::<(), i32>(&sibling.store).unwrap();
        assert_eq!(run(&mut sibling.store, function, ()).unwrap(), 7);
    }

    #[test]
    fn bounded_read_scoped_global_admission_is_nonwaiting_and_preserves_occupied_owner() {
        // Given another execution owner holding the actual process-global slot.
        let code = wat::parse_str(r#"(module
            (memory (export "memory") 1)
            (func (export "mlearn_abi_version") (result i32) i32.const 1)
        )"#).unwrap();
        let plugin = CompiledPlugin::new(&code, AssetMap::new()).unwrap();
        let slot = ACTIVE.lock().unwrap();
        let owner = slot.as_ref().map(|active| active.owner);
        let source = Arc::new(AtomicU64::new(0));
        // When a scoped call attempts admission with the lock still occupied.
        let result = plugin.invoke_cancellable_with_operation(
            "test", serde_json::Value::Null, Arc::clone(&source), 0,
            Some(Arc::new(AtomicBool::new(false))),
        );
        // Then typed Busy returns before the blocker is released or touched.
        assert!(result.unwrap_err().is_busy());
        assert_eq!(slot.as_ref().map(|active| active.owner), owner);
        assert_eq!(source.load(Ordering::Relaxed), 0);
        drop(slot); // Must precede CompiledPlugin::drop, which also owns ACTIVE.
    }
}
