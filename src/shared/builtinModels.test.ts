import { describe, expect, it } from 'vitest';
import { autoselectBuiltinModel } from './builtinModels';

describe('built-in model selection on unified memory', () => {
  it('selects the interactive tier for a 16 GB Mac', () => {
    expect(autoselectBuiltinModel({ hasDiscreteGpu: false, dedicatedVramBytes: 0, totalRamBytes: 16 * 1024 ** 3 }).id)
      .toBe('gemma-4-e4b-it');
  });

  it('can select the larger tier when the machine has room for it', () => {
    expect(autoselectBuiltinModel({ hasDiscreteGpu: false, dedicatedVramBytes: 0, totalRamBytes: 20 * 1024 ** 3 }).id)
      .toBe('gemma-4-12b-it');
  });
});
