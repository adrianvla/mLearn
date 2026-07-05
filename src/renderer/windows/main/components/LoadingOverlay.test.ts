import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../../shared/types';
import { buildInstallOptionsFromSettings, isInstallerRequiredError, startRequiredComponentRepair } from './LoadingOverlay';

const startInstallMock = vi.fn();

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    installer: {
      startInstall: startInstallMock,
    },
  }),
}));

describe('LoadingOverlay installer helpers', () => {
  it('detects Python runtime installer-required messages', () => {
    expect(isInstallerRequiredError('The local Python runtime is not installed.')).toBe(true);
    expect(isInstallerRequiredError('Language data is not installed for ja.')).toBe(false);
    expect(isInstallerRequiredError(null)).toBe(false);
  });

  it('builds component install options from current settings', () => {
    const settings = {
      llmEnabled: false,
      ocrEnabled: true,
      voiceEnabled: false,
    } as Settings;

    expect(buildInstallOptionsFromSettings(settings)).toEqual({
      includeLLM: false,
      includeOCR: true,
      includeVoice: false,
    });
  });

  it('starts a component repair install from current settings', () => {
    startInstallMock.mockClear();

    startRequiredComponentRepair({
      llmEnabled: false,
      ocrEnabled: true,
      voiceEnabled: false,
    } as Settings);

    expect(startInstallMock).toHaveBeenCalledWith({
      includeLLM: false,
      includeOCR: true,
      includeVoice: false,
    });
  });
});
