import { describe, expect, it, vi } from 'vitest';
import type { LanguageData } from '../../shared/types';
import { getLocalizedLanguageName, getDisplayLanguageName, getBilingualLanguageName, getNativeLanguageName } from './languageDisplayName';

const thirdPartyLanguage: LanguageData = {
  name: 'Arabic',
  name_translated: 'العربية',
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

describe('getDisplayLanguageName', () => {
  it('uses the UI-language translation when available', () => {
    const t = (key: string) => key === 'mlearn.Languages.ja' ? 'Japanisch' : key;

    expect(getDisplayLanguageName('ja', thirdPartyLanguage, t, 'de', 'Unbekannt')).toBe('Japanisch');
  });

  it('prefers the english metadata name for unlocalized custom codes', () => {
    const t = (key: string) => key;

    expect(getDisplayLanguageName('x-mlearn-ar', thirdPartyLanguage, t, 'en')).toBe('Arabic');
  });
});

describe('getBilingualLanguageName', () => {
  it('shows the localized name with the native name in parentheses', () => {
    const t = (key: string) => key === 'mlearn.Languages.ja' ? 'Japanisch' : key;

    expect(getBilingualLanguageName('ja', thirdPartyLanguage, t, 'de', 'Unbekannt', '日本語')).toBe('Japanisch (日本語)');
  });

  it('collapses to a single name when localized and native names are identical', () => {
    const t = (key: string) => key === 'mlearn.Languages.de' ? 'Deutsch' : key;

    expect(getBilingualLanguageName('de', null, t, 'de', 'Deutsch', 'Deutsch')).toBe('Deutsch');
  });

  it('uses the metadata english name as primary for unlocalized package languages', () => {
    const t = (key: string) => key;

    expect(getBilingualLanguageName('x-mlearn-ar', thirdPartyLanguage, t, 'en')).toBe('Arabic (العربية)');
  });

  it('resolves the native name from Intl for standard codes without metadata', () => {
    const t = (key: string) => key;

    expect(getBilingualLanguageName('en', null, t, 'de', 'Englisch')).toBe('Englisch (English)');
  });
});

describe('getNativeLanguageName', () => {
  it('returns the endonym for a standard code', () => {
    expect(getNativeLanguageName('en')).toBe('English');
  });

  it('returns an empty string for invalid codes', () => {
    expect(getNativeLanguageName('x-mlearn-ar')).toBe('');
  });
});
