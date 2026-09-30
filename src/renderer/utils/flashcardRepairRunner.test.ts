import { describe, it, expect, vi } from 'vitest';
import type { Flashcard } from '../../shared/types';
import { orderFindings, runFlashcardRepair, runMissingFlashcardRepair, type RepairRunnerDeps } from './flashcardRepairRunner';
import { DEFAULT_REPAIR_SELECTION, planFlashcardRepair, type RepairFinding, type RepairSelection, type TtsScanDeps } from './flashcardRepairPlan';

const card = (id: string, back = 'dark'): Flashcard => ({
  id, language: 'ja',
  content: { type: 'word', front: '暗い', back },
  state: 'new', ease: 1.3, interval: 0, dueDate: 0, reviews: 0, lapses: 0, learningStep: 0,
  createdAt: 0, lastReviewed: 0, lastUpdated: 0,
});

const deps = (over: Partial<RepairRunnerDeps> = {}): RepairRunnerDeps => ({
  activeLanguage: 'ja',
  getLanguageData: () => null,
  settings: { language: 'ja', uiLanguage: 'en', dictionaryTargetLanguages: {} },
  // Stubbed by default: the real producer queries the dictionary.
  buildContent: vi.fn(async (finding) => ({
    cardId: finding.card.id, language: finding.language,
    content: { back: 'dark', unpopulated: false },
  })),
  applyContent: vi.fn(),
  generateTts: vi.fn(async () => true),
  ...over,
});

const contentFinding = (id: string): RepairFinding =>
  ({ kind: 'content', card: card(id, ''), language: 'ja' });
const ttsFinding = (id: string): RepairFinding =>
  ({ kind: 'tts', card: card(id), language: 'ja', field: 'word', text: 'ural' });
const exampleFinding = (id: string): RepairFinding =>
  ({ kind: 'exampleMeaning', card: card(id), language: 'ja', exampleText: 'sentence' });
const rerollFinding = (id: string): RepairFinding =>
  ({ kind: 'example', card: card(id), language: 'ja' });

describe('orderFindings', () => {
  it('puts content first, then examples, then audio', () => {
    const ordered = orderFindings([
      ttsFinding('a'), exampleFinding('b'), rerollFinding('d'), contentFinding('c'),
    ]);
    expect(ordered.map((f) => f.kind)).toEqual(['content', 'example', 'exampleMeaning', 'tts']);
  });
});

describe('runFlashcardRepair', () => {
  it('fills content before generating audio for the same card', async () => {
    const order: string[] = [];
    await runFlashcardRepair(
      [ttsFinding('a'), contentFinding('a')],
      deps({
        applyContent: (cardId) => { order.push(`content:${cardId}`); },
        generateTts: async () => { order.push('tts'); return true; },
      }),
    );
    expect(order).toEqual(['content:a', 'tts']);
  });

  it('counts successes and failures', async () => {
    const result = await runFlashcardRepair(
      [ttsFinding('a'), ttsFinding('b')],
      deps({ generateTts: vi.fn(async ({ cardId }) => cardId === 'a') }),
    );
    expect(result).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
  });

  it('reports a dictionary miss as failed and leaves the card unpopulated', async () => {
    const result = await runFlashcardRepair([contentFinding('a')],
      deps({ buildContent: vi.fn(async () => null) }));
    expect(result.failed).toBe(1);
    expect(result.remaining).toHaveLength(1);
  });

  it('clears the unpopulated flag when it fills a card', async () => {
    const applyContent = vi.fn();
    await runFlashcardRepair([contentFinding('a')], deps({ applyContent }));
    expect(applyContent).toHaveBeenCalledWith('a', expect.objectContaining({ unpopulated: false }));
  });

  it('retries a failing finding up to maxRetries', async () => {
    const generateTts = vi.fn(async () => false);
    await runFlashcardRepair([ttsFinding('a')], deps({ generateTts, maxRetries: 3 }));
    expect(generateTts).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when a failure is a dead end', async () => {
    const generateTts = vi.fn(async () => { throw new Error('cloud unreachable'); });
    await expect(runFlashcardRepair(
      [ttsFinding('a')],
      deps({ generateTts, abortOnError: () => true }),
    )).rejects.toThrow('cloud unreachable');
    expect(generateTts).toHaveBeenCalledTimes(1);
  });

  it('reports progress once per finding', async () => {
    const seen: Array<[number, number]> = [];
    await runFlashcardRepair(
      [contentFinding('a'), ttsFinding('b')],
      deps({ onProgress: (done, total) => seen.push([done, total]) }),
    );
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });

  it('does nothing for an empty plan', async () => {
    expect(await runFlashcardRepair([], deps())).toEqual({ attempted: 0, succeeded: 0, failed: 0, remaining: [] });
  });
});

describe('runFlashcardRepair example generation', () => {
  it('batches every example finding into one generator call', async () => {
    const generateExamples = vi.fn(async (findings: readonly { card: { id: string } }[]) => findings.map((f) => ({
      cardId: f.card.id, content: { example: `sentence for ${f.card.id}` },
    })));
    const applyContent = vi.fn();
    await runFlashcardRepair([rerollFinding('a'), rerollFinding('b')], deps({ generateExamples, applyContent }));
    expect(generateExamples).toHaveBeenCalledOnce();
    expect(applyContent).toHaveBeenCalledWith('a', { example: 'sentence for a' });
    expect(applyContent).toHaveBeenCalledWith('b', { example: 'sentence for b' });
  });

  it('reports a card the generator returned nothing for as failed', async () => {
    const result = await runFlashcardRepair([rerollFinding('a')],
      deps({ generateExamples: async () => [null] }));
    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
  });

  it('fills content before applying an example to the same card', async () => {
    const order: string[] = [];
    await runFlashcardRepair(
      [rerollFinding('a'), contentFinding('a')],
      deps({
        applyContent: (cardId, content) => {
          order.push(content.example ? 'example' : 'content');
        },
        generateExamples: async (findings) => {
          order.push('generate');
          return findings.map((f) => ({ cardId: f.card.id, content: { example: 'x' } }));
        },
      }),
    );
    expect(order).toEqual(['content', 'generate', 'example']);
  });
});

// Exercise the production scanner and runner against a store that changes as
// patches land, including assets that were not eligible in the initial scan.
const missingRepair = async (
  cards: Flashcard[],
  overrides: Partial<RepairRunnerDeps> = {},
  selection: RepairSelection = DEFAULT_REPAIR_SELECTION,
  llmReady = true,
) => {
  const audio = new Set<string>();
  const events: string[] = [];
  const tts: TtsScanDeps = {
    getExistingTts: async (id, field) => audio.has(`${id}:${field}`),
    getSpeakableText: (c, field) => field === 'word' ? c.content.front : c.content.example ?? '',
  };
  const scanOptions = { activeLanguage: 'ja', autoGenerateAudio: true, llmReady };
  const runner = deps({
    applyContent: (id, patch) => {
      events.push(Object.hasOwn(patch, 'back') ? 'content' : Object.hasOwn(patch, 'example') ? 'example' : 'translation');
      Object.assign(cards.find((c) => c.id === id)!.content, patch);
    },
    generateExamples: vi.fn(async (findings) => {
      events.push('generate');
      expect(findings.every((finding) => finding.card.content.back === 'dark')).toBe(true);
      return findings.map((finding) => ({ cardId: finding.card.id, content: { example: 'new sentence' } }));
    }),
    translateExample: vi.fn(async (text) => {
      expect(text).toBe('new sentence');
      return 'new translation';
    }),
    generateTts: vi.fn(async ({ cardId, text, field }) => {
      events.push(`tts:${field}`);
      if (field === 'example') expect(text).toBe('new sentence');
      audio.add(`${cardId}:${field}`);
      return true;
    }),
    ...overrides,
  });
  const initial = await planFlashcardRepair(cards, scanOptions, tts);
  const result = await runMissingFlashcardRepair(initial, {
    ...runner, getCards: () => cards, scanOptions, tts, selection,
  });
  return { result, runner, events, remaining: await planFlashcardRepair(cards, scanOptions, tts) };
};

describe('repair dependency discovery', () => {
  it('repairs a shell card through examples, translation and audio in one run', async () => {
    const cards = [card('a', '')];
    const { result, events, remaining } = await missingRepair(cards);
    expect(events).toEqual(['content', 'generate', 'example', 'translation', 'tts:word', 'tts:example']);
    expect(cards[0].content).toMatchObject({ back: 'dark', example: 'new sentence', exampleMeaning: 'new translation' });
    expect(result).toMatchObject({ attempted: 5, succeeded: 5, failed: 0 });
    expect(remaining).toEqual([]);
  });

  it('does not translate again when the generator supplies a translation', async () => {
    const { result, runner } = await missingRepair([card('a')], {
      generateExamples: async () => [{ cardId: 'a', content: { example: 'new sentence', exampleMeaning: 'supplied translation' } }],
    });
    expect(runner.translateExample).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 3, succeeded: 3, failed: 0 });
  });

  it('honors dictionary-only selection even when dictionary repair unlocks more work', async () => {
    const { result, runner, remaining } = await missingRepair([card('a', '')], {}, {
      content: true, example: false, exampleMeaning: false, wordAudio: false, exampleAudio: false,
    });
    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    expect(runner.generateExamples).not.toHaveBeenCalled();
    expect(runner.generateTts).not.toHaveBeenCalled();
    expect(remaining.some((finding) => finding.kind === 'example')).toBe(true);
  });

  it('honors unchecked dependent translation and audio options', async () => {
    const cards = [card('a', '')];
    const { result, runner } = await missingRepair(cards, {}, {
      ...DEFAULT_REPAIR_SELECTION, exampleMeaning: false, wordAudio: false, exampleAudio: false,
    });
    expect(cards[0].content.example).toBe('new sentence');
    expect(runner.translateExample).not.toHaveBeenCalled();
    expect(runner.generateTts).not.toHaveBeenCalled();
    expect(result.attempted).toBe(2);
  });

  it('does not generate examples against dictionary misses', async () => {
    const { result, runner } = await missingRepair([card('a', '')], { buildContent: async () => null });
    expect(runner.generateExamples).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    expect(result.remaining[0].kind).toBe('content');
  });

  it('preserves populated sentences', async () => {
    const cards = [card('a')];
    cards[0].content.example = 'new sentence';
    const { runner, remaining } = await missingRepair(cards);
    expect(runner.generateExamples).not.toHaveBeenCalled();
    expect(cards[0].content.example).toBe('new sentence');
    expect(remaining).toEqual([]);
  });

  it('reports example generation failure and still repairs word audio', async () => {
    const { result, runner } = await missingRepair([card('a')], {
      generateExamples: async () => { throw new Error('generation failed'); },
    });
    expect(result).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    expect(result.remaining[0].kind).toBe('example');
    expect(runner.generateTts).toHaveBeenCalledOnce();
  });

  it('propagates fatal errors from batch generation', async () => {
    await expect(missingRepair([card('a')], {
      generateExamples: async () => { throw new Error('cancelled'); },
      abortOnError: () => true,
    })).rejects.toThrow('cancelled');
  });

  it('repairs dictionary content without a ready LLM', async () => {
    const { result, runner } = await missingRepair([card('a', '')], {}, DEFAULT_REPAIR_SELECTION, false);
    expect(runner.generateExamples).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 2, succeeded: 2, failed: 0 });
  });
});
