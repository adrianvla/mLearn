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

  it('does not keep obsolete kanji-grid localization keys', () => {
    const localeFiles = fs.readdirSync(localesDir)
      .filter((file) => /^lang\..+\.json$/.test(file));

    for (const file of localeFiles) {
      const locale = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf-8')) as Record<string, unknown>;
      const keys = flattenKeys(locale);

      expect(keys, `${file} should use CharacterGrid localization keys`).not.toContain('mlearn.KanjiGrid.Title');
      expect(keys, `${file} should use ViewCharacterGrid localization keys`).not.toContain('mlearn.Statistics.Actions.ViewKanjiGrid');
      expect(keys, `${file} should use ShowCharacterGrid localization keys`).not.toContain('mlearn.Menu.ShowKanjiGrid');
    }
  });

  it('does not keep obsolete exam-centric study localization keys', () => {
    const localeFiles = fs.readdirSync(localesDir)
      .filter((file) => /^lang\..+\.json$/.test(file));

    for (const file of localeFiles) {
      const locale = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf-8')) as Record<string, unknown>;
      const keys = flattenKeys(locale);

      expect(keys, `${file} should use LevelStudy localization keys`).not.toContain('mlearn.ExamCentricStudy.Title');
      expect(keys, `${file} should use LevelStudy tab keys`).not.toContain('mlearn.ExamCentricStudy.Tabs.ExamStudy');
      expect(keys, `${file} should use LevelStudy content keys`).not.toContain('mlearn.ExamStudy.Coverage.Title');
      expect(keys, `${file} should use OpenLevelStudy action keys`).not.toContain('mlearn.Statistics.Actions.OpenExamCentricStudy');
      expect(keys, `${file} should use WordsByLevel keys`).not.toContain('mlearn.Statistics.WordsByExamLevel');
      expect(keys, `${file} should use LevelStudy menu keys`).not.toContain('mlearn.Menu.ExamCentricStudy');

      expect(keys, `${file} should include LevelStudy title`).toContain('mlearn.LevelStudy.Title');
      expect(keys, `${file} should include LevelStudy tabs`).toContain('mlearn.LevelStudy.Tabs.LevelStudy');
      expect(keys, `${file} should include LevelStudy content`).toContain('mlearn.LevelStudy.Coverage.Title');
      expect(keys, `${file} should include OpenLevelStudy action`).toContain('mlearn.Statistics.Actions.OpenLevelStudy');
      expect(keys, `${file} should include WordsByLevel stats`).toContain('mlearn.Statistics.WordsByLevel');
      expect(keys, `${file} should include LevelStudy menu`).toContain('mlearn.Menu.LevelStudy');
    }
  });
});
