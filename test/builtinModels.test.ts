import { describe, it, expect } from 'vitest';
import {
  autoselectBuiltinModel,
  BUILTIN_MODELS,
  getBuiltinModelByFile,
  getModelUrl,
  isLegacyBuiltinModelFile,
} from '../src/shared/builtinModels';
import type { SystemMemoryInfo } from '../src/shared/types';

const GiB = 1024 ** 3;

function unifiedMemory(totalGb: number): SystemMemoryInfo {
  return {
    hasDiscreteGpu: false,
    dedicatedVramBytes: 0,
    totalRamBytes: totalGb * GiB,
  };
}

function discreteGpu(vramGb: number): SystemMemoryInfo {
  return {
    hasDiscreteGpu: true,
    dedicatedVramBytes: vramGb * GiB,
    totalRamBytes: 32 * GiB,
  };
}

describe('autoselectBuiltinModel', () => {
  it.each([
    [32, 'gemma-4-26b-a4b-it'],
    [24, 'gemma-4-26b-a4b-it'],
    [16, 'gemma-4-12b-it'],
    [12, 'gemma-4-e4b-it'],
    [8, 'gemma-4-e2b-it'],
    [4, 'gemma-4-e2b-it'],
  ])('selects the expected tier for %d GB unified memory', (totalGb, expectedId) => {
    expect(autoselectBuiltinModel(unifiedMemory(totalGb)).id).toBe(expectedId);
  });

  it.each([
    [14, 'gemma-4-26b-a4b-it'],
    [13, 'gemma-4-12b-it'],
    [8.5, 'gemma-4-e4b-it'],
    [6.5, 'gemma-4-e2b-it'],
  ])('selects the expected tier for %d GB dedicated VRAM', (vramGb, expectedId) => {
    expect(autoselectBuiltinModel(discreteGpu(vramGb)).id).toBe(expectedId);
  });
});

describe('BUILTIN_MODELS registry', () => {
  it('defines the requested Gemma 4 tiers and hardware metadata', () => {
    expect(BUILTIN_MODELS).toEqual([
      expect.objectContaining({
        id: 'gemma-4-e2b-it',
        tier: 'Lite',
        displayName: 'Gemma 4 E2B IT',
        quantization: 'Official QAT Q4_0',
        fileSizeGb: 3.35,
        estimatedMemoryGbMin: 4.5,
        estimatedMemoryGbMax: 6,
        targetMemoryGb: 8,
      }),
      expect.objectContaining({
        id: 'gemma-4-e4b-it',
        tier: 'Fast',
        displayName: 'Gemma 4 E4B IT',
        quantization: 'Official QAT Q4_0',
        fileSizeGb: 5.15,
        estimatedMemoryGbMin: 6.5,
        estimatedMemoryGbMax: 8,
        targetMemoryGb: 12,
      }),
      expect.objectContaining({
        id: 'gemma-4-12b-it',
        tier: 'Recommended',
        displayName: 'Gemma 4 12B IT',
        quantization: 'Official QAT Q4_0',
        fileSizeGb: 6.98,
        estimatedMemoryGbMin: 8.5,
        estimatedMemoryGbMax: 10.5,
        targetMemoryGb: 16,
      }),
      expect.objectContaining({
        id: 'gemma-4-26b-a4b-it',
        tier: 'Best',
        displayName: 'Gemma 4 26B-A4B IT',
        quantization: 'Unsloth UD-Q2_K_XL',
        fileSizeGb: 10.5,
        estimatedMemoryGbMin: 13.1,
        estimatedMemoryGbMax: 13.1,
        targetMemoryGb: 24,
      }),
    ]);
  });
});

describe('getBuiltinModelByFile', () => {
  it('finds a model by filename', () => {
    const model = getBuiltinModelByFile('gemma-4-12b-it-qat-q4_0.gguf');
    expect(model?.id).toBe('gemma-4-12b-it');
  });

  it('returns undefined for an unknown file', () => {
    expect(getBuiltinModelByFile('unknown.gguf')).toBeUndefined();
  });
});

describe('isLegacyBuiltinModelFile', () => {
  it.each([
    'Qwen3.5-0.8B-Q4_K_M.gguf',
    'Qwen3.5-2B-Q4_K_M.gguf',
    'Qwen3.5-4B-Q4_K_M.gguf',
    'Qwen3.5-9B-Q4_K_M.gguf',
  ])('recognizes the replaced model file %s', (modelFile) => {
    expect(isLegacyBuiltinModelFile(modelFile)).toBe(true);
  });

  it('does not classify other model files as legacy', () => {
    expect(isLegacyBuiltinModelFile('custom.gguf')).toBe(false);
  });
});

describe('getModelUrl', () => {
  it.each([
    [
      'gemma-4-e2b-it',
      'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf',
    ],
    [
      'gemma-4-e4b-it',
      'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf',
    ],
    [
      'gemma-4-12b-it',
      'https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf/resolve/main/gemma-4-12b-it-qat-q4_0.gguf',
    ],
    [
      'gemma-4-26b-a4b-it',
      'https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-Q2_K_XL.gguf',
    ],
  ])('builds the verified Hugging Face URL for %s', (id, expectedUrl) => {
    const model = BUILTIN_MODELS.find((candidate) => candidate.id === id);
    expect(model).toBeDefined();
    expect(getModelUrl(model!)).toBe(expectedUrl);
  });
});
