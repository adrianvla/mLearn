import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../../shared/types';
import { resolveTtsLanguageData } from './ttsLanguageData';

const activeLanguageData: LanguageData = {
  name: 'Japanese active language',
  colour_codes: {},
  settings: { fixed: {} },
};

const savedCardLanguageData: LanguageData = {
  name: 'German saved-card language',
  colour_codes: {},
  settings: { fixed: {} },
};

describe('resolveTtsLanguageData', () => {
  it('prefers explicit language data supplied by the caller', () => {
    const explicitLanguageData: LanguageData = {
      name: 'Explicit',
      colour_codes: {},
      settings: { fixed: {} },
    };

    expect(resolveTtsLanguageData('de', {
      explicitLanguageData,
      installedLanguageData: { de: savedCardLanguageData },
      activeLanguage: 'ja',
      activeLanguageData,
    })).toBe(explicitLanguageData);
  });

  it('uses installed metadata for a saved-card language that is not active', () => {
    expect(resolveTtsLanguageData('de', {
      installedLanguageData: { de: savedCardLanguageData },
      activeLanguage: 'ja',
      activeLanguageData,
    })).toBe(savedCardLanguageData);
  });

  it('uses active metadata only for the active language fallback', () => {
    expect(resolveTtsLanguageData('ja', {
      installedLanguageData: {},
      activeLanguage: 'ja',
      activeLanguageData,
    })).toBe(activeLanguageData);

    expect(resolveTtsLanguageData('de', {
      installedLanguageData: {},
      activeLanguage: 'ja',
      activeLanguageData,
    })).toBeNull();
  });
});
