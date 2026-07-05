import { describe, expect, it, vi } from 'vitest';
import type { LanguageData } from '../../shared/types';
import { getLocalizedLanguageName } from './languageDisplayName';

const thirdPartyLanguage: LanguageData = {
  name: 'Arabic',
  name_translated: 'العربية',
  colour_codes: {},
  settings: { fixed: {} },
};

describe('getLocalizedLanguageName', () => {
  it('uses localized UI names for known language codes', () => {
    const t = (key: string) => key === 'mlearn.Languages.ar' ? 'Arabisch' : key;

    expect(getLocalizedLanguageName('ar', thirdPartyLanguage, t, 'Unknown', 'en')).toBe('Arabisch');
  });

  it('uses Intl display names for standard codes without app-localized names', () => {
    const t = (key: string) => key;

    expect(getLocalizedLanguageName('ar', thirdPartyLanguage, t, 'Unknown', 'de')).toBe('Arabisch');
  });

  it('falls back to installed language metadata for unlocalized package languages', () => {
    const t = (key: string) => key;

    expect(getLocalizedLanguageName('x-mlearn-ar', thirdPartyLanguage, t, 'Unknown')).toBe('العربية');
  });

  it('does not request an empty mlearn.Languages localization key', () => {
    const t = vi.fn((key: string) => key);

    expect(getLocalizedLanguageName('', null, t, 'Unknown')).toBe('Unknown');
    expect(t).not.toHaveBeenCalledWith('mlearn.Languages.');
  });
});
