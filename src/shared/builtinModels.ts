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
