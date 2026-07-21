/**
 * Built-in LLM model registry and hardware-aware autoselect logic.
 * Pure functions — no Electron, no Node.js APIs.
 */

import type { BuiltinModelConfig, SystemMemoryInfo } from './types';

export const BUILTIN_MODELS: BuiltinModelConfig[] = [
  {
    id: 'gemma-4-e2b-it',
    tier: 'Lite',
    displayName: 'Gemma 4 E2B IT',
    quantization: 'Official QAT Q4_0',
    modelFile: 'gemma-4-E2B_q4_0-it.gguf',
    modelRepo: 'google/gemma-4-E2B-it-qat-q4_0-gguf',
    estimatedMemoryGbMin: 4.5,
    estimatedMemoryGbMax: 6,
    targetMemoryGb: 8,
    fileSizeGb: 3.35,
  },
  {
    id: 'gemma-4-e4b-it',
    tier: 'Fast',
    displayName: 'Gemma 4 E4B IT',
    quantization: 'Official QAT Q4_0',
    modelFile: 'gemma-4-E4B_q4_0-it.gguf',
    modelRepo: 'google/gemma-4-E4B-it-qat-q4_0-gguf',
    estimatedMemoryGbMin: 6.5,
    estimatedMemoryGbMax: 8,
    targetMemoryGb: 12,
    fileSizeGb: 5.15,
  },
  {
    id: 'gemma-4-12b-it',
    tier: 'Recommended',
    displayName: 'Gemma 4 12B IT',
    quantization: 'Official QAT Q4_0',
    modelFile: 'gemma-4-12b-it-qat-q4_0.gguf',
    modelRepo: 'google/gemma-4-12B-it-qat-q4_0-gguf',
    estimatedMemoryGbMin: 8.5,
    estimatedMemoryGbMax: 10.5,
    targetMemoryGb: 16,
    fileSizeGb: 6.98,
  },
  {
    id: 'gemma-4-26b-a4b-it',
    tier: 'Best',
    displayName: 'Gemma 4 26B-A4B IT',
    quantization: 'Unsloth UD-Q2_K_XL',
    modelFile: 'gemma-4-26B-A4B-it-UD-Q2_K_XL.gguf',
    modelRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    estimatedMemoryGbMin: 13.1,
    estimatedMemoryGbMax: 13.1,
    targetMemoryGb: 24,
    fileSizeGb: 10.5,
  },
];

const VRAM_MARGIN_GB = 0.5;

const LEGACY_BUILTIN_MODEL_FILES = new Set([
  'Qwen3.5-0.8B-Q4_K_M.gguf',
  'Qwen3.5-2B-Q4_K_M.gguf',
  'Qwen3.5-4B-Q4_K_M.gguf',
  'Qwen3.5-9B-Q4_K_M.gguf',
]);

export function autoselectBuiltinModel(memInfo: SystemMemoryInfo): BuiltinModelConfig {
  const GiB = 1024 ** 3;
  const availableGb = memInfo.hasDiscreteGpu
    ? memInfo.dedicatedVramBytes / GiB - VRAM_MARGIN_GB
    : memInfo.totalRamBytes / GiB;

  const sorted = [...BUILTIN_MODELS].sort((a, b) => b.targetMemoryGb - a.targetMemoryGb);
  const best = sorted.find((model) => {
    const requiredGb = memInfo.hasDiscreteGpu
      ? model.estimatedMemoryGbMax
      : model.targetMemoryGb;
    return requiredGb <= availableGb;
  });
  return best ?? BUILTIN_MODELS[0];
}

export function isLegacyBuiltinModelFile(modelFile: unknown): modelFile is string {
  return typeof modelFile === 'string' && LEGACY_BUILTIN_MODEL_FILES.has(modelFile);
}

export function getBuiltinModelByFile(modelFile: string): BuiltinModelConfig | undefined {
  return BUILTIN_MODELS.find((m) => m.modelFile === modelFile);
}

export function getModelUrl(model: BuiltinModelConfig): string {
  return `https://huggingface.co/${model.modelRepo}/resolve/main/${model.modelFile}`;
}
