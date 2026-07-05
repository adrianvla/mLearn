import { describe, expect, it } from 'vitest';
import { getBundledLocaleCodes, loadBundledLocaleStrings } from './bundledLanguageAssets';

describe('bundledLanguageAssets', () => {
  it('lists bundled locale codes', () => {
    expect(getBundledLocaleCodes()).toEqual(['de', 'en', 'fr', 'ja', 'ru', 'zh']);
  });

  it('loads bundled locale strings', async () => {
    const localeStrings = await loadBundledLocaleStrings('de');
    expect(localeStrings).not.toBeNull();
    expect(localeStrings?.mlearn).toBeDefined();
  });
});
