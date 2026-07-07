import { describe, expect, it, vi } from 'vitest';
import type { LanguageDataCatalogStatus, Settings } from '../../../../shared/types';
import {
  buildInstallOptionsFromSettings,
  getLanguageSetupRequirement,
  isInstallerRequiredError,
  startRequiredComponentRepair,
} from './LoadingOverlay';

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

  it('requires language setup when the active language data is missing', () => {
    expect(getLanguageSetupRequirement(
      { language: 'ja', dictionaryTargetLanguages: {} },
      false,
    )).toEqual({ required: true, reason: 'learning-language' });
  });

  it('requires language setup when the selected dictionary pack is missing', () => {
    const status = {
      language: 'ja',
      name: 'Japanese',
      dataRoot: '/tmp/language-data',
      installed: true,
      totalBytes: 1,
      installedBytes: 1,
      missingRequiredAssets: [],
      assets: [],
      dictionaryPacks: [
        {
          targetLanguage: 'fr',
          name: 'French',
          installed: false,
          totalBytes: 1,
          installedBytes: 0,
          missingRequiredAssets: ['dictionaries/ja/fr/dictionary.db'],
          assets: [],
        },
      ],
    } satisfies LanguageDataCatalogStatus;

    expect(getLanguageSetupRequirement(
      { language: 'ja', dictionaryTargetLanguages: { ja: 'fr' } },
      true,
      status,
    )).toEqual({ required: true, reason: 'dictionary-language' });
  });

  it('does not require language setup when active language and dictionary are installed', () => {
    const status = {
      language: 'ja',
      name: 'Japanese',
      dataRoot: '/tmp/language-data',
      installed: true,
      totalBytes: 1,
      installedBytes: 1,
      missingRequiredAssets: [],
      assets: [],
      dictionaryPacks: [
        {
          targetLanguage: 'en',
          name: 'English',
          installed: true,
          totalBytes: 1,
          installedBytes: 1,
          missingRequiredAssets: [],
          assets: [],
        },
      ],
    } satisfies LanguageDataCatalogStatus;

    expect(getLanguageSetupRequirement(
      { language: 'ja', dictionaryTargetLanguages: { ja: 'en' } },
      true,
      status,
    )).toEqual({ required: false });
  });
});
