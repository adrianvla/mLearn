import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localesDir = path.resolve(__dirname, '../../root-of-app/locales');

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, nextKey));
    } else {
      keys.push(nextKey);
    }
  }
  return keys;
}

describe('locale parity', () => {
  it('all locale files match the English key structure', () => {
    const englishPath = path.join(localesDir, 'lang.en.json');
    const english = JSON.parse(fs.readFileSync(englishPath, 'utf-8')) as Record<string, unknown>;
    const englishKeys = flattenKeys(english).sort();

    const localeFiles = fs.readdirSync(localesDir)
      .filter((file) => /^lang\..+\.json$/.test(file) && file !== 'lang.en.json');

    for (const file of localeFiles) {
      const locale = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf-8')) as Record<string, unknown>;
      const localeKeys = flattenKeys(locale).sort();
      expect(localeKeys, `${file} keys should match lang.en.json`).toEqual(englishKeys);
    }
  });
});
