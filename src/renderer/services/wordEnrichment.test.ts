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
