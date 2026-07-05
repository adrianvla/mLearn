import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';

const userDataPath = '/tmp/mlearn-anki-service-test';
let mockSettings: Settings;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => userDataPath),
}));

vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => mockSettings),
  loadLangData: vi.fn(() => ({
    ja: {
      name: 'Japanese',
      translatable: [],
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        wordIndexStrategy: {
          type: 'character-containment',
          characterFilter: 'non-ascii',
        },
      },
    },
  })),
}));

function ankiResponse(result: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ result, error: null }),
  } as Response;
}

const japaneseCard = {
  cardId: 101,
  fields: {
    Japanese: { value: '勉強', order: 0 },
    Kana: { value: 'べんきょう', order: 1 },
    English: { value: 'study', order: 2 },
  },
  factor: 2500,
  due: 12,
  queue: 2,
  type: 2,
  interval: 30,
  mod: 1700000000,
};

const compoundCard = {
  cardId: 202,
  fields: {
    Japanese: { value: '日本語', order: 0 },
    Kana: { value: 'にほんご', order: 1 },
    English: { value: 'Japanese language', order: 2 },
  },
  factor: 1800,
  due: 5,
  queue: 0,
  type: 0,
  interval: 0,
  mod: 1700000010,
};

describe('ankiService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    fs.rmSync(userDataPath, { recursive: true, force: true });
    mockSettings = {
      ...DEFAULT_SETTINGS,
      use_anki: true,
      language: 'ja',
      ankiConnectUrl: 'http://127.0.0.1:8765',
      anki_field_expression: 'Japanese',
      anki_field_reading: 'Kana',
      anki_field_meaning: 'English',
    };
  });

  it('hydrates cards from AnkiConnect, applies configured field mapping, and returns exact card lookup', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(ankiResponse([101]))
      .mockResolvedValueOnce(ankiResponse([japaneseCard]));
    const { refreshAnkiCards, getAnkiCard } = await import('./ankiService');

    const result = await refreshAnkiCards();
    const lookup = getAnkiCard('勉強');

    expect(result).toEqual({ ok: true, source: 'anki' });
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8765', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'findCards', params: { query: 'deck:*' }, version: 6 }),
    }));
    expect(lookup.error).toBe(false);
    expect(lookup.poor).toBe(false);
    expect(lookup.cards[0].fields.Expression.value).toBe('勉強');
    expect(lookup.cards[0].fields.Reading.value).toBe('べんきょう');
    expect(lookup.cards[0].fields.Meaning.value).toBe('study');
  });

  it('returns fuzzy card matches using the same character-overlap shape as the Python backend', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ankiResponse([101, 202]))
      .mockResolvedValueOnce(ankiResponse([japaneseCard, compoundCard]));
    const { refreshAnkiCards, getAnkiCard } = await import('./ankiService');

    await refreshAnkiCards();
    const lookup = getAnkiCard('日本');

    expect(lookup.error).toBe(false);
    expect(lookup.poor).toBe(true);
    expect(lookup.cards.map((card) => card.cardId)).toEqual([202]);
  });

  it('loads the json cache when AnkiConnect is unavailable', async () => {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(path.join(userDataPath, 'anki-cache.json'), JSON.stringify({
      all_cards: [{
        ...japaneseCard,
        fields: {
          ...japaneseCard.fields,
          Expression: { value: '勉強', order: 0 },
          Reading: { value: 'べんきょう', order: 1 },
          Meaning: { value: 'study', order: 2 },
        },
      }],
      cards_per_id: {
        101: {
          ...japaneseCard,
          fields: {
            ...japaneseCard.fields,
            Expression: { value: '勉強', order: 0 },
            Reading: { value: 'べんきょう', order: 1 },
            Meaning: { value: 'study', order: 2 },
          },
        },
      },
      words_ids: { '勉強': 101 },
      who_contain: { '勉': [['勉強', 101]], '強': [['勉強', 101]] },
    }));
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const { refreshAnkiCards, getAnkiWordsPayload } = await import('./ankiService');

    const result = await refreshAnkiCards();
    const payload = getAnkiWordsPayload();

    expect(result).toEqual({ ok: true, source: 'cache', reason: 'connection_failed' });
    expect(payload.words).toEqual(['勉強']);
    expect(payload.cards[0]).toMatchObject({
      word: '勉強',
      cardId: 101,
      factor: 2500,
      due: 12,
      queue: 2,
      type: 2,
      interval: 30,
      mod: 1700000000,
    });
  });

  it('reports no_valid_cards when AnkiConnect returns cards without usable expression fields', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ankiResponse([303]))
      .mockResolvedValueOnce(ankiResponse([{ cardId: 303, fields: { Back: { value: 'only back', order: 0 } } }]));
    const { refreshAnkiCards } = await import('./ankiService');

    const result = await refreshAnkiCards();

    expect(result).toEqual({ ok: false, source: 'anki', reason: 'no_valid_cards' });
  });
});
