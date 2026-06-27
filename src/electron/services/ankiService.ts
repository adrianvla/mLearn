import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../utils/platform';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types';
import { getLogger } from '../../shared/utils/logger';
import { loadSettings } from './settings';

const log = getLogger('electron.anki');
const ANKI_CONNECT_VERSION = 6;
const CACHE_FILENAME = 'anki-cache.json';

type AnkiField = {
  value: string;
  order?: number;
};

export type AnkiCard = {
  cardId: number;
  fields: Record<string, AnkiField>;
  factor?: number | null;
  due?: number | null;
  queue?: number | null;
  type?: number | null;
  interval?: number | null;
  mod?: number | null;
};

type AnkiCacheFile = {
  all_cards: AnkiCard[];
  cards_per_id: Record<string, AnkiCard>;
  words_ids: Record<string, number>;
  who_contain: Record<string, Array<[string, number]>>;
};

export type AnkiCardLookupResponse = {
  cards: AnkiCard[] | string[];
  error: boolean;
  poor: boolean;
};

export type AnkiRefreshResult = {
  ok: boolean;
  source: 'anki' | 'cache' | 'disabled';
  reason?: 'connection_failed' | 'no_valid_cards' | 'disabled' | 'cache_unavailable';
};

export type AnkiWordsPayload = {
  words: string[];
  cards: Array<{
    word: string;
    cardId?: number | null;
    factor?: number | null;
    due?: number | null;
    queue?: number | null;
    type?: number | null;
    interval?: number | null;
    mod?: number | null;
  }>;
};

let allCards: AnkiCard[] = [];
let cardsPerId = new Map<number, AnkiCard>();
let wordsIds = new Map<string, number>();
let whoContain = new Map<string, Array<[string, number]>>();
let getCardCache = new Map<string, AnkiCardLookupResponse>();

function cachePath(): string {
  return path.join(getUserDataPath(), CACHE_FILENAME);
}

function extractWords(text: string, language: string): string {
  if (language === 'ja' || language === 'zh' || language === 'ko') {
    return Array.from(text).filter((char) => char.charCodeAt(0) > 128).join('');
  }
  return text.trim();
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

function getAnkiFieldSetting(settings: Settings, key: 'anki_field_expression' | 'anki_field_reading' | 'anki_field_meaning'): string {
  return settings[key] || DEFAULT_SETTINGS[key];
}

async function ankiInvoke<T>(action: string, params: Record<string, unknown>, settings: Settings): Promise<T | null> {
  const ankiConnectUrl = settings.ankiConnectUrl || DEFAULT_SETTINGS.ankiConnectUrl;
  try {
    const response = await fetch(ankiConnectUrl, {
      method: 'POST',
      body: JSON.stringify({ action, params, version: ANKI_CONNECT_VERSION }),
    });
    const payload = await response.json() as { result?: T; error?: string | null };
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!('result' in payload)) {
      throw new Error('AnkiConnect response is missing result');
    }
    return payload.result as T;
  } catch (error) {
    log.error(`AnkiConnect ${action} failed:`, error);
    return null;
  }
}

function normalizeCardFields(card: AnkiCard, settings: Settings): AnkiCard | null {
  const normalized: AnkiCard = {
    ...card,
    fields: { ...card.fields },
  };
  const expressionField = getAnkiFieldSetting(settings, 'anki_field_expression');
  const readingField = getAnkiFieldSetting(settings, 'anki_field_reading');
  const meaningField = getAnkiFieldSetting(settings, 'anki_field_meaning');

  if (normalized.fields[expressionField] && expressionField !== 'Expression') {
    normalized.fields.Expression = normalized.fields[expressionField];
  }
  if (normalized.fields[readingField] && readingField !== 'Reading') {
    normalized.fields.Reading = normalized.fields[readingField];
  }
  if (normalized.fields[meaningField] && meaningField !== 'Meaning') {
    normalized.fields.Meaning = normalized.fields[meaningField];
  }

  if (normalized.fields.Expression) {
    return normalized;
  }

  const front = normalized.fields.Front?.value;
  if (!front || !front.includes('</intelligent_definition>')) {
    return null;
  }

  const expression = front.replace(/<intelligent_definition\b[^>]*>.*?<\/intelligent_definition>/gs, '');
  const meaningMatch = front.match(/<intelligent_definition\b[^>]*>(.*?)<\/intelligent_definition>/s);
  const meaning = meaningMatch?.[1]?.trim() || normalized.fields.Back?.value;
  if (!meaning) {
    return null;
  }

  normalized.fields.Expression = { value: expression };
  normalized.fields.Reading = { value: '' };
  normalized.fields.Meaning = { value: meaning };
  return normalized;
}

function buildIndexes(cards: AnkiCard[], settings: Settings): void {
  allCards = cards;
  cardsPerId = new Map();
  wordsIds = new Map();
  whoContain = new Map();
  getCardCache = new Map();

  const noDuplicates = new Map<string, Set<string>>();
  const language = settings.language || DEFAULT_SETTINGS.language;

  for (const card of allCards) {
    const expression = card.fields.Expression?.value;
    if (!expression) {
      continue;
    }
    const words = extractWords(expression, language);
    wordsIds.set(words, card.cardId);
    cardsPerId.set(card.cardId, card);
  }

  for (const card of allCards) {
    const expression = card.fields.Expression?.value;
    if (!expression) {
      continue;
    }
    const characters = extractWords(expression, language);
    for (const character of Array.from(characters)) {
      const existing = noDuplicates.get(character);
      if (existing?.has(characters)) {
        continue;
      }
      if (existing) {
        existing.add(characters);
      } else {
        noDuplicates.set(character, new Set([characters]));
      }
      const containing = whoContain.get(character) || [];
      containing.push([characters, card.cardId]);
      whoContain.set(character, containing);
    }
  }
}

function cacheToSerializable(): AnkiCacheFile {
  return {
    all_cards: allCards,
    cards_per_id: Object.fromEntries(Array.from(cardsPerId.entries()).map(([id, card]) => [String(id), card])),
    words_ids: Object.fromEntries(wordsIds),
    who_contain: Object.fromEntries(whoContain),
  };
}

function loadJsonCache(settings: Settings): boolean {
  try {
    const filePath = cachePath();
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<AnkiCacheFile>;
    const cards = Array.isArray(parsed.all_cards) ? parsed.all_cards : [];
    buildIndexes(cards, settings);

    if (parsed.cards_per_id) {
      cardsPerId = new Map(Object.entries(parsed.cards_per_id).map(([id, card]) => [Number(id), card]));
    }
    if (parsed.words_ids) {
      wordsIds = new Map(Object.entries(parsed.words_ids));
    }
    if (parsed.who_contain) {
      whoContain = new Map(Object.entries(parsed.who_contain));
    }
    getCardCache = new Map();
    return true;
  } catch (error) {
    log.error('Failed to load Anki cache:', error);
    return false;
  }
}

function saveJsonCache(): void {
  try {
    const filePath = cachePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cacheToSerializable()), 'utf-8');
  } catch (error) {
    log.error('Failed to save Anki cache:', error);
  }
}

export async function refreshAnkiCards(settings = loadSettings()): Promise<AnkiRefreshResult> {
  if (!settings.use_anki) {
    allCards = [];
    cardsPerId = new Map();
    wordsIds = new Map();
    whoContain = new Map();
    getCardCache = new Map();
    return { ok: true, source: 'disabled', reason: 'disabled' };
  }

  const cardIds = await ankiInvoke<number[]>('findCards', { query: 'deck:*' }, settings);
  if (!cardIds) {
    return loadJsonCache(settings)
      ? { ok: true, source: 'cache', reason: 'connection_failed' }
      : { ok: false, source: 'anki', reason: 'connection_failed' };
  }

  const rawCards = await ankiInvoke<AnkiCard[]>('cardsInfo', { cards: cardIds }, settings);
  if (!rawCards) {
    return loadJsonCache(settings)
      ? { ok: true, source: 'cache', reason: 'connection_failed' }
      : { ok: false, source: 'anki', reason: 'connection_failed' };
  }

  const normalizedCards = rawCards
    .map((card) => normalizeCardFields(card, settings))
    .filter((card): card is AnkiCard => Boolean(card));

  if (normalizedCards.length === 0) {
    allCards = [];
    cardsPerId = new Map();
    wordsIds = new Map();
    whoContain = new Map();
    getCardCache = new Map();
    return { ok: false, source: 'anki', reason: 'no_valid_cards' };
  }

  buildIndexes(normalizedCards, settings);
  saveJsonCache();
  return { ok: true, source: 'anki' };
}

export function getAnkiCard(word: string): AnkiCardLookupResponse {
  const cached = getCardCache.get(word);
  if (cached) {
    return cached;
  }

  const exactCardId = wordsIds.get(word);
  if (exactCardId !== undefined) {
    const card = cardsPerId.get(exactCardId);
    if (card) {
      const response = { cards: [card], error: false, poor: false };
      getCardCache.set(word, response);
      return response;
    }
  }

  const seen = new Set<number>();
  const scored: Array<[number, number]> = [];

  for (const character of Array.from(word)) {
    const containing = whoContain.get(character);
    if (!containing) {
      continue;
    }
    for (const [cardExpression, cardId] of containing) {
      if (seen.has(cardId)) {
        continue;
      }
      seen.add(cardId);

      let score = 0;
      if (word === cardExpression) {
        score = word.length * 3.0;
      } else if (cardExpression.includes(word)) {
        score = word.length * 2.0 - (cardExpression.length - word.length) * 0.5;
      } else if (word.includes(cardExpression)) {
        score = cardExpression.length * 1.5 - (word.length - cardExpression.length) * 0.5;
      } else {
        const wordChars = new Set(Array.from(word));
        const cardChars = new Set(Array.from(cardExpression));
        const common = Array.from(wordChars).filter((char) => cardChars.has(char)).length;
        const union = new Set([...wordChars, ...cardChars]).size;
        const jaccard = union > 0 ? common / union : 0;
        if (jaccard < 0.6) {
          continue;
        }
        score = common - (union - common) * 1.0;
      }

      if (score > 0) {
        scored.push([score, cardId]);
      }
    }
  }

  scored.sort((a, b) => b[0] - a[0]);
  const minScore = word.length * 0.8;
  const top = scored.filter(([score]) => score >= minScore).slice(0, 5);
  const maxScore = top[0]?.[0] || 0;
  const cards = top
    .map(([, cardId]) => cardsPerId.get(cardId))
    .filter((card): card is AnkiCard => Boolean(card));

  if (cards.length === 0) {
    const response = { cards: ['No cards found'], error: true, poor: false };
    getCardCache.set(word, response);
    return response;
  }

  const response = { cards, error: false, poor: maxScore < word.length * 2 };
  getCardCache.set(word, response);
  return response;
}

export function getAnkiWordsPayload(): AnkiWordsPayload {
  const words = new Set<string>();
  const cards: AnkiWordsPayload['cards'] = [];

  for (const card of allCards) {
    const expression = card.fields.Expression?.value;
    if (!expression) {
      continue;
    }
    const word = stripHtml(expression);
    if (!word) {
      continue;
    }
    words.add(word);
    cards.push({
      word,
      cardId: card.cardId,
      factor: card.factor,
      due: card.due,
      queue: card.queue,
      type: card.type,
      interval: card.interval,
      mod: card.mod,
    });
  }

  return { words: Array.from(words), cards };
}
