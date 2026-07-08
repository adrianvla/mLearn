import { describe, expect, it } from 'vitest';
import { evaluateSettingRequirementWarnings, formatRamGb } from './settingRequirements';
import { DEFAULT_SETTINGS, type Settings, type SystemMemoryInfo } from './types';

function makeMemoryInfo(totalRamGb: number): SystemMemoryInfo {
  return {
    hasDiscreteGpu: false,
    dedicatedVramBytes: 0,
    totalRamBytes: totalRamGb * 1024 ** 3,
  };
}

describe('setting requirements', () => {
  it('has no reader OCR low-memory warning', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ocrProvider: 'local',
    };

    const warnings = evaluateSettingRequirementWarnings(settings, 'reader', makeMemoryInfo(8));

    expect(evaluateSettingRequirementWarnings(settings, 'reader', makeMemoryInfo(8.1))).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('formats RAM for localized warning parameters', () => {
    expect(formatRamGb(7.75)).toBe('7.8');
    expect(formatRamGb(16)).toBe('16');
  });
});
