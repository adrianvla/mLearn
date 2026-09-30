import { describe, it, expect, vi } from 'vitest';
import type { Flashcard } from '../../shared/types';
import { countByKind, countExamples, hasMeaning, planFlashcardRepair, type TtsScanDeps } from './flashcardRepairPlan';

const card = (content: Partial<Flashcard['content']>, id = 'c1', language = 'ja'): Flashcard => ({
  id, language,
  content: { type: 'word', front: '暗い', back: 'dark', ...content },
  state: 'new', ease: 1.3, interval: 0, dueDate: 0, reviews: 0, lapses: 0, learningStep: 0,
  createdAt: 0, lastReviewed: 0, lastUpdated: 0,
});

const deps = (over: Partial<TtsScanDeps> = {}): TtsScanDeps => ({
  getExistingTts: vi.fn(async () => false),
  getTtsGeneratedAt: vi.fn(async () => null),
  getSpeakableText: (c, f) => (f === 'word' ? c.content.front : c.content.example ?? ''),
  ...over,
});

const opts = (o = {}) => ({ activeLanguage: 'ja', autoGenerateAudio: true, ...o });

describe('hasMeaning', () => {
  it('accepts a real meaning', () => expect(hasMeaning(card({ back: 'dark' }))).toBe(true));
  it('rejects an empty, placeholder, or missing back', () => {
    expect(hasMeaning(card({ back: '' }))).toBe(false);
    expect(hasMeaning(card({ back: '  ' }))).toBe(false);
    expect(hasMeaning(card({ back: '-' }))).toBe(false);
  });
});

describe('planFlashcardRepair', () => {
  it('flags a card with no meaning as a content finding', async () => {
    const plan = await planFlashcardRepair([card({ back: '', unpopulated: true })], opts(), deps());
    expect(plan.filter((f) => f.kind === 'content')).toHaveLength(1);
  });

  it('does not flag a card the learner deliberately cleared', async () => {
    const plan = await planFlashcardRepair(
      [card({ back: '', userEditedFields: ['back'] })], opts(), deps());
    expect(plan.filter((f) => f.kind === 'content')).toHaveLength(0);
  });

  it('respects include: content only', async () => {
    const plan = await planFlashcardRepair([card({ back: '' })], opts({ include: ['content'] }), deps());
    expect(plan.every((f) => f.kind === 'content')).toBe(true);
  });

  it('flags missing audio per field', async () => {
    const plan = await planFlashcardRepair(
      [card({ example: 'sentence' })], opts({ include: ['tts'] }), deps());
    expect(plan.filter((f) => f.kind === 'tts').map((f) => f.field).sort()).toEqual(['example', 'word']);
  });

  it('skips example audio for a video card', async () => {
    const plan = await planFlashcardRepair(
      [card({ example: 'sentence', videoUrl: 'flashcard-video://x' })], opts({ include: ['tts'] }), deps());
    expect(plan.filter((f) => f.kind === 'tts' && f.field === 'example')).toHaveLength(0);
  });

  it('skips cards whose audio already exists in onlyEmpty mode', async () => {
    const plan = await planFlashcardRepair([card({})], opts({ include: ['tts'], ttsMode: 'onlyEmpty' }),
      deps({ getExistingTts: vi.fn(async () => true) }));
    expect(plan).toHaveLength(0);
  });

  it('re-rolls every field in replaceAll mode', async () => {
    const plan = await planFlashcardRepair([card({})], opts({ include: ['tts'], ttsMode: 'replaceAll' }),
      deps({ getExistingTts: vi.fn(async () => true) }));
    expect(plan.filter((f) => f.kind === 'tts')).toHaveLength(1);
  });

  it('skips audio newer than the cutoff in olderThan mode', async () => {
    const future = Date.now() + 60_000;
    const plan = await planFlashcardRepair([card({})],
      opts({ include: ['tts'], ttsMode: 'olderThan', olderThanCutoff: Date.now() }),
      deps({ getExistingTts: vi.fn(async () => true), getTtsGeneratedAt: vi.fn(async () => future) }));
    expect(plan).toHaveLength(0);
  });

  it('flags an example with no translation when the LLM is ready', async () => {
    const plan = await planFlashcardRepair(
      [card({ example: 'sentence' })], opts({ include: ['exampleMeaning'], llmReady: true }), deps());
    expect(plan.filter((f) => f.kind === 'exampleMeaning')).toHaveLength(1);
  });

  it('does not flag example meanings when the LLM is not ready', async () => {
    const plan = await planFlashcardRepair(
      [card({ example: 'sentence' })], opts({ include: ['exampleMeaning'], llmReady: false }), deps());
    expect(plan).toHaveLength(0);
  });

  it('scopes to the active language when asked', async () => {
    const plan = await planFlashcardRepair(
      [card({ back: '' }, 'de1', 'de')], opts({ scope: 'language' }), deps());
    expect(plan.filter((f) => f.kind === 'content')).toHaveLength(0);
  });

  it('scans every language by default', async () => {
    const plan = await planFlashcardRepair([card({ back: '' }, 'de1', 'de')], opts(), deps());
    expect(plan.filter((f) => f.kind === 'content')).toHaveLength(1);
  });

  it('counts findings by kind', async () => {
    const plan = await planFlashcardRepair(
      [card({ back: '', example: 'sentence' })], opts({ llmReady: true }), deps());
    const counts = countByKind(plan);
    expect(counts.content).toBe(1);
    expect(counts.exampleMeaning).toBe(1);
  });
});

describe('example findings', () => {
  const exampleOpts = (o = {}) => opts({ include: ['example'], ...o });

  it('flags a card with no example sentence', async () => {
    const plan = await planFlashcardRepair([card({ back: 'dark' })], exampleOpts(), deps());
    expect(plan.filter((f) => f.kind === 'example')).toHaveLength(1);
  });

  it('does not flag a card that already has an example in onlyEmpty mode', async () => {
    const plan = await planFlashcardRepair([card({ example: 'already' })], exampleOpts(), deps());
    expect(plan.filter((f) => f.kind === 'example')).toHaveLength(0);
  });

  it('re-rolls existing examples in replaceAll mode', async () => {
    const plan = await planFlashcardRepair(
      [card({ example: 'already' })], exampleOpts({ exampleMode: 'replaceAll' }), deps());
    expect(plan.filter((f) => f.kind === 'example')).toHaveLength(1);
  });

  it('skips a card with no meaning, which is the content repair’s job', async () => {
    const plan = await planFlashcardRepair(
      [card({ back: '' })], exampleOpts({ exampleMode: 'replaceAll' }), deps());
    expect(plan.filter((f) => f.kind === 'example')).toHaveLength(0);
  });

  it('counts example findings separately from the repair kinds', async () => {
    const plan = await planFlashcardRepair(
      [card({ back: 'dark' }), card({ back: 'dark', example: 'done' }, 'c2')], exampleOpts(), deps());
    expect(countExamples(plan)).toBe(1);
    expect(countByKind(plan).content).toBe(0);
  });
});
