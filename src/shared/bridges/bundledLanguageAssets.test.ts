import { describe, expect, it } from 'vitest';
import { getBundledLanguageCodes, getBundledLocaleCodes, loadBundledLanguageData, loadBundledLocaleStrings } from './bundledLanguageAssets';

describe('bundledLanguageAssets', () => {
  it('lists bundled locale codes', () => {
    expect(getBundledLocaleCodes()).toEqual(['de', 'en', 'fr', 'ja', 'ru']);
  });

  it('lists bundled learning language codes', () => {
    expect(getBundledLanguageCodes()).toEqual(['de', 'ja']);
  });

  it('loads bundled language data', async () => {
    const langData = await loadBundledLanguageData();
    expect(Object.keys(langData).sort()).toEqual(['de', 'ja']);
    expect(langData.de.name).toBe('German');
  });

  it('loads bundled locale strings', async () => {
    const localeStrings = await loadBundledLocaleStrings('de');
    expect(localeStrings).not.toBeNull();
    expect(localeStrings?.mlearn).toBeDefined();
  });
});
