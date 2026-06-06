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
  it('warns for local Reader OCR when turbo is disabled on low-memory hosts', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ocrProvider: 'local',
      ocrTurboMode: false,
    };

    const warnings = evaluateSettingRequirementWarnings(settings, 'reader', makeMemoryInfo(8));

    expect(warnings).toHaveLength(1);
    expect(warnings[0].config.id).toBe('reader-ocr-turbo-low-ram');
  });

  it('uses DEFAULT_SETTINGS when a migrated setting is missing', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ocrProvider: 'local',
      ocrTurboMode: undefined,
    };

    const warnings = evaluateSettingRequirementWarnings(settings, 'reader', makeMemoryInfo(8));

    expect(warnings).toHaveLength(1);
  });

  it('does not warn when turbo is enabled', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ocrProvider: 'local',
      ocrTurboMode: true,
    };

    expect(evaluateSettingRequirementWarnings(settings, 'reader', makeMemoryInfo(8))).toHaveLength(0);
  });

  it('does not warn for cloud OCR', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ocrProvider: 'cloud',
      ocrTurboMode: false,
    };

    expect(evaluateSettingRequirementWarnings(settings, 'reader', makeMemoryInfo(8))).toHaveLength(0);
  });

  it('does not warn above the RAM threshold', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ocrProvider: 'local',
      ocrTurboMode: false,
    };

    expect(evaluateSettingRequirementWarnings(settings, 'reader', makeMemoryInfo(8.1))).toHaveLength(0);
  });

  it('formats RAM for localized warning parameters', () => {
    expect(formatRamGb(7.75)).toBe('7.8');
    expect(formatRamGb(16)).toBe('16');
  });
});
