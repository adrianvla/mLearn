import { describe, expect, it } from 'vitest';
import type { LanguageData } from '@shared/types';
import { buildPartOfSpeechColorEntries } from './CustomizationTab';

describe('buildPartOfSpeechColorEntries', () => {
  it('orders translatable POS first and keeps package metadata with user overrides', () => {
    const languageData: LanguageData = {
      name: 'Test',
      name_translated: 'Test',
      settings: { fixed: {} },
      freq: [],
      textProcessing: {
        partOfSpeech: {
          translatable: ['noun', 'verb'],
          aliases: {
            NOUN: 'noun',
            VERB: 'verb',
          },
          colors: {
            verb: '#ff0000',
            particle: '#00ff00',
            noun: '#0000ff',
          },
        },
      },
    };

    const entries = buildPartOfSpeechColorEntries(languageData, {
      verb: '#111111',
      custom: '#222222',
    });

    expect(entries.map((entry) => entry.pos)).toEqual(['noun', 'verb', 'custom', 'particle']);
    expect(entries.find((entry) => entry.pos === 'noun')).toMatchObject({
      defaultColor: '#0000ff',
      userColor: '',
      aliases: ['NOUN'],
      isTranslatable: true,
    });
    expect(entries.find((entry) => entry.pos === 'verb')).toMatchObject({
      defaultColor: '#ff0000',
      userColor: '#111111',
      aliases: ['VERB'],
      isTranslatable: true,
    });
    expect(entries.find((entry) => entry.pos === 'custom')).toMatchObject({
      defaultColor: '',
      userColor: '#222222',
      isTranslatable: false,
    });
  });
});
