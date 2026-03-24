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

  it('selects 4B with 13 GB VRAM (enough for 4B, not 9B)', () => {
    const info: SystemMemoryInfo = {
      hasDiscreteGpu: true,
      dedicatedVramBytes: 13 * GiB,
      totalRamBytes: 32 * GiB,
    };
    const model = autoselectBuiltinModel(info);
    // 13 - 0.5 = 12.5 GB available; 9B requires 14.5 → too big; 4B requires 12.0 ≤ 12.5 → fits
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
