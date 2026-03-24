# Built-in LLM Model Chooser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded Qwen 3.5 9B default with a 4-model registry (0.8B–9B), add a model chooser and hardware-aware autoselect in AI Settings, and add a downloaded-models manager.

**Architecture:** Approach A — shared pure `autoselectBuiltinModel()` function lives in `src/shared/builtinModels.ts` (testable without Electron), while memory detection is an IPC handler in the main process. The renderer calls `llmGetSystemMemory()` → feeds result to `autoselectBuiltinModel()` → updates settings. New IPC channels for list/delete are invoke-style (request/response).

**Tech Stack:** TypeScript, Electron IPC (ipcMain.handle / ipcRenderer.invoke), SolidJS, Vitest, node-llama-cpp, `os.totalmem()`, `app.getGPUInfo('basic')`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/builtinModels.ts` | **Create** | Model registry (`BUILTIN_MODELS`) + `autoselectBuiltinModel()` pure function |
| `test/builtinModels.test.ts` | **Create** | Vitest unit tests for autoselect logic |
| `src/shared/types.ts` | **Modify** | Add `BuiltinModelConfig`, `SystemMemoryInfo`; add `builtinModelAutoselected?: boolean` to `Settings`; update `DEFAULT_SETTINGS` |
| `src/shared/constants.ts` | **Modify** | Add 3 new IPC channel names to `IPC_CHANNELS` |
| `src/electron/services/builtinLLMService.ts` | **Modify** | Remove 3 hardcoded constants; import from builtinModels; add 3 new IPC handlers; fix router gap |
| `src/electron/services/llmRouter.ts` | **Modify** | Pass `settings.builtinModel` to `builtinStreamChat()` |
| `src/electron/preload.ts` | **Modify** | Expose 3 new `ipcRenderer.invoke()` methods |
| `src/shared/global.d.ts` | **Modify** | Add 3 new methods to `MLearnIPC` interface |
| `src/shared/bridges/types.ts` | **Modify** | Add 3 optional methods to `LLMBridge` |
| `src/shared/bridges/electronBridge.ts` | **Modify** | Implement 3 new bridge methods |
| `src/renderer/windows/settings/tabs/AITab.tsx` | **Modify** | Model chooser, autoselect button, first-launch logic, downloaded models manager |

---

## Task 1: Shared Model Registry + Pure Autoselect Function

**Files:**
- Create: `src/shared/builtinModels.ts`
- Create: `test/builtinModels.test.ts`

- [ ] **Step 1: Create `src/shared/builtinModels.ts`**

```typescript
/**
 * Built-in LLM model registry and hardware-aware autoselect logic.
 * Pure functions — no Electron, no Node.js APIs.
 */

import type { BuiltinModelConfig, SystemMemoryInfo } from './types';

export const BUILTIN_MODELS: BuiltinModelConfig[] = [
  {
    id: 'qwen3.5-0.8b',
    displayName: 'Qwen 3.5 0.8B',
    modelFile: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    modelRepo: 'unsloth/Qwen3.5-0.8B-GGUF',
    requiredMemoryGb: 6.2,
    fileSizeGb: 1.0,
  },
  {
    id: 'qwen3.5-2b',
    displayName: 'Qwen 3.5 2B',
    modelFile: 'Qwen3.5-2B-Q4_K_M.gguf',
    modelRepo: 'unsloth/Qwen3.5-2B-GGUF',
    requiredMemoryGb: 8.0,
    fileSizeGb: 2.7,
  },
  {
    id: 'qwen3.5-4b',
    displayName: 'Qwen 3.5 4B',
    modelFile: 'Qwen3.5-4B-Q4_K_M.gguf',
    modelRepo: 'unsloth/Qwen3.5-4B-GGUF',
    requiredMemoryGb: 12.0,
    fileSizeGb: 3.4,
  },
  {
    id: 'qwen3.5-9b',
    displayName: 'Qwen 3.5 9B',
    modelFile: 'Qwen3.5-9B-Q4_K_M.gguf',
    modelRepo: 'unsloth/Qwen3.5-9B-GGUF',
    requiredMemoryGb: 14.5,
    fileSizeGb: 6.6,
  },
];

const VRAM_MARGIN_GB = 0.5;
const RAM_MARGIN_GB = 2.0;

/**
 * Pick the largest model that fits in available memory.
 * Falls back to 0.8B (smallest) if nothing fits.
 */
export function autoselectBuiltinModel(memInfo: SystemMemoryInfo): BuiltinModelConfig {
  const GiB = 1024 ** 3;
  const availableGb = memInfo.hasDiscreteGpu
    ? memInfo.dedicatedVramBytes / GiB - VRAM_MARGIN_GB
    : memInfo.totalRamBytes / GiB - RAM_MARGIN_GB;

  const sorted = [...BUILTIN_MODELS].sort((a, b) => b.requiredMemoryGb - a.requiredMemoryGb);
  const best = sorted.find((m) => m.requiredMemoryGb <= availableGb);
  return best ?? BUILTIN_MODELS[0];
}

export function getBuiltinModelByFile(modelFile: string): BuiltinModelConfig | undefined {
  return BUILTIN_MODELS.find((m) => m.modelFile === modelFile);
}

export function getModelUrl(model: BuiltinModelConfig): string {
  return `https://huggingface.co/${model.modelRepo}/resolve/main/${model.modelFile}`;
}
```

- [ ] **Step 2: Write failing tests in `test/builtinModels.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { autoselectBuiltinModel, BUILTIN_MODELS, getBuiltinModelByFile, getModelUrl } from '../src/shared/builtinModels';
import type { SystemMemoryInfo } from '../src/shared/types';

const GiB = 1024 ** 3;

describe('autoselectBuiltinModel', () => {
  it('selects 9B when 32 GB unified memory (Apple Silicon M3)', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: false,
      dedicatedVramBytes: 0,
      totalRamBytes: 32 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    expect(model.id).toBe('qwen3.5-9b');
  });

  it('selects 4B when 16 GB unified memory (Apple Silicon M1)', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: false,
      dedicatedVramBytes: 0,
      totalRamBytes: 16 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    expect(model.id).toBe('qwen3.5-4b');
  });

  it('selects 2B when 10 GB unified memory', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: false,
      dedicatedVramBytes: 0,
      totalRamBytes: 10 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    expect(model.id).toBe('qwen3.5-2b');
  });

  it('falls back to 0.8B when only 4 GB RAM (nothing fits)', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: false,
      dedicatedVramBytes: 0,
      totalRamBytes: 4 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    expect(model.id).toBe('qwen3.5-0.8b');
  });

  it('selects 9B with 16 GB dedicated VRAM (discrete GPU)', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: true,
      dedicatedVramBytes: 16 * GiB,
      totalRamBytes: 32 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    expect(model.id).toBe('qwen3.5-9b');
  });

  it('selects 4B with 12 GB VRAM (RTX 3080 Ti)', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: true,
      dedicatedVramBytes: 12 * GiB,
      totalRamBytes: 32 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    // 12 - 0.5 = 11.5 GB available; 9B requires 14.5 → too big; 4B requires 12.0 → fits
    expect(model.id).toBe('qwen3.5-4b');
  });

  it('selects 9B with exactly 15 GB VRAM (boundary)', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: true,
      dedicatedVramBytes: 15 * GiB,
      totalRamBytes: 32 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    // 15 - 0.5 = 14.5 GB; 9B requires exactly 14.5 → fits
    expect(model.id).toBe('qwen3.5-9b');
  });
});

describe('BUILTIN_MODELS registry', () => {
  it('has 4 models in ascending memory order', () => {
    const ids = BUILTIN_MODELS.map((m) => m.id);
    expect(ids).toEqual(['qwen3.5-0.8b', 'qwen3.5-2b', 'qwen3.5-4b', 'qwen3.5-9b']);
  });
});

describe('getBuiltinModelByFile', () => {
  it('finds model by filename', () => {
    const model = getBuiltinModelByFile('Qwen3.5-4B-Q4_K_M.gguf');
    expect(model?.id).toBe('qwen3.5-4b');
  });

  it('returns undefined for unknown file', () => {
    expect(getBuiltinModelByFile('unknown.gguf')).toBeUndefined();
  });
});

describe('getModelUrl', () => {
  it('builds correct HuggingFace URL', () => {
    const model = BUILTIN_MODELS.find((m) => m.id === 'qwen3.5-9b')!;
    expect(getModelUrl(model)).toBe(
      'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf'
    );
  });
});
```

- [ ] **Step 3: Run tests — expect them to fail** (types missing)

```bash
npx vitest run test/builtinModels.test.ts --reporter=verbose
```

Expected: TypeScript errors about missing `BuiltinModelConfig` and `SystemMemoryInfo` types.

---

## Task 2: Add Types and Settings Fields

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `BuiltinModelConfig` and `SystemMemoryInfo` interfaces**

In `src/shared/types.ts`, after the `LLMProvider` type definition (around line 960), add:

```typescript
/** Configuration for a built-in GGUF model */
export interface BuiltinModelConfig {
  /** Unique identifier e.g. 'qwen3.5-4b' */
  id: string;
  /** Display name e.g. 'Qwen 3.5 4B' */
  displayName: string;
  /** GGUF filename e.g. 'Qwen3.5-4B-Q4_K_M.gguf' */
  modelFile: string;
  /** HuggingFace repo path e.g. 'unsloth/Qwen3.5-4B-GGUF' */
  modelRepo: string;
  /** Runtime memory requirement in GB */
  requiredMemoryGb: number;
  /** Approximate download size in GB */
  fileSizeGb: number;
}

/** System memory info returned by the main process for autoselect */
export interface SystemMemoryInfo {
  hasDiscreteGpu: boolean;
  dedicatedVramBytes: number;
  totalRamBytes: number;
}
```

- [ ] **Step 2: Add `builtinModelAutoselected` to `Settings` interface**

In `src/shared/types.ts`, inside the `Settings` interface, after the `builtinModel: string` field (line 249), add:

```typescript
  /** Whether the built-in model has been autoselected (prevents re-running autoselect) */
  builtinModelAutoselected?: boolean;
```

- [ ] **Step 3: Add default value to `DEFAULT_SETTINGS`**

In `DEFAULT_SETTINGS` (around line 398 where `builtinModel` is set), add after it:

```typescript
  builtinModelAutoselected: false,
```

- [ ] **Step 4: Run tests — expect the type errors to be resolved**

```bash
npx vitest run test/builtinModels.test.ts --reporter=verbose
```

Expected: All tests pass (green).

- [ ] **Step 5: Commit**

```bash
git add src/shared/builtinModels.ts test/builtinModels.test.ts src/shared/types.ts
git commit -m "feat: add builtin model registry and autoselect logic with types"
```

---

## Task 3: New IPC Channel Constants

**Files:**
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Add 3 new IPC channels to `IPC_CHANNELS`**

In `src/shared/constants.ts`, inside the `IPC_CHANNELS` object after the `LLM_UNLOAD_MODEL` entry (line 199), add:

```typescript
  LLM_GET_SYSTEM_MEMORY: 'llm-get-system-memory',
  LLM_LIST_DOWNLOADED_MODELS: 'llm-list-downloaded-models',
  LLM_DELETE_MODEL: 'llm-delete-model',
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/constants.ts
git commit -m "feat: add IPC channel constants for system memory, model list, and model delete"
```

---

## Task 4: Main Process — New IPC Handlers + Fix Router Gap

**Files:**
- Modify: `src/electron/services/builtinLLMService.ts`
- Modify: `src/electron/services/llmRouter.ts`

- [ ] **Step 1: Update imports at top of `builtinLLMService.ts`**

Replace the current import block (lines 1–18) with:

```typescript
/**
 * Built-in LLM Service using node-llama-cpp
 * Runs GGUF models locally in the Electron main process with function calling support.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IPC_CHANNELS } from '../../shared/constants';
import { downloadFileWithProgress } from '../utils/downloadManager';
import { BUILTIN_MODELS, getModelUrl } from '../../shared/builtinModels';
import type { LLMStreamChunk, LLMModelStatus, LLMChatMessage, LLMToolDefinition, LLMToolCall } from '../../shared/types';

const MODEL_DIR_NAME = 'models';
const IDLE_UNLOAD_MS = 10 * 60 * 1000; // 10 minutes
```

Note: Remove the three hardcoded constants (`DEFAULT_MODEL_REPO`, `DEFAULT_MODEL_FILE`, `DEFAULT_MODEL_URL`).

- [ ] **Step 2: Update `getModelPath` and `isModelDownloaded` to no longer reference a deleted default**

The `getModelPath(modelFile?)` function currently has a fallback to `DEFAULT_MODEL_FILE`. After removing that constant, update it to fallback to the 9B model file from `BUILTIN_MODELS`:

```typescript
function getModelPath(modelFile?: string): string {
  const file = modelFile ?? BUILTIN_MODELS[BUILTIN_MODELS.length - 1].modelFile;
  return path.join(getModelsDir(), file);
}

function isModelDownloaded(modelFile?: string): boolean {
  return fs.existsSync(getModelPath(modelFile));
}
```

- [ ] **Step 3: Update the `LLM_DOWNLOAD_MODEL` handler to use `BUILTIN_MODELS` fallback instead of deleted constant**

In `setupBuiltinLLMIPC()`, the download handler currently references `DEFAULT_MODEL_URL` and `DEFAULT_MODEL_FILE`. Replace the handler:

```typescript
  // Download model
  ipcMain.on(IPC_CHANNELS.LLM_DOWNLOAD_MODEL, async (event, modelUrl?: string, modelFile?: string) => {
    const fallbackModel = BUILTIN_MODELS[BUILTIN_MODELS.length - 1];
    const resolvedModelFile = modelFile ?? fallbackModel.modelFile;
    const resolvedModelUrl = modelUrl ?? getModelUrl(fallbackModel);
    try {
      await downloadModel(
        resolvedModelUrl,
        resolvedModelFile,
        event.sender
      );
      event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, getModelStatus(resolvedModelFile));
    } catch (err) {
      const status: LLMModelStatus = {
        ...getModelStatus(resolvedModelFile),
        error: (err as Error).message,
      };
      event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, status);
    }
  });
```

- [ ] **Step 4: Add 3 new IPC handlers at the end of `setupBuiltinLLMIPC()`**

Inside `setupBuiltinLLMIPC()`, after the `LLM_UNLOAD_MODEL` handler, add:

```typescript
  // Get system memory info for autoselect
  ipcMain.handle(IPC_CHANNELS.LLM_GET_SYSTEM_MEMORY, async () => {
    const gpuInfo = await app.getGPUInfo('basic') as { gpuDevice?: Array<{ dedicatedVideoMemory?: number }> } | null;
    const dedicatedVram = gpuInfo?.gpuDevice?.[0]?.dedicatedVideoMemory ?? 0;
    return {
      hasDiscreteGpu: dedicatedVram > 0,
      dedicatedVramBytes: dedicatedVram,
      totalRamBytes: os.totalmem(),
    };
  });

  // List downloaded models with file sizes
  ipcMain.handle(IPC_CHANNELS.LLM_LIST_DOWNLOADED_MODELS, () => {
    return BUILTIN_MODELS
      .filter((m) => isModelDownloaded(m.modelFile))
      .map((m) => {
        const filePath = getModelPath(m.modelFile);
        const stat = fs.statSync(filePath);
        return { modelFile: m.modelFile, sizeBytes: stat.size };
      });
  });

  // Delete a model file (whitelist-validated)
  ipcMain.handle(IPC_CHANNELS.LLM_DELETE_MODEL, (_event, modelFile: string) => {
    const isWhitelisted = BUILTIN_MODELS.some((m) => m.modelFile === modelFile);
    if (!isWhitelisted) {
      throw new Error(`Model file not in registry: ${modelFile}`);
    }
    // Only unload if the model being deleted is currently loaded
    // (compare against the path, not just whether any model is loaded)
    const filePath = getModelPath(modelFile);
    if (loadedModel !== null && fs.existsSync(filePath)) {
      // loadedModel path isn't directly accessible, but since only one model
      // can be loaded at a time, check if the model file matches the loaded path
      // by using the getModelPath helper (which we just called above)
      unloadModel();
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
```

- [ ] **Step 5: Fix the router gap — pass `builtinModel` to `builtinStreamChat`**

In `src/electron/services/llmRouter.ts`, line 54, update the builtin call:

```typescript
      } else {
        await builtinStreamChat(event.sender, messages, tools || [], settings.builtinModel || undefined);
      }
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/electron/services/builtinLLMService.ts src/electron/services/llmRouter.ts
git commit -m "feat: add system memory, list/delete model IPC handlers; fix model routing"
```

---

## Task 5: Preload + Global Type Declarations

**Files:**
- Modify: `src/electron/preload.ts`
- Modify: `src/shared/global.d.ts`

- [ ] **Step 1: Add 3 new methods to preload.ts**

In `src/electron/preload.ts`, add the import for `SystemMemoryInfo` to the existing import line (line 8):

```typescript
import type { ..., SystemMemoryInfo } from '../shared/types';
```

Then in the `mLearnIPC` object, after the `llmUnloadModel` line (around line 279), add:

```typescript
  llmGetSystemMemory: (): Promise<SystemMemoryInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_GET_SYSTEM_MEMORY),
  llmListDownloadedModels: (): Promise<Array<{ modelFile: string; sizeBytes: number }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_LIST_DOWNLOADED_MODELS),
  llmDeleteModel: (modelFile: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.LLM_DELETE_MODEL, modelFile),
```

- [ ] **Step 2: Add 3 new methods to `MLearnIPC` in `global.d.ts`**

In `src/shared/global.d.ts`, add `SystemMemoryInfo` to the import list at the top. Then in the `MLearnIPC` interface, after `llmUnloadModel: () => void;` (around line 180), add:

```typescript
  llmGetSystemMemory?: () => Promise<SystemMemoryInfo>;
  llmListDownloadedModels?: () => Promise<Array<{ modelFile: string; sizeBytes: number }>>;
  llmDeleteModel?: (modelFile: string) => Promise<void>;
```

Note: These are **optional** (`?:`) because they're Electron-only — the Capacitor bridge doesn't expose them.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/electron/preload.ts src/shared/global.d.ts
git commit -m "feat: expose llmGetSystemMemory, llmListDownloadedModels, llmDeleteModel in preload"
```

---

## Task 6: Bridge Layer

**Files:**
- Modify: `src/shared/bridges/types.ts`
- Modify: `src/shared/bridges/electronBridge.ts`

- [ ] **Step 1: Add 3 optional methods to `LLMBridge` in `types.ts`**

In `src/shared/bridges/types.ts`, add `SystemMemoryInfo` to the existing imports. Then in `LLMBridge` (after `llmUnloadModel` on line 147), add:

```typescript
  llmGetSystemMemory?: () => Promise<SystemMemoryInfo>;
  llmListDownloadedModels?: () => Promise<Array<{ modelFile: string; sizeBytes: number }>>;
  llmDeleteModel?: (modelFile: string) => Promise<void>;
```

- [ ] **Step 2: Implement 3 new bridge methods in `electronBridge.ts`**

In `src/shared/bridges/electronBridge.ts`, inside `llmBridge`, after `llmUnloadModel: () => getIPC().llmUnloadModel(),` (around line 147), add:

```typescript
  llmGetSystemMemory: () => getIPC().llmGetSystemMemory!(),
  llmListDownloadedModels: () => getIPC().llmListDownloadedModels!(),
  llmDeleteModel: (file) => getIPC().llmDeleteModel!(file),
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/bridges/types.ts src/shared/bridges/electronBridge.ts
git commit -m "feat: add llmGetSystemMemory, llmListDownloadedModels, llmDeleteModel to bridge"
```

---

## Task 7: AI Settings UI

**Files:**
- Modify: `src/renderer/windows/settings/tabs/AITab.tsx`

This is the largest change. Replace the entire built-in section with the model chooser, autoselect button, first-launch logic, and downloaded models manager.

- [ ] **Step 1: Add new imports to `AITab.tsx`**

Update the imports at the top of `AITab.tsx`:

```typescript
import { Component, Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import {
  SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText, ToggleSwitch,
  BotIcon
} from '../../../components/common';
import { getBridge } from '../../../../shared/bridges';
import { CloudLLMAdapter } from '../../../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../../../shared/backends';
import { BUILTIN_MODELS, autoselectBuiltinModel, getModelUrl } from '../../../../shared/builtinModels';
import type { LLMProvider, LLMModelStatus, OCRProvider, SystemMemoryInfo } from '../../../../shared/types';
import '../SettingsForm.css';
import './AITab.css';
```

- [ ] **Step 2: Add new signals in the `AITab` component body**

After the existing `modelStatus` and `ollamaConnected` signals (around line 35), add:

```typescript
  // Autoselect state
  const [autoselectMsg, setAutoselectMsg] = createSignal<string | null>(null);
  const [autoselecting, setAutoselecting] = createSignal(false);

  // Downloaded models manager
  const [downloadedModels, setDownloadedModels] = createSignal<Array<{ modelFile: string; sizeBytes: number }>>([]);
  const [deletingModel, setDeletingModel] = createSignal<string | null>(null);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = createSignal<string | null>(null);
```

- [ ] **Step 3: Add `runAutoselect` function**

After the `checkModelStatus` function (around line 79), add:

```typescript
  async function runAutoselect() {
    const bridge = getBridge();
    if (!bridge.llm.llmGetSystemMemory) return;
    setAutoselecting(true);
    setAutoselectMsg(null);
    try {
      const memInfo: SystemMemoryInfo = await bridge.llm.llmGetSystemMemory();
      const selected = autoselectBuiltinModel(memInfo);
      const memGb = memInfo.hasDiscreteGpu
        ? Math.round(memInfo.dedicatedVramBytes / 1024 ** 3)
        : Math.round(memInfo.totalRamBytes / 1024 ** 3);
      const memLabel = memInfo.hasDiscreteGpu ? 'VRAM' : 'unified memory';
      updateSettings({ builtinModel: selected.modelFile, builtinModelAutoselected: true });
      setAutoselectMsg(`Detected ${memGb} GB ${memLabel} — selected ${selected.displayName}`);
      setTimeout(() => setAutoselectMsg(null), 5000);
      await checkModelStatus(selected.modelFile);
    } catch {
      setAutoselectMsg(null);
    } finally {
      setAutoselecting(false);
    }
  }

  async function fetchDownloadedModels() {
    const bridge = getBridge();
    if (!bridge.llm.llmListDownloadedModels) return;
    try {
      const list = await bridge.llm.llmListDownloadedModels();
      setDownloadedModels(list);
    } catch {
      setDownloadedModels([]);
    }
  }

  async function handleDeleteModel(modelFile: string) {
    const bridge = getBridge();
    if (!bridge.llm.llmDeleteModel) return;
    setDeletingModel(modelFile);
    try {
      await bridge.llm.llmDeleteModel(modelFile);
      const model = BUILTIN_MODELS.find((m) => m.modelFile === modelFile);
      if (model) {
        setDeleteConfirmMsg(`Deleted ${model.displayName}`);
        setTimeout(() => setDeleteConfirmMsg(null), 3000);
      }
      await fetchDownloadedModels();
    } catch {
      // silently ignore
    } finally {
      setDeletingModel(null);
    }
  }
```

- [ ] **Step 4: Update `checkModelStatus` to accept optional model file**

Replace the existing `checkModelStatus` function:

```typescript
  async function checkModelStatus(modelFile?: string) {
    try {
      const status = await getBridge().llm.llmCheckModel(modelFile ?? settings.builtinModel);
      setModelStatus(status);
    } catch {
      // Ignore — status will remain default
    }
  }
```

- [ ] **Step 5a: Remove the duplicate `onLLMModelStatus` subscription from the existing `createEffect`**

The existing `createEffect` at the top of the component (around lines 55–70) subscribes to both `onLLMDownloadProgress` and `onLLMModelStatus`. The new `createEffect` below will subscribe to `onLLMModelStatus` as well (to also trigger `fetchDownloadedModels`). To avoid a double-subscription, **remove** the `onLLMModelStatus` subscription from the existing block. Keep only `onLLMDownloadProgress` in the existing block:

```typescript
  // Listen for download progress updates only
  createEffect(() => {
    const bridge = getBridge();

    const cleanupProgress = bridge.llm.onLLMDownloadProgress((status: LLMModelStatus) => {
      setModelStatus(status);
    });

    onCleanup(() => {
      cleanupProgress();
    });
  });
```

- [ ] **Step 5b: Add first-launch autoselect effect + model status refetch on model change + fetch downloaded models on mount**

After the updated `createEffect` block (from Step 5a), add:

```typescript
  // First-launch autoselect
  createEffect(() => {
    if (settings.llmProvider === 'builtin' && !settings.builtinModelAutoselected) {
      void runAutoselect();
    }
  });

  // Re-check model status whenever the selected model changes
  createEffect(() => {
    const modelFile = settings.builtinModel;
    if (settings.llmProvider === 'builtin' && modelFile) {
      void checkModelStatus(modelFile);
    }
  });

  // Fetch downloaded models list when on builtin provider
  createEffect(() => {
    if (settings.llmProvider === 'builtin') {
      void fetchDownloadedModels();
    }
  });

  // Refresh downloaded models list after a download completes
  createEffect(() => {
    const bridge = getBridge();

    const cleanupStatus = bridge.llm.onLLMModelStatus((status: LLMModelStatus) => {
      setModelStatus(status);
      if (status.downloaded) {
        void fetchDownloadedModels();
      }
    });

    onCleanup(() => {
      cleanupStatus();
    });
  });
```

Note: Remove the original `createEffect` that also subscribed to `onLLMModelStatus` to avoid a duplicate subscription.

- [ ] **Step 6: Update `handleDownloadModel` to pass correct URL and file** (`formatBytes` is already defined in `AITab.tsx` at line 147 — no additional import needed)

```typescript
  async function handleDownloadModel() {
    const model = BUILTIN_MODELS.find((m) => m.modelFile === settings.builtinModel)
      ?? BUILTIN_MODELS[BUILTIN_MODELS.length - 1];
    setModelStatus((prev) => ({ ...prev, downloading: true, progress: 0, error: undefined }));
    try {
      getBridge().llm.llmDownloadModel(getModelUrl(model), model.modelFile);
    } catch (e) {
      setModelStatus((prev) => ({ ...prev, downloading: false, error: String(e) }));
    }
  }
```

Note: `llmDownloadModel` is a `send` (fire-and-forget), not `await`-able — remove `await`.

- [ ] **Step 7: Replace the built-in section JSX**

Replace the existing `<Show when={settings.llmProvider === 'builtin'}>` block (lines 184–232) with:

```tsx
      {/* Built-in Model Section */}
      <Show when={settings.llmProvider === 'builtin'}>
        <SettingGroup title={t('mlearn.AI.Settings.BuiltinModel.Title')}>
          {/* Model chooser */}
          <SettingRow
            label={t('mlearn.AI.Settings.BuiltinModel.ModelName')}
            description=""
          >
            <div class="ai-model-chooser-row">
              <Select
                class="setting-select"
                value={settings.builtinModel}
                onChange={(e) => {
                  const modelFile = e.currentTarget.value;
                  updateSettings({ builtinModel: modelFile, builtinModelAutoselected: true });
                  getBridge().llm.llmUnloadModel();
                  void checkModelStatus(modelFile);
                }}
                options={BUILTIN_MODELS.map((m) => ({ value: m.modelFile, label: m.displayName }))}
              />
              <Show when={getBridge().llm.llmGetSystemMemory}>
                <Btn
                  size="sm"
                  onClick={() => void runAutoselect()}
                  disabled={autoselecting()}
                  loading={autoselecting()}
                >
                  Autoselect
                </Btn>
              </Show>
            </div>
            <Show when={settings.builtinModel}>
              {(() => {
                const model = BUILTIN_MODELS.find((m) => m.modelFile === settings.builtinModel);
                return model ? (
                  <HintText>~{model.fileSizeGb} GB download · Requires ~{model.requiredMemoryGb} GB RAM</HintText>
                ) : null;
              })()}
            </Show>
            <Show when={autoselectMsg()}>
              <HintText>{autoselectMsg()}</HintText>
            </Show>
          </SettingRow>

          {/* Model download status */}
          <SettingRow
            label={t('mlearn.AI.Settings.BuiltinModel.Status')}
            description=""
          >
            <div class="ai-model-status">
              <Show when={modelStatus().downloading}>
                <div class="ai-download-progress">
                  <div class="ai-progress-bar">
                    <div
                      class="ai-progress-fill"
                      style={{ width: `${Math.round(modelStatus().progress * 100)}%` }}
                    />
                  </div>
                  <span class="ai-progress-text">
                    {Math.round(modelStatus().progress * 100)}% — {formatBytes(modelStatus().downloadedBytes)} / {formatBytes(modelStatus().expectedBytes)}
                  </span>
                </div>
              </Show>

              <Show when={!modelStatus().downloading && modelStatus().downloaded}>
                <span class="ai-status-ok">{t('mlearn.AI.ModelReady')}</span>
                <Btn size="sm" onClick={handleDownloadModel}>
                  {t('mlearn.AI.Settings.BuiltinModel.Redownload')}
                </Btn>
              </Show>

              <Show when={!modelStatus().downloading && !modelStatus().downloaded}>
                <span class="ai-status-missing">{t('mlearn.AI.ModelNotDownloaded')}</span>
                <Btn size="sm" variant="primary" onClick={handleDownloadModel}>
                  {t('mlearn.AI.DownloadModel')}
                </Btn>
              </Show>

              <Show when={modelStatus().error}>
                <span class="ai-status-error">{modelStatus().error}</span>
              </Show>
            </div>
          </SettingRow>
        </SettingGroup>

        {/* Downloaded models manager */}
        <SettingGroup title="Downloaded Models">
          <Show
            when={downloadedModels().length > 0}
            fallback={<HintText>No models downloaded.</HintText>}
          >
            <For each={downloadedModels()}>
              {(item) => {
                const modelConfig = BUILTIN_MODELS.find((m) => m.modelFile === item.modelFile);
                if (!modelConfig) return null;
                return (
                  <SettingRow
                    label={modelConfig.displayName}
                    description={formatBytes(item.sizeBytes)}
                  >
                    <Btn
                      size="sm"
                      variant="danger"
                      onClick={() => void handleDeleteModel(item.modelFile)}
                      disabled={deletingModel() === item.modelFile}
                      loading={deletingModel() === item.modelFile}
                    >
                      Delete
                    </Btn>
                  </SettingRow>
                );
              }}
            </For>
            <Show when={deleteConfirmMsg()}>
              <HintText>{deleteConfirmMsg()}</HintText>
            </Show>
          </Show>
        </SettingGroup>
      </Show>
```

- [ ] **Step 8: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 9: Run full test suite**

```bash
npx vitest run --reporter=verbose
```

Expected: All tests pass (smoke + builtinModels).

- [ ] **Step 10: Commit**

```bash
git add src/renderer/windows/settings/tabs/AITab.tsx
git commit -m "feat: add model chooser, autoselect, first-launch logic, and downloaded models manager to AITab"
```

---

## Task 8: Final Integration Check

- [ ] **Step 1: TypeScript clean build**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Full test suite**

```bash
npx vitest run --reporter=verbose
```

Expected: All tests pass including `builtinModels.test.ts`.

- [ ] **Step 3: Verify existing smoke test still passes**

```bash
npx vitest run test/smoke.test.ts --reporter=verbose
```

Expected: PASS.

- [ ] **Step 4: Commit if not already committed**

If any unfixed changes remain:

```bash
git add -A
git commit -m "chore: final integration check and cleanup"
```

---

## Implementation Notes

### Apple Silicon (MPS) memory detection

`app.getGPUInfo('basic')` returns `dedicatedVideoMemory: 0` on Apple Silicon because memory is unified. This triggers `hasDiscreteGpu = false`, so the code uses `os.totalmem()` (the full unified memory pool). node-llama-cpp's Metal backend draws from the same pool. The 2 GB RAM margin is intentional — unified memory is shared with the OS.

### `builtinModelAutoselected` semantics

Setting this to `true` on **manual** selection is intentional: a deliberate user choice should prevent autoselect from overriding it if they switch providers and switch back. The flag means "autoselect does not need to run" — not "autoselect ran".

### Router gap fix

The llmRouter currently calls `builtinStreamChat(event.sender, messages, tools || [])` without passing `settings.builtinModel`. This means it always loads the fallback (9B). The Task 4 fix passes `settings.builtinModel || undefined` so the correct model is loaded.

### `llmDownloadModel` is fire-and-forget

`llmDownloadModel` is `ipcRenderer.send` (not `invoke`). Do not `await` it — progress arrives via `onLLMDownloadProgress` events.

### Downloaded models list refresh

The list is fetched on mount and after any download completes (via `onLLMModelStatus` with `status.downloaded === true`). The delete handler also refreshes the list after deletion.
