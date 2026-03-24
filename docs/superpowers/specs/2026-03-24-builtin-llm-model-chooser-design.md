# Design: Built-in LLM Model Chooser & Autoselect

**Date:** 2026-03-24  
**Status:** Approved  
**Scope:** Desktop (Electron) only — Capacitor/mobile paths are unaffected

---

## Overview

Replace the current fixed Qwen 3.5 9B default for the built-in LLM provider with a multi-model registry (0.8B, 2B, 4B, 9B). Add a model chooser in the AI settings tab, an autoselect button that detects available VRAM or RAM and picks the best-fitting model, a first-launch auto-run of autoselect, and a downloaded-models manager that lets users list and delete model files.

---

## Goals

- Default model changes from hardcoded 9B to hardware-appropriate selection via autoselect
- Users can manually pick any of the four Qwen 3.5 sizes
- Autoselect fires automatically the first time the user selects Built-in as their provider, and is also available as an explicit button at any time
- Users can see which models are downloaded and delete individual files to reclaim disk space
- No regressions on mobile (Capacitor) — all new paths are desktop-only

---

## Model Registry

Defined in `src/shared/builtinModels.ts`, exported as `BUILTIN_MODELS: BuiltinModelConfig[]`.

| Model         | File                        | HF Repo                      | Download Size | Required Memory |
|---------------|-----------------------------|------------------------------|---------------|-----------------|
| Qwen 3.5 0.8B | Qwen3.5-0.8B-Q4_K_M.gguf   | unsloth/Qwen3.5-0.8B-GGUF   | 1.0 GB        | 6.2 GB          |
| Qwen 3.5 2B   | Qwen3.5-2B-Q4_K_M.gguf     | unsloth/Qwen3.5-2B-GGUF     | 2.7 GB        | 8.0 GB          |
| Qwen 3.5 4B   | Qwen3.5-4B-Q4_K_M.gguf     | unsloth/Qwen3.5-4B-GGUF     | 3.4 GB        | 12.0 GB         |
| Qwen 3.5 9B   | Qwen3.5-9B-Q4_K_M.gguf     | unsloth/Qwen3.5-9B-GGUF     | 6.6 GB        | 14.5 GB         |

Model URLs follow the pattern:  
`https://huggingface.co/{modelRepo}/resolve/main/{modelFile}`

### `BuiltinModelConfig` interface

```typescript
interface BuiltinModelConfig {
  id: string;              // e.g. 'qwen3.5-4b'
  displayName: string;     // e.g. 'Qwen 3.5 4B'
  modelFile: string;       // GGUF filename
  modelRepo: string;       // HuggingFace repo path
  requiredMemoryGb: number; // Runtime memory requirement
  fileSizeGb: number;      // Approximate download size
}
```

### `autoselectBuiltinModel(memInfo)` — pure function

```
VRAM_MARGIN = 0.5 GB   (discrete GPU)
RAM_MARGIN  = 2.0 GB   (unified / integrated / CPU)

availableGb =
  hasDiscreteGpu  →  dedicatedVramBytes / 1024³  −  0.5
  else            →  totalRamBytes / 1024³       −  2.0

Sort BUILTIN_MODELS descending by requiredMemoryGb.
Return first model where requiredMemoryGb ≤ availableGb.
Fallback: 0.8B (smallest) if nothing fits.
```

---

## Memory Detection

### Why this works for Apple Silicon (MPS)

On Apple Silicon, `app.getGPUInfo()` returns `dedicatedVideoMemory: 0` because all memory is unified. This causes `hasDiscreteGpu = false`, so the code uses `os.totalmem()` — which returns the full unified memory pool (16/32/64 GB). node-llama-cpp's Metal backend draws from this same pool, so the 2 GB RAM margin path is correct for MPS.

| Platform                        | `dedicatedVideoMemory` | Branch used    | Memory source       |
|---------------------------------|------------------------|----------------|---------------------|
| Apple Silicon (M1/M2/M3/M4)     | 0                      | RAM margin     | `os.totalmem()`     |
| NVIDIA / AMD discrete GPU       | > 0                    | VRAM margin    | `dedicatedVideoMemory` |
| Intel integrated / CPU-only     | 0                      | RAM margin     | `os.totalmem()`     |

---

## Types (`src/shared/types.ts`)

New interfaces added:

```typescript
interface BuiltinModelConfig { ... }  // see above

interface SystemMemoryInfo {
  hasDiscreteGpu: boolean;
  dedicatedVramBytes: number;
  totalRamBytes: number;
}
```

`Settings` gains one new field:

```typescript
builtinModelAutoselected?: boolean  // default: false
```

`DEFAULT_SETTINGS.builtinModelAutoselected = false`

---

## IPC Layer

### New channels (`src/shared/constants.ts`)

```typescript
LLM_GET_SYSTEM_MEMORY:       'llm-get-system-memory'       // invoke
LLM_LIST_DOWNLOADED_MODELS:  'llm-list-downloaded-models'  // invoke
LLM_DELETE_MODEL:            'llm-delete-model'             // invoke
```

### Main process handlers (`builtinLLMService.ts`)

**`LLM_GET_SYSTEM_MEMORY`** (ipcMain.handle):
```
const gpuInfo = await app.getGPUInfo('basic')
const dedicatedVram = gpuInfo?.gpuDevice?.[0]?.dedicatedVideoMemory ?? 0
return {
  hasDiscreteGpu: dedicatedVram > 0,
  dedicatedVramBytes: dedicatedVram,
  totalRamBytes: os.totalmem(),
}
```

**`LLM_LIST_DOWNLOADED_MODELS`** (ipcMain.handle):
```
For each model in BUILTIN_MODELS:
  if file exists at getModelPath(model.modelFile):
    stat the file → get sizeBytes
    include in result array
Return [{ modelFile, sizeBytes }]
```

**`LLM_DELETE_MODEL`** (ipcMain.handle, arg: modelFile):
```
Validate modelFile is in BUILTIN_MODELS (whitelist — no path traversal)
If currently loaded model matches → unloadModel()
fs.unlink(getModelPath(modelFile))
```

### Cleanup in `builtinLLMService.ts`

Remove the three hardcoded constants:
- `DEFAULT_MODEL_REPO`
- `DEFAULT_MODEL_FILE`
- `DEFAULT_MODEL_URL`

Replace with imports from `builtinModels.ts`. Existing `getModelPath(modelFile?)`, `isModelDownloaded(modelFile?)`, `LLM_DOWNLOAD_MODEL`, and `LLM_CHECK_MODEL` handlers already accept optional `modelFile` — no signature changes needed.

### Bridge layer (`src/shared/bridges/types.ts`)

`LLMBridge` gains three **optional** methods (desktop-only):

```typescript
llmGetSystemMemory?: () => Promise<SystemMemoryInfo>;
llmListDownloadedModels?: () => Promise<Array<{ modelFile: string; sizeBytes: number }>>;
llmDeleteModel?: (modelFile: string) => Promise<void>;
```

Typed as optional (`?:`) so `capacitorBridge.ts` simply omits them without a type error.  
`electronBridge.ts` implements all three, delegating to `getIPC().*`.  
Call sites guard before calling:

```typescript
if (getBridge().llm.llmGetSystemMemory) { ... }
```

---

## Settings UI (`AITab.tsx`)

### Built-in section changes

#### Model chooser row

```
Label:       "Model"
Control:     <Select> populated from BUILTIN_MODELS
             Option label: "{displayName}"
             Value:        modelFile
Bound to:    settings.builtinModel
On change:   updateSettings({ builtinModel, builtinModelAutoselected: true })
             // Setting builtinModelAutoselected: true here is intentional —
             // a manual selection is an explicit user choice and should prevent
             // autoselect from overriding it if the user later switches providers
             // and switches back to Built-in.
             + llmUnloadModel() if a model is currently loaded
             + re-fetch model status for new selection

Hint line below select:
  "~{fileSizeGb} GB download · Requires ~{requiredMemoryGb} GB RAM"

Beside select:
  <Btn> "Autoselect"   [disabled on mobile / when autoselecting]
```

#### Autoselect behavior

Calls `llmGetSystemMemory()`, feeds result into `autoselectBuiltinModel()`, updates `settings.builtinModel` and `settings.builtinModelAutoselected = true`, shows an inline notification:

```
"Detected {X} GB {unified memory | VRAM} — selected Qwen 3.5 {N}B"
```

Notification clears after 5 seconds.

#### First-launch auto-run

```typescript
createEffect(() => {
  if (settings.llmProvider === 'builtin' && !settings.builtinModelAutoselected) {
    void runAutoselect();
  }
});
```

Fires once per install (flag persisted in settings JSON). Also fires for existing users upgrading from the old 9B default.

#### Model status row (unchanged layout, updated data)

- `llmCheckModel(settings.builtinModel)` — re-called whenever `builtinModel` changes
- **Downloading:** existing progress bar + `XX% — X.X GB / X.X GB` text
- **Downloaded:** "Model ready" label + "Redownload" button
- **Not downloaded:** "Not downloaded" label + "Download" button (primary)
- `llmDownloadModel(selectedModel.modelUrl, selectedModel.modelFile)` — passes correct URL + file

### Downloaded models manager (new subsection)

Visible only when `llmProvider === 'builtin'`.

```
Group title: "Downloaded Models"

If no models downloaded:
  HintText: "No models downloaded."

For each downloaded model:
  Row:
    Left:  "{displayName}"   "{actualSizeOnDisk formatted via formatBytes()}"
    Right: <Btn size="sm" variant="danger"> Delete </Btn>

On delete:
  Call llmDeleteModel(modelFile)
  Refresh downloaded models list
  Show brief inline confirmation: "Deleted {displayName}"
```

The list is fetched on mount (when `llmProvider === 'builtin'`) and refreshed after any download completes or delete action.

---

## Data Flow Summary

```
AITab mounts, llmProvider === 'builtin'
  → llmCheckModel(builtinModel)         → model status signal
  → llmListDownloadedModels()           → downloaded models list
  → if !builtinModelAutoselected        → runAutoselect()
       → llmGetSystemMemory()           → SystemMemoryInfo
       → autoselectBuiltinModel(info)   → BuiltinModelConfig
       → updateSettings(builtinModel, builtinModelAutoselected: true)
       → show notification

User changes dropdown
  → updateSettings(builtinModel)
  → llmUnloadModel()
  → llmCheckModel(newModelFile)

User clicks Download
  → llmDownloadModel(modelUrl, modelFile)
  → progress events → modelStatus signal → progress bar

User clicks Delete
  → llmDeleteModel(modelFile)
  → llmListDownloadedModels()           → refresh list
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/shared/builtinModels.ts` | **New** — model registry + autoselect logic |
| `src/shared/types.ts` | Add `BuiltinModelConfig`, `SystemMemoryInfo`, `Settings.builtinModelAutoselected` |
| `src/shared/constants.ts` | Add 3 new IPC channel names |
| `src/electron/services/builtinLLMService.ts` | Remove hardcoded defaults, add 3 new IPC handlers |
| `src/shared/bridges/types.ts` | Add 3 methods to `LLMBridge` |
| `src/shared/bridges/electronBridge.ts` | Implement 3 new bridge methods |
| `src/renderer/windows/settings/tabs/AITab.tsx` | Model chooser, autoselect button, first-launch logic, downloaded models manager |
| `src/electron/preload.ts` | Expose 3 new IPC invoke calls via `contextBridge` |
| `src/shared/global.d.ts` | Declare 3 new methods on `MLearnIPC` |

---

## Out of Scope

- Mobile (Capacitor) — no changes, bridge methods absent
- Ollama and Cloud LLM providers — unchanged
- The LLM router (`llmRouter.ts`) — no changes needed; it already reads `settings.builtinModel` indirectly via `builtinStreamChat`
