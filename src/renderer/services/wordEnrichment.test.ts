import { describe, it, expect, vi } from 'vitest';
import { enrichWord } from './wordEnrichment';

const entry = (definitions: string | string[], extra: Record<string, unknown> = {}) => ({ definitions, reading: '', ...extra });

describe('enrichWord', () => {
  it('joins array definitions into the card back', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry(['a room', 'a chamber'])] });
    const result = await enrichWord({ word: ' Chamber ', language: 'en' }, { translate });
    expect(result?.back).toBe('a room; a chamber');
    expect(translate).toHaveBeenCalledWith('Chamber', 'en', undefined);
  });

  it('returns null when the package has no entry', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [] });
    expect(await enrichWord({ word: 'x', language: 'en' }, { translate })).toBeNull();
  });

  it('returns null when the entry carries no definition', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry('')] });
    expect(await enrichWord({ word: 'x', language: 'en' }, { translate })).toBeNull();
  });

  it('keeps a reading the card already has over the dictionary reading', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry('dark', { reading: 'くらい' })] });
    const result = await enrichWord(
      { word: '暗い', language: 'ja', currentContent: { reading: 'くら.い' } },
      { translate },
    );
    expect(result?.reading).toBe('くら.い');
  });

  it('falls back to the dictionary reading when the card has none', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry('dark', { reading: 'くらい' })] });
    const result = await enrichWord({ word: '暗い', language: 'ja' }, { translate });
    expect(result?.reading).toBe('くらい');
  });

  it('carries the reading, pitch record, and dictionary package identity together', async () => {
    const languageData = {
      name: 'Japanese', settings: { fixed: {} }, prosody: { type: 'japanese-pitch-accent' },
      languageData: {
        activationGeneration: 'generation-a', version: 'ja-v2', assets: [],
        dictionaryPacks: { en: { targetLanguage: 'en', name: 'English', version: 'dict-v3', assets: [] } },
      },
    } as unknown as import('../../shared/types').LanguageData;
    const translate = vi.fn().mockResolvedValue({
      data: [
        entry('approach', { reading: 'せまる' }),
        entry('', { reading: 'せる' }),
        [
          ['迫る', 'pitch', { reading: 'せまる', pitches: [{ position: 2 }] }],
          ['迫る', 'pitch', { reading: 'せる', pitches: [{ position: 1 }] }],
        ],
      ],
      resolution: { selectedId: 'jmdict:1475720' },
    });
    const result = await enrichWord({ word: '迫る', language: 'ja', languageData, dictionaryTargetLanguage: 'en' }, { translate });
    expect(result).toMatchObject({ reading: 'せまる', prosody: { position: 2 } });
    expect(result?.fieldProvenance?.prosody).toMatchObject({
      origin: 'dictionary-prosody', generatedValue: 2,
      source: { language: 'ja', dictionaryTargetLanguage: 'en', packageGeneration: 'generation-a', packageVersion: 'ja-v2', dictionaryPackVersion: 'dict-v3', selectedEntryId: 'jmdict:1475720', reading: 'せまる' },
      raw: { reading: 'せまる', pitches: [{ position: 2 }] },
    });
    expect(result?.fieldProvenance?.reading).toMatchObject({ origin: 'dictionary-entry', generatedValue: 'せまる' });
  });

  it('does not assign a pitch when an observed fallback reading is absent from the response', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry('approach'), {}, { pitches: [{ position: 1 }] }] });
    const result = await enrichWord({ word: '迫る', language: 'ja', fallbackReading: 'せまる' }, { translate });
    expect(result?.reading).toBe('せまる');
    expect(result?.prosody).toBeUndefined();
  });

  it('reads the configured dictionary target language from settings', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry('dark')] });
    await enrichWord({
      word: 'dark',
      language: 'en',
      settings: { language: 'en', uiLanguage: 'de', dictionaryTargetLanguages: { en: 'de' } },
      installedTargetLanguages: ['de'],
    }, { translate });
    expect(translate).toHaveBeenCalledWith('dark', 'en', { dictionaryTargetLanguage: 'de' });
  });

  it('exposes the secondary entry as definitions', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry('first'), entry(['d1', 'd2'])] });
    const result = await enrichWord({ word: 'x', language: 'en' }, { translate });
    expect(result?.definition).toEqual(['d1', 'd2']);
  });

  it('reads the meaning from a requested definition index', async () => {
    const translate = vi.fn().mockResolvedValue({ data: [entry('first'), entry('second')] });
    const result = await enrichWord({ word: 'x', language: 'en', definitionIndex: 1 }, { translate });
    expect(result?.back).toBe('second');
  });

  it('skips a blank word without querying the dictionary', async () => {
    const translate = vi.fn();
    expect(await enrichWord({ word: '   ', language: 'en' }, { translate })).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });
});
