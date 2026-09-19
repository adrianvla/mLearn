import { describe, expect, it } from 'vitest';
import {
  MOMENTUM_WINDOW_MS,
  calibrationUnmeasuredCandidates,
  curriculumCandidates,
  curriculumGrammarCandidates,
  grammarEncounterCandidates,
  mediaOpportunitiesFromStats,
  mediaOpportunityCandidates,
  mediaRelevanceCandidates,
  momentumScore,
  probeCandidates,
  retentionDueCandidates,
  suggestedLearningCandidates,
  weakTargetCandidates,
  MEDIA_OPPORTUNITY_SOURCE_CAP,
} from './candidateSources';
import type { FlashcardLike } from './candidateSources';
import type { MediaStats } from '../../shared/types';
import type { LearnableTarget } from '../../shared/graph/types';
import { createSeededRng, selectNext, type TeachingPolicyConfig } from './teachingPolicy';
import type { EncounterTask } from './types';

const target: LearnableTarget = {
  entityId: 'de:surface:hallo',
  capability: 'surface-recognition',
};

describe('retentionDueCandidates', () => {
  it('maps due cards and scores normalized lateness', () => {
    const nowMs = 10_000;
    const candidates = retentionDueCandidates([
      { id: 'due', word: 'hallo', language: 'de', targets: [target], dueDate: 9_500, interval: 1_000 },
      { id: 'future', word: 'morgen', language: 'de', targets: [target], dueDate: 10_001, interval: 1_000 },
      { id: 'buried', word: 'weg', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000, buried: true },
    ], nowMs);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ key: 'due', word: 'hallo', language: 'de', origin: 'retention' });
    expect(candidates[0].scores['retention-need']).toBe(0.5);
  });

  it('never admits a future relearning step while due-now cards exist (R08 same-day order)', () => {
    const justFailed: FlashcardLike = {
      id: 'just-failed', language: 'de', targets: [target],
      dueDate: 10_500, interval: 600_000, state: 'relearning',
      lastReviewed: 9_900, ease: 2.3, reviews: 4, scheduledForToday: true,
    };
    const candidates = retentionDueCandidates([
      { id: 'overdue', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 },
      justFailed,
    ], 10_000);

    expect(candidates.map((candidate) => candidate.key)).toEqual(['overdue']);
  });

  it('fills the pool with later-today scheduled cards only when nothing is due now', () => {
    const candidates = retentionDueCandidates([
      {
        id: 'later-step', language: 'de', targets: [target],
        dueDate: 10_500, interval: 600_000, state: 'relearning',
        // Reviewed seconds ago with graduated-era ease: the old producer
        // would have padded near-max momentum onto this waiting step.
        lastReviewed: 9_999, ease: 2.5, reviews: 4, scheduledForToday: true,
      },
      { id: 'unscheduled-future', language: 'de', targets: [target], dueDate: 60_000, interval: 1_000 },
    ], 10_000);

    // Queue membership keeps the step in scope for today; the unscheduled
    // future card stays out.
    expect(candidates.map((candidate) => candidate.key)).toEqual(['later-step']);
    // Waiting fill is not consolidation: no momentum while the step waits.
    expect(candidates[0].scores.momentum).toBe(0);
    expect(candidates[0].scores['retention-need']).toBe(0);
  });
});

describe('calibrationUnmeasuredCandidates', () => {
  it('preserves pool candidate shape and assigns calibration origin', () => {
    const [candidate] = calibrationUnmeasuredCandidates([{
      key: 'de:hallo',
      word: 'hallo',
      language: 'de',
      targets: [target],
      scores: { uncertainty: 0.8 },
      meta: { level: 1 },
    }]);

    expect(candidate).toEqual({
      key: 'de:hallo',
      word: 'hallo',
      language: 'de',
      targets: [target],
      origin: 'calibration',
      scores: { uncertainty: 0.8 },
      meta: { level: 1 },
    });
  });
});

describe('weakTargetCandidates', () => {
  it('keeps learning-band entries and scores proximity to known', () => {
    const candidates = weakTargetCandidates([
      { word: 'hallo', language: 'de', status: 'learning', ease: 1.55 },
      { word: 'neu', language: 'de', status: 'unknown', ease: 1.3 },
      { word: 'klar', language: 'de', status: 'known', ease: 1.8 },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      key: 'de:hallo',
      word: 'hallo',
      language: 'de',
      origin: 'weak-target',
      scores: { 'curriculum-relevance': 0.5 },
      targets: [{ entityId: 'de:surface:hallo', capability: 'surface-recognition' }],
    });
  });
});

describe('probeCandidates', () => {
  it('filters by uncertainty and cooldown and maps information scores', () => {
    const candidates = probeCandidates([
      { target, pSuccess: 0.5, uncertainty: 0.8 },
      { target: { ...target, entityId: 'de:surface:niedrig' }, pSuccess: 0.5, uncertainty: 0.2 },
      { target: { ...target, entityId: 'de:surface:kalt' }, pSuccess: 0.6, uncertainty: 0.9 },
    ], {
      nowMs: 10_000,
      cooldownMs: 1_000,
      uncertaintyFloor: 0.5,
      cooldowns: new Map([['de:surface:kalt:surface-recognition', 9_500]]),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      key: 'de:surface:hallo:surface-recognition',
      language: 'de',
      targets: [target],
      origin: 'probe',
      scores: { 'information-gain': 1, uncertainty: 0.8 },
      meta: { pSuccess: 0.5 },
    });
  });
});

describe('curriculum, media, and suggested sources', () => {
  it('preserves source ordering and maps each learnable word to a policy candidate', () => {
    const items = [
      { key: 'first', word: 'hallo', language: 'de' },
      { key: 'second', word: 'morgen', language: 'de' },
    ];

    for (const candidates of [
      curriculumCandidates(items),
      mediaOpportunityCandidates(items),
      suggestedLearningCandidates(items),
    ]) {
      expect(candidates.map((candidate) => candidate.key)).toEqual(['first', 'second']);
      expect(candidates.every((candidate) => candidate.targets[0]?.capability === 'surface-recognition')).toBe(true);
    }

    expect(curriculumCandidates(items)[0].origin).toBe('curriculum');
    expect(mediaOpportunityCandidates(items)[0].origin).toBe('media');
    expect(suggestedLearningCandidates(items)[0].origin).toBe('curriculum');
  });
});

describe('grammarEncounterCandidates', () => {
  it('emits grammar candidates for unmeasured patterns above the exposure floor', () => {
    const candidates = grammarEncounterCandidates([
      { pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false },
      { pattern: 'negation', language: 'de', timesEncountered: 4, measured: false },
      { pattern: 'subjunctive', language: 'de', timesEncountered: 9, measured: true },
      { pattern: 'rare', language: 'de', timesEncountered: 2, measured: false },
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      key: 'de:grammar:past tense',
      language: 'de',
      origin: 'grammar',
      targets: [{ entityId: 'de:grammar:past tense', capability: 'grammar-recognition' }],
      meta: { pattern: 'past tense', timesEncountered: 12 },
    });
    expect(candidates[0].scores['curriculum-relevance']).toBe(1);
    expect(candidates[1].scores['curriculum-relevance']).toBeCloseTo(4 / 6);
  });

  it('honors custom floors and stays a pure selector over its inputs', () => {
    const entries = Object.freeze([
      Object.freeze({ pattern: 'conditional', language: 'fr', timesEncountered: 7, measured: false }),
    ]);

    const candidates = grammarEncounterCandidates(entries, { minEncounters: 5, saturationCount: 7 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].scores['curriculum-relevance']).toBe(1);
    expect(entries).toEqual([{ pattern: 'conditional', language: 'fr', timesEncountered: 7, measured: false }]);
  });
});

describe('mediaRelevanceCandidates (R21)', () => {
  const item = (overrides: Partial<Parameters<typeof mediaRelevanceCandidates>[0][number]> = {}) => ({
    key: 'ja:surface:粉飾',
    word: '粉飾',
    language: 'ja',
    timesSeen: 3,
    timesHovered: 1,
    status: 'unmeasured' as const,
    ...overrides,
  });

  it('scores saturating coverage recurrence of unmeasured content terms', () => {
    const [candidate] = mediaRelevanceCandidates([item()]);
    expect(candidate).toMatchObject({
      key: 'ja:surface:粉飾',
      word: '粉飾',
      language: 'ja',
      origin: 'media',
      targets: [{ entityId: 'ja:surface:粉飾', capability: 'surface-recognition' }],
      meta: { timesSeen: 3, timesHovered: 1, status: 'unmeasured' },
    });
    expect(candidate.scores['media-relevance']).toBeCloseTo(3 / 6);
    expect(candidate.scores.novelty).toBe(1);
  });

  it('caps coverage recurrence at full relevance and keeps single sightings uncandidate', () => {
    const saturated = mediaRelevanceCandidates([item({ timesSeen: 40, timesHovered: 12 })]);
    expect(saturated[0].scores['media-relevance']).toBe(1);
    expect(mediaRelevanceCandidates([item({ timesSeen: 1, timesHovered: 0 })])).toEqual([]);
  });

  it('keeps assisted access distinct from coverage and from knowledge', () => {
    // Fifty lookups with no passive coverage: lookups alone never create a
    // candidate — supported access is not token coverage.
    expect(mediaRelevanceCandidates([item({ timesSeen: 0, timesHovered: 50 })])).toEqual([]);
    // Real coverage plus heavy lookups: the candidate stays unmeasured (novelty 1)
    // — assistance neither proves knowledge nor inflates the coverage score.
    const [candidate] = mediaRelevanceCandidates([item({ timesSeen: 3, timesHovered: 50 })]);
    expect(candidate.scores['media-relevance']).toBeCloseTo(3 / 6);
    expect(candidate.scores.novelty).toBe(1);
    expect(candidate.meta).toMatchObject({ timesSeen: 3, timesHovered: 50, status: 'unmeasured' });
  });

  it('downrates partially measured words and drops known ones entirely', () => {
    const learning = mediaRelevanceCandidates([item({ status: 'learning' })]);
    expect(learning[0].scores.novelty).toBe(0.5);
    expect(learning[0].scores['media-relevance']).toBeCloseTo(3 / 6);

    expect(mediaRelevanceCandidates([item({ status: 'known', timesSeen: 30 })])).toEqual([]);
  });

  it('honors custom bounds and stays pure over its inputs', () => {
    const entries = Object.freeze([Object.freeze(item({ timesSeen: 10, timesHovered: 0 }))]);
    const candidates = mediaRelevanceCandidates(entries, { minEncounters: 5, saturationEncounters: 10 });
    expect(candidates[0].scores['media-relevance']).toBe(1);
    expect(entries).toEqual([{ ...item({ timesSeen: 10, timesHovered: 0 }) }]);
  });
});

describe('curriculumCandidates status handling (R21)', () => {
  it('excludes known items and keeps the legacy contract when status is absent', () => {
    const items = [
      { key: 'known', word: 'Haus', language: 'de', status: 'known' as const },
      { key: 'learning', word: 'blau', language: 'de', status: 'learning' as const },
      { key: 'legacy', word: 'neu', language: 'de' },
    ];
    const candidates = curriculumCandidates(items);
    expect(candidates.map((candidate) => candidate.key)).toEqual(['learning', 'legacy']);
    expect(candidates.every((candidate) => candidate.scores['curriculum-relevance'] === 1)).toBe(true);
  });
});

describe('momentum producer (R08)', () => {
  const base = { id: 'c1', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 };

  it('derives momentum only from supplied scheduler-replayed state', () => {
    // No replay state: no momentum score at all (legacy behavior).
    expect(retentionDueCandidates([{ ...base }], 10_000)[0].scores.momentum).toBeUndefined();
    // Graduated review inside the window: decaying momentum.
    expect(momentumScore({ ...base, lastReviewed: 10_000 - 10, ease: 2.5, reviews: 3 }, 10_000)).toBeCloseTo(1);
    expect(momentumScore({ ...base, lastReviewed: 10_000 - MOMENTUM_WINDOW_MS / 2, ease: 2.5, reviews: 3 }, 10_000)).toBeCloseTo(0.5);
  });

  it('gives zero momentum to unconsolidated cards and none to learning-step cards', () => {
    // Below graduation ease: not recently consolidated, however recent.
    expect(momentumScore({ ...base, lastReviewed: 9_999, ease: 1.5, reviews: 3 }, 10_000)).toBe(0);
    // Never graduated: no signal, no invention.
    expect(momentumScore({ ...base, lastReviewed: 9_999, ease: 2.5, reviews: 0 }, 10_000)).toBeUndefined();
  });

  it('gives zero momentum to a just-failed relearning step regardless of ease or recency', () => {
    // After an Again rating: state=relearning, ease dipped 2.5→2.3,
    // reviewed seconds ago. A lapse is the opposite of consolidation —
    // near-max momentum here would mislabel the failure as a success (R08).
    expect(momentumScore({ ...base, state: 'relearning', lastReviewed: 9_999, ease: 2.3, reviews: 4 }, 10_000)).toBe(0);
    // In-progress learning step: owes the scheduler's step delay, not padding.
    expect(momentumScore({ ...base, state: 'learning', lastReviewed: 9_999, ease: 2.5, reviews: 2 }, 10_000)).toBe(0);
  });

  it('lets recent consolidation change selection under the gentle/intensive intensities', () => {
    const familiar = { ...base, id: 'familiar', lastReviewed: 9_999, ease: 2.5, reviews: 5, dueDate: 9_900, pressure: 0.4 };
    const fresh = { ...base, id: 'fresh', dueDate: 9_900, pressure: 0.4 }; // equal retention-need, no momentum
    const pool = [familiar, fresh];
    const gentle = retentionDueCandidates(pool, 10_000);
    expect(gentle[0].scores.momentum).toBeGreaterThan(0);
    // The score exists on the candidate; with equal retention-need, the
    // gentle session's momentum padding picks the familiar card, intensive
    // (addend 0) leaves the weighted pick between equals.
    expect(new Set(gentle.map((candidate) => candidate.scores['retention-need']))).toEqual(new Set([0.4]));
  });
});

describe('mediaOpportunitiesFromStats (R21 producer)', () => {
  const stats: MediaStats = {
    mediaHash: 'h1',
    mediaName: 'Tagesschau',
    mediaType: 'video',
    language: 'de',
    wordsEncountered: {
      birne: { word: 'birne', ease: 2, timesSeen: 4, timesHovered: 1 },
      haus: { word: 'haus', ease: 2.5, timesSeen: 2, timesHovered: 0 },
    },
    grammarEncountered: {},
    assessedLevel: null,
    sessions: [],
    totalTimeSpent: 0,
    lastAccessed: 0,
  };

  it('aggregates coverage across items and keeps statuses caller-owned', () => {
    const statuses = new Map([['birne', 'unmeasured' as const], ['haus', 'known' as const]]);
    const opportunities = mediaOpportunitiesFromStats([stats], {
      language: 'de',
      statusOf: (word) => statuses.get(word) ?? 'unmeasured',
    });
    expect(opportunities).toHaveLength(2);
    const birne = opportunities.find((opportunity) => opportunity.word === 'birne')!;
    expect(birne).toMatchObject({ key: 'de:surface:birne', timesSeen: 4, timesHovered: 1, status: 'unmeasured' });
    // 'known' status flows through: the SOURCE drops it, not this producer.
    expect(mediaRelevanceCandidates(opportunities).map((candidate) => candidate.word)).toEqual(['birne']);
  });

  it('filters by language and sums the same word across media', () => {
    const other: MediaStats = { ...stats, mediaHash: 'h2', language: 'fr', wordsEncountered: { chien: { word: 'chien', ease: 2, timesSeen: 9, timesHovered: 0 } } };
    const duplicate: MediaStats = { ...stats, mediaHash: 'h3', wordsEncountered: { birne: { word: 'birne', ease: 2, timesSeen: 2, timesHovered: 1 } } };
    const opportunities = mediaOpportunitiesFromStats([stats, other, duplicate], { language: 'de', statusOf: () => 'unmeasured' });
    const birne = opportunities.find((opportunity) => opportunity.word === 'birne')!;
    expect(opportunities.every((opportunity) => opportunity.language === 'de')).toBe(true);
    expect(birne.timesSeen).toBe(6);
    expect(birne.timesHovered).toBe(2);
  });

  it('aggregates contributing media identities bounded by cap (R20 provenance)', () => {
    const sources: MediaStats[] = [stats];
    for (let index = 0; index < MEDIA_OPPORTUNITY_SOURCE_CAP; index += 1) {
      sources.push({ ...stats, mediaHash: `extra-${index}`, mediaName: `Show ${index}` });
    }
    // One more beyond the cap: counted, not recorded.
    sources.push({ ...stats, mediaHash: 'overflow', mediaName: 'Overflow' });

    const opportunities = mediaOpportunitiesFromStats(sources, { language: 'de', statusOf: () => 'unmeasured' });
    const birne = opportunities.find((opportunity) => opportunity.word === 'birne')!;
    expect(birne.sources).toHaveLength(MEDIA_OPPORTUNITY_SOURCE_CAP);
    expect(birne.sources![0]).toEqual({ mediaHash: 'h1', mediaName: 'Tagesschau' });
    // Six contributing media, four recorded, two counted.
    expect(birne.sourcesOmitted).toBe(2);

    // The same media listed twice contributes its identity once.
    const deduped = mediaOpportunitiesFromStats([stats, { ...stats }], { language: 'de', statusOf: () => 'unmeasured' });
    expect(deduped.find((opportunity) => opportunity.word === 'birne')!.sources)
      .toEqual([{ mediaHash: 'h1', mediaName: 'Tagesschau' }]);

    // The identity rides the candidate meta, so a trace row names the media.
    const [candidate] = mediaRelevanceCandidates(opportunities);
    expect(candidate.meta.sources).toHaveLength(MEDIA_OPPORTUNITY_SOURCE_CAP);
    expect(candidate.meta).toMatchObject({
      sources: expect.arrayContaining([
        { mediaHash: 'h1', mediaName: 'Tagesschau' },
        { mediaHash: 'extra-0', mediaName: 'Show 0' },
      ]),
      sourcesOmitted: 2,
    });
  });
});

describe('curriculumGrammarCandidates category pressure (R07)', () => {
  const items = [
    { language: 'de', pattern: 'weil', level: 2, category: 'subordination' },
    { language: 'de', pattern: 'um…zu', level: 2, category: 'purpose' },
    { language: 'de', pattern: 'trotzdem', level: 2 },
  ];

  it('boosts pressured categories and stays byte-identical without pressure', () => {
    const legacy = curriculumGrammarCandidates(items);
    expect(legacy.map((candidate) => candidate.scores['curriculum-relevance'])).toEqual([1, 1, 1]);
    expect(legacy[0].meta).toEqual({ pattern: 'weil', level: 2 });

    const pressured = curriculumGrammarCandidates(items, { categoryPressure: { subordination: 0.5 } });
    expect(pressured[0].scores['curriculum-relevance']).toBe(1.5);
    expect(pressured[0].meta).toMatchObject({ pattern: 'weil', level: 2, category: 'subordination', categoryPressure: 0.5 });
    expect(pressured[1].scores['curriculum-relevance']).toBe(1);
    expect(pressured[2].scores['curriculum-relevance']).toBe(1);
    // A pathological pressure input is clamped to one full boost (the
    // producer itself never emits >1; this guards the option contract).
    const maxed = curriculumGrammarCandidates(items, { categoryPressure: { subordination: 3 } });
    expect(maxed[0].scores['curriculum-relevance']).toBe(2);
  });
});

describe('trace meta evidence (R20)', () => {
  const traceTask: EncounterTask = {
    taskTemplateId: 'recognition',
    inputModality: 'text',
    responseModality: 'choice',
    supplied: ['surface'],
    requested: ['meaning'],
    fluencyRequired: false,
    ratingMode: 'dominant',
  };

  const policyConfig = (weights: TeachingPolicyConfig['weights']): TeachingPolicyConfig => ({
    weights,
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 1,
    probeCooldownMs: 1_000,
    nowMs: 10_000,
    cooldowns: new Map(),
    recentPicks: [],
    minRepeatDistance: 0,
    task: traceTask,
  });

  const retentionCard = (overrides: Partial<FlashcardLike> = {}): FlashcardLike => ({
    id: 'card-1',
    word: 'hallo',
    language: 'de',
    targets: [target],
    dueDate: 9_500,
    interval: 1_000,
    state: 'review',
    lastReviewed: 5_000,
    ease: 2.5,
    reviews: 3,
    ...overrides,
  });

  it('retention candidates carry the scheduler-replayed source inputs in meta', () => {
    const [candidate] = retentionDueCandidates([retentionCard()], 10_000);
    expect(candidate.meta).toEqual({
      dueDate: 9_500,
      interval: 1_000,
      state: 'review',
      lastReviewed: 5_000,
      ease: 2.5,
      reviews: 3,
    });
  });

  it('retention candidates expose the scheduler pressure override in meta', () => {
    const [candidate] = retentionDueCandidates([retentionCard({ pressure: 0.25 })], 10_000);
    expect(candidate.scores['retention-need']).toBe(0.25);
    expect(candidate.meta).toMatchObject({ pressure: 0.25, dueDate: 9_500, interval: 1_000, state: 'review' });
  });

  it('queued-new candidates carry their exploration derivation in meta', () => {
    const [candidate] = retentionDueCandidates(
      [retentionCard({ state: 'new', lastReviewed: undefined, ease: undefined, reviews: undefined })],
      10_000,
    );
    expect(candidate.origin).toBe('new-card');
    expect(candidate.meta).toEqual({ state: 'new', dueDate: 9_500 });
  });

  it('word candidates carry the media recurrence count and canonical status in meta', () => {
    const [withRecurrence] = curriculumCandidates([
      { key: 'de:surface:Hund', word: 'Hund', language: 'de', timesSeen: 3, status: 'unmeasured' },
    ]);
    expect(withRecurrence.meta).toEqual({ timesSeen: 3, status: 'unmeasured' });

    const [withoutRecurrence] = suggestedLearningCandidates([
      { key: 'de:surface:Katze', word: 'Katze', language: 'de' },
    ]);
    expect(withoutRecurrence.meta).toEqual({});
  });

  it('word candidates carry capture provenance in meta (R20)', () => {
    const [candidate] = suggestedLearningCandidates([
      {
        key: 'de:surface:Katze', word: 'Katze', language: 'de', status: 'learning',
        timesSeen: 4, source: 'Tagesschau', sourceMediaHash: 'h1',
      },
    ]);
    expect(candidate.meta).toEqual({
      timesSeen: 4, status: 'learning', source: 'Tagesschau', sourceMediaHash: 'h1',
    });
  });

  it('weak target candidates carry the ease their relevance derives from', () => {
    const [candidate] = weakTargetCandidates([{ word: 'Hund', language: 'de', status: 'learning', ease: 2.1 }]);
    expect(candidate.meta).toEqual({ ease: 2.1 });
  });

  it('emitted retention traces expose the source inputs behind the scores', () => {
    const decision = selectNext(
      retentionDueCandidates([retentionCard(), retentionCard({ id: 'card-2', dueDate: 9_000 })], 10_000),
      policyConfig({ 'retention-need': 1 }),
      createSeededRng(7),
    );
    expect(decision).not.toBeNull();
    const row = decision!.trace!.ranking.find((entry) => entry.key === 'card-1');
    expect(row?.meta).toMatchObject({
      dueDate: 9_500,
      interval: 1_000,
      state: 'review',
      lastReviewed: 5_000,
      ease: 2.5,
      reviews: 3,
    });
  });

  it('emitted media traces expose the recurrence count behind media-relevance', () => {
    const decision = selectNext(
      mediaOpportunityCandidates([{ key: 'de:surface:Hund', word: 'Hund', language: 'de', timesSeen: 3, status: 'unmeasured' }]),
      policyConfig({ novelty: 1, 'media-relevance': 1 }),
      createSeededRng(7),
    );
    expect(decision).not.toBeNull();
    const row = decision!.trace!.ranking.find((entry) => entry.key === 'de:surface:Hund');
    expect(row?.meta).toMatchObject({ timesSeen: 3, status: 'unmeasured' });
  });
});
