import { describe, expect, it } from 'vitest';
import { grammarEntityId } from '../../shared/graph/load';
import {
  PRESETS,
  selectEncounterBatch,
  selectNextEncounter,
  selectRankedEncounters,
  type EncounterInputs,
} from './engine';

const target = { entityId: 'de:surface:hallo', capability: 'surface-recognition' as const };

describe('selectNextEncounter', () => {
  it('composes each preset with its source adapter', () => {
    const retention = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'due', word: 'hallo', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      rng: () => 0.5,
    });
    const calibration = selectNextEncounter({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [{ key: 'de:neu', word: 'neu', language: 'de', targets: [target], scores: { novelty: 1 } }],
      rng: () => 0.5,
    });

    expect(retention?.action).toBe('MAINTAIN');
    expect(calibration?.action).toBe('TEACH');
    expect(PRESETS.RETENTION.weights['retention-need']).toBeGreaterThan(0);
    expect(PRESETS.CALIBRATION.weights.novelty).toBeGreaterThan(0);
  });

  it('leaves callers able to retain their existing fallback on defer', () => {
    const fallback = { id: 'future' };
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: fallback.id, word: 'morgen', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      config: { attentionBudgetRemaining: 0 },
    });

    expect(decision?.action).toBe('DEFER');
    expect(decision?.action === 'DEFER' ? decision.candidate.key : fallback.id).toBe(fallback.id);
  });

  it('preserves Level Study, media, and suggested source order through policy selection', () => {
    const expected = ['first', 'second'];
    const common = [
      { key: 'first', word: 'hallo', language: 'de' },
      { key: 'second', word: 'morgen', language: 'de' },
    ];

    expect(selectEncounterBatch({ preset: 'CURRICULUM', nowMs: 0, levelStudyItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
    expect(selectEncounterBatch({ preset: 'MEDIA', nowMs: 0, mediaItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
    expect(selectEncounterBatch({ preset: 'SUGGESTED', nowMs: 0, suggestedItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
  });
});

describe('production reachability (R07/R08 review repair)', () => {
  // Mirrors the production RETENTION call sites (FlashcardReview /
  // WelcomeRoute): the whole due pool with scheduler-replayed momentum state.
  const duePool = [
    { id: 'familiar', word: 'alt', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000, lastReviewed: 9_999, ease: 2.5, reviews: 5 },
    { id: 'fresh', word: 'neu', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 },
  ];

  it('gentle and intensive change real due-pool selection through the momentum producer', () => {
    // The challenging card slightly outranks on retention-need; gentle
    // momentum padding (+0.35 on a full momentum score) flips the pick
    // toward the recently consolidated card, intensive (addend 0) does not.
    const pool = [
      { ...duePool[0]!, pressure: 0.9 },
      { ...duePool[1]!, pressure: 0.95 },
    ];
    const pick = (intensity: 'gentle' | 'intensive') => selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: pool,
      context: { intensity },
      rng: () => 0.5,
    })!.candidate.key;
    expect(pick('gentle')).toBe('familiar');
    expect(pick('intensive')).toBe('fresh');
  });

  it('scores a queued-new card as exploration, never as fabricated overdue repair', () => {
    // A never-reviewed card's dueDate is its creation time and its interval is
    // 0: the lateness formula would fabricate maximal retention-need. With
    // scheduler state it scores novelty and carries the 'new-card' origin.
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'brand-new', word: 'neu', language: 'de', targets: [target], dueDate: 0, interval: 0, state: 'new' }],
      context: { intensity: 'intensive' },
      rng: () => 0.5,
    })!;
    expect(decision.candidate.origin).toBe('new-card');
    expect(decision.action).toBe('TEACH');
    expect(decision.candidate.scores.novelty).toBe(1);
    expect(decision.candidate.scores['retention-need']).toBeUndefined();
  });

  it('a just-failed relearning step waits for its scheduler delay (R08)', () => {
    // The exact shape production builds after an Again rating: the card
    // stays in today's queue (scheduledForToday) but its relearning step is
    // not due yet. It must not jump the due-now order, and its graduated-era
    // ease/reviews must not ride as momentum while it waits.
    const reviewQueueEntries = [
      { id: 'overdue', word: 'dringend', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000, state: 'review' as const, scheduledForToday: true as const },
      {
        id: 'just-failed', word: 'gefallen', language: 'de', targets: [target],
        dueDate: 10_500, interval: 600_000, state: 'relearning' as const,
        lastReviewed: 9_900, ease: 2.3, reviews: 4, scheduledForToday: true as const,
      },
    ];
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries,
      context: { intensity: 'gentle' },
      rng: () => 0.5,
    })!;
    expect(decision.candidate.key).toBe('overdue');
    expect(decision.candidate.origin).toBe('retention');
    expect(decision.candidate.scores.momentum).toBeUndefined();
    // The waiting relearning step was suppressed at the SOURCE: the policy
    // pool contained only the due-now card (pre-fix it competed in the
    // weighted pick).
    expect(decision.trace.inputs.candidateCount).toBe(1);
  });

  it('a 3-week exam deadline flips queue allocation between repair and exploration (Bob R07)', () => {
    // The REAL mixed pool the production call sites build: one due repair
    // card vs one queued-new exploration card. Under a constant draw the
    // LARGER total wins (weightedKey is monotone in the score), so the
    // horizon genuinely flips the allocation:
    // 3 weeks → consolidation ×1.5 / novelty ×0.75 → repair wins;
    // 6 months (outside the 42-day window) → no rules → exploration wins.
    const nowMs = 1_000_000_000_000;
    const DAY = 24 * 60 * 60 * 1000;
    const pool = [
      { id: 'repair', word: 'dringend', language: 'de', targets: [target], dueDate: nowMs - 10_000, interval: 1_000, state: 'review' as const, pressure: 0.9 },
      { id: 'explore', word: 'ganzneu', language: 'de', targets: [target], dueDate: nowMs - 10_000, interval: 0, state: 'new' as const },
    ];
    const pick = (goal: { kind: 'exam'; deadlineMs: number } | undefined) => selectNextEncounter({
      preset: 'RETENTION',
      nowMs,
      reviewQueueEntries: pool,
      context: goal ? { intensity: 'intensive', goal } : { intensity: 'intensive' },
      rng: () => 0.5,
    })!;
    expect(pick({ kind: 'exam', deadlineMs: nowMs + 21 * DAY }).candidate.key).toBe('repair');
    expect(pick({ kind: 'exam', deadlineMs: nowMs + 180 * DAY }).candidate.key).toBe('explore');
    // And the action labels stay honest per origin.
    expect(pick({ kind: 'exam', deadlineMs: nowMs + 21 * DAY }).action).toBe('MAINTAIN');
    expect(pick({ kind: 'exam', deadlineMs: nowMs + 180 * DAY }).action).toBe('TEACH');
  });

  it('a 3-week exam deadline changes due-pool allocation versus no goal', () => {
    const nowMs = 1_000_000_000_000;
    const pool = [
      { id: 'urgent', word: 'dringend', language: 'de', targets: [target], dueDate: nowMs - 10_000, interval: 1_000, pressure: 0.9 },
      { id: 'other', word: 'andere', language: 'de', targets: [target], dueDate: nowMs - 10_000, interval: 1_000, pressure: 0.9 },
      // The seeded draw must be able to express either winner; pin allocation
      // by comparing DECISIONS, not one draw: the deadline multiplies the
      // retention-need weight, so the trace rules differ and near-zero-value
      // candidates drop out identically.
      { id: 'dormant', word: 'schlafend', language: 'de', targets: [target], dueDate: nowMs - 10_000, interval: 1_000, pressure: 0 },
    ];
    const withDeadline = selectNextEncounter({
      preset: 'RETENTION',
      nowMs,
      reviewQueueEntries: pool,
      context: { intensity: 'intensive', goal: { kind: 'exam', deadlineMs: nowMs + 21 * 24 * 60 * 60 * 1000, target: 'Goethe B1' } },
      rng: () => 0.5,
    });
    const withoutGoal = selectNextEncounter({
      preset: 'RETENTION',
      nowMs,
      reviewQueueEntries: pool,
      context: { intensity: 'intensive' },
      rng: () => 0.5,
    });
    // The deadline NEVER surfaces the zero-pressure sleeper (repair discipline).
    expect(withDeadline!.candidate.key).not.toBe('dormant');
    expect(withoutGoal!.candidate.key).not.toBe('dormant');
    // And the trace records the learner-owned target verbatim.
    expect(withDeadline!.trace!.inputs.goal).toEqual({
      kind: 'exam', deadlineMs: nowMs + 21 * 24 * 60 * 60 * 1000, target: 'Goethe B1',
    });
  });

  it('deadline proximity shifts the real queue allocation from exploration toward repair (Bob R07)', () => {
    // Mirrors the production queue pool: one due repair card vs one queued-new
    // exploration card (novelty). With a constant draw the LARGER total wins
    // (weightedKey is monotone in the score), so allocation is pinned.
    const nowMs = 1_000_000_000_000;
    const DAY = 24 * 60 * 60 * 1000;
    const pool = [
      { id: 'repair', word: 'dringend', language: 'de', targets: [target], dueDate: nowMs - 10_000, interval: 1_000, state: 'review' as const, pressure: 0.9 },
      { id: 'explore', word: 'ganzneu', language: 'de', targets: [target], dueDate: nowMs - 10_000, interval: 0, state: 'new' as const },
    ];
    const pick = (goal: { kind: 'exam'; deadlineMs: number } | undefined) => selectNextEncounter({
      preset: 'RETENTION',
      nowMs,
      reviewQueueEntries: pool,
      context: goal ? { intensity: 'intensive', goal } : { intensity: 'intensive' },
      rng: () => 0.5,
    })!.candidate.key;
    // Near deadline: consolidation ×1.5 lifts the repair card over the
    // novelty-discounted exploration card.
    expect(pick({ kind: 'exam', deadlineMs: nowMs + 21 * DAY })).toBe('repair');
    // Six months out: no goal weighting — exploration edges out.
    expect(pick({ kind: 'exam', deadlineMs: nowMs + 180 * DAY })).toBe('explore');
  });

  it('suggested auto-promotion order responds to media recurrence and canonical status', () => {
    // Mirrors the FlashcardContext new-day top-up call: suggestions carry
    // passive recurrence (count) and canonical statuses.
    const decisions = selectRankedEncounters({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [
        { key: 's-one', word: 'eins', language: 'de', timesSeen: 1 },
        { key: 's-two', word: 'zwei', language: 'de', timesSeen: 6 },
        { key: 's-known', word: 'bekannt', language: 'de', status: 'known' as const, timesSeen: 9 },
      ],
      rng: () => 0.5,
    }, 3);
    const keys = decisions.map((decision) => decision.candidate.key);
    // Saturated recurrence (zwei, 6/6) outranks the one-off (eins, 1/6) on
    // the SAME candidate; the known word yields NO candidate at all.
    expect(keys).toEqual(['s-two', 's-one']);
    expect(keys).not.toContain('s-known');
    expect(decisions.every((decision) => decision.candidate.word !== 'bekannt')).toBe(true);
    // Recurrence never masquerades as knowledge: it is a coverage score on
    // the candidate, with the canonical status still caller-owned.
    expect(decisions[0]!.candidate.scores['media-relevance']).toBe(1);
    expect(decisions[1]!.candidate.scores['media-relevance']).toBeCloseTo(1 / 6);
  });
});

describe('REQ24 dead-source wiring', () => {
  it('selects calibration probes under the CALIBRATION preset', () => {
    const decision = selectNextEncounter({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [],
      probeTargets: [{
        target: { entityId: 'de:grammar:past tense', capability: 'grammar-recognition' },
        pSuccess: 0.5,
        uncertainty: 1,
      }],
      rng: () => 0.5,
    });

    expect(decision?.action).toBe('PROBE');
    expect(decision?.candidate.origin).toBe('probe');
    expect(decision?.candidate.scores['information-gain']).toBe(1);
  });

  it('merges weak targets into the calibration mix and selects them as TEACH', () => {
    const decision = selectNextEncounter({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.3 }],
      rng: () => 0.5,
    });

    expect(decision?.action).toBe('TEACH');
    expect(decision?.candidate.origin).toBe('weak-target');
  });

  it('merges weak targets into the retention pool as fallback fill', () => {
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
      rng: () => 0.5,
    });

    expect(decision?.action).toBe('TEACH');
    expect(decision?.candidate.origin).toBe('weak-target');
  });

  it('keeps due review cards ranked above zero-weight weak targets', () => {
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'due', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
      rng: () => 0.5,
    });

    expect(decision?.candidate.key).toBe('due');
    expect(decision?.action).toBe('MAINTAIN');
  });
});

describe('REQ39 grammar exposure priority', () => {
  const encounters = [
    { pattern: 'negation', language: 'de', timesEncountered: 4, measured: false },
    { pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false },
  ];

  it('prioritizes repeatedly-seen unmeasured patterns through the single policy layer', () => {
    const decision = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [],
      grammarEncounters: encounters,
      rng: () => 0.5,
    });

    expect(decision?.candidate.origin).toBe('grammar');
    expect(decision?.candidate.key).toBe(grammarEntityId('de', 'past tense'));
    expect(decision?.candidate.scores['curriculum-relevance']).toBe(1);

    const reversed = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [],
      grammarEncounters: [...encounters].reverse(),
      rng: () => 0.5,
    });
    expect(reversed?.candidate.key).toBe(grammarEntityId('de', 'past tense'));
  });

  it('ranks exposure-saturated grammar patterns against suggested words in one weighted pick', () => {
    const decision = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
      grammarEncounters: [{ pattern: 'negation', language: 'de', timesEncountered: 4, measured: false }],
      rng: () => 0.5,
    });

    // Both compete on curriculum-relevance: word scores 1, pattern 4/6.
    expect(decision?.candidate.key).toBe('de:wort');
  });
});

describe('curriculum grammar candidates', () => {
  it('CURRICULUM merges package-declared grammar constructions with a task declaring what it measures', () => {
    const decisions = selectEncounterBatch({
      preset: 'CURRICULUM',
      nowMs: 0,
      levelStudyItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
      curriculumGrammarItems: [{ language: 'de', pattern: 'weil-Satz', level: 3 }],
    });
    const grammar = decisions.find((decision) => decision.candidate.key === 'de:grammar:weil-Satz');
    expect(grammar).toBeDefined();
    expect(grammar!.action).toBe('TEACH');
    expect(grammar!.encounter.task.taskTemplateId).toBe('grammar-recognize');
    expect(grammar!.encounter.task.requested).toEqual(['grammar-recognition']);
    expect(grammar!.encounter.targets).toEqual([{ entityId: 'de:grammar:weil-Satz', capability: 'grammar-recognition' }]);
  });

  it('the lexical level-study flow stays word-only when no grammar items are supplied', () => {
    const decisions = selectEncounterBatch({
      preset: 'CURRICULUM',
      nowMs: 0,
      levelStudyItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
    });
    expect(decisions.every((decision) => decision.candidate.word !== undefined)).toBe(true);
  });
});

describe('candidate origin reachability', () => {
  it('reaches every non-reserved origin from sourceCandidates', () => {
    const origins = new Set<string>();
    const collect = (inputs: EncounterInputs) => {
      for (const decision of selectEncounterBatch(inputs)) origins.add(decision.candidate.origin);
    };

    collect({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'due', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
    });
    collect({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [{ key: 'de:neu', word: 'neu', language: 'de', targets: [target], scores: { novelty: 1 } }],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
      probeTargets: [{
        target: { entityId: 'de:grammar:past tense', capability: 'grammar-recognition' },
        pSuccess: 0.5,
        uncertainty: 1,
      }],
    });
    collect({ preset: 'CURRICULUM', nowMs: 0, levelStudyItems: [{ key: 'de:wort', word: 'wort', language: 'de' }] });
    collect({ preset: 'MEDIA', nowMs: 0, mediaItems: [{ key: 'de:wort', word: 'wort', language: 'de' }] });
    collect({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
      grammarEncounters: [{ pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false }],
    });

    expect(origins).toEqual(new Set([
      'retention',
      'curriculum',
      'calibration',
      'weak-target',
      'probe',
      'media',
      'grammar',
    ]));
    expect(origins.has('assignment')).toBe(false);
  });
});

describe('source purity', () => {
  it('grammar encounters are read-only policy input — never evidence writes', () => {
    const grammarEncounters = Object.freeze([
      Object.freeze({ pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false }),
    ]);

    const decision = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [],
      grammarEncounters,
      rng: () => 0.5,
    });

    expect(decision?.candidate.origin).toBe('grammar');
    expect(decision?.candidate.meta).toEqual({ pattern: 'past tense', timesEncountered: 12 });
    expect(grammarEncounters).toEqual([
      { pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false },
    ]);
  });
});

describe('learner context passthrough (R07/R08)', () => {
  it('reaches the policy trace from the top-level field without being clobbered by config', () => {
    const context = { goal: { kind: 'exam' as const, deadlineMs: 10_000 + 21 * 24 * 60 * 60 * 1000 }, intensity: 'steady' as const };
    const decision = selectNextEncounter({
      preset: 'CURRICULUM',
      nowMs: 10_000,
      levelStudyItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
      context,
      config: {},
    })!;
    expect(decision.trace!.inputs.goal).toEqual(context.goal);
    expect(decision.trace!.inputs.intensity).toBe('steady');
    expect(decision.trace!.weights.rules.map((rule) => rule.rule)).toEqual([
      'deadline-consolidation',
      'deadline-consolidation',
      'deadline-novelty-discount',
      'intensity-momentum',
    ]);
  });

  it('still honors a context supplied through config when the top-level field is omitted', () => {
    const decision = selectNextEncounter({
      preset: 'CURRICULUM',
      nowMs: 10_000,
      levelStudyItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
      config: { context: { intensity: 'gentle' } },
    })!;
    expect(decision.trace!.inputs.intensity).toBe('gentle');
  });
});

describe('media fit through the MEDIA preset (R21)', () => {
  it('accepts rich media-fit inputs alongside the legacy plain items', () => {
    const decision = selectNextEncounter({
      preset: 'MEDIA',
      nowMs: 10_000,
      mediaItems: [{ key: 'ja:surface:茶道', word: '茶道', language: 'ja' }],
      mediaOpportunities: [
        { key: 'ja:surface:粉飾', word: '粉飾', language: 'ja', timesSeen: 12, timesHovered: 4, status: 'unmeasured' },
      ],
      rng: () => 0.5,
    })!;
    expect(decision.candidate.key).toBe('ja:surface:粉飾');
    expect(decision.trace!.ranking.find((row) => row.key === 'ja:surface:粉飾')!.total).toBeCloseTo(2, 12);
  });

  it('keeps the legacy plain-item MEDIA path byte-identical when no rich input is supplied', () => {
    const decision = selectNextEncounter({
      preset: 'MEDIA',
      nowMs: 0,
      mediaItems: [{ key: 'ja:surface:茶道', word: '茶道', language: 'ja' }],
      rng: () => 0.5,
    })!;
    expect(decision.candidate.key).toBe('ja:surface:茶道');
    expect(decision.candidate.scores).toEqual({ novelty: 1 });
  });
});

describe('media fit reaches the same policy (R21, acceptance 17)', () => {
  it('ranks a recurring outside-exam domain term above unknown exam-list work, with a trace', () => {
    // 半沢直樹-style fixture: 粉飾 (window dressing) recurs across the series
    // the learner chose; the exam-list word is unmeasured but low-value work.
    const decision = selectNextEncounter({
      preset: 'CURRICULUM',
      nowMs: 10_000,
      levelStudyItems: [{ key: 'ja:surface:茶道', word: '茶道', language: 'ja' }],
      mediaOpportunities: [
        { key: 'ja:surface:粉飾', word: '粉飾', language: 'ja', timesSeen: 12, timesHovered: 4, status: 'unmeasured' },
      ],
      rng: () => 0.5,
    })!;
    expect(decision.candidate.key).toBe('ja:surface:粉飾');
    expect(decision.action).toBe('TEACH');
    const trace = decision.trace!;
    const chosen = trace.ranking.find((row) => row.key === 'ja:surface:粉飾')!;
    expect(chosen.contributions.map((entry) => [entry.dimension, entry.value]))
      .toEqual(expect.arrayContaining([
        ['media-relevance', 1],
        ['novelty', 1],
      ]));
    expect(chosen.total).toBeCloseTo(2, 12);
    expect(trace.ranking.some((row) => row.key === 'ja:surface:茶道' && row.total === 1)).toBe(true);
    expect(trace.limits.join(' ')).toContain('not demonstrated comprehension');
  });

  it('accepts rich media-fit inputs on the MEDIA preset itself', () => {
    const decision = selectNextEncounter({
      preset: 'MEDIA',
      nowMs: 10_000,
      mediaItems: [{ key: 'ja:surface:茶道', word: '茶道', language: 'ja' }],
      mediaOpportunities: [
        { key: 'ja:surface:粉飾', word: '粉飾', language: 'ja', timesSeen: 12, timesHovered: 4, status: 'unmeasured' },
      ],
      rng: () => 0.5,
    })!;
    expect(decision.candidate.key).toBe('ja:surface:粉飾');
    expect(decision.trace!.ranking.find((row) => row.key === 'ja:surface:粉飾')!.total).toBeCloseTo(2, 12);
  });

  it('carries candidate provenance through real production trace rows (R20)', () => {
    // The SUGGESTED auto-promotion shape (FlashcardContext new-day top-up):
    // suggestions ride their capture provenance, media-fit rows ride the
    // contributing media identities.
    const suggested = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 10_000,
      suggestedItems: [
        {
          key: 's-1', word: 'eins', language: 'de', timesSeen: 6, status: 'unmeasured' as const,
          source: 'Tagesschau', sourceMediaHash: 'h1',
        },
      ],
      mediaOpportunities: [
        {
          key: 'de:surface:zwei', word: 'zwei', language: 'de', timesSeen: 12, timesHovered: 2,
          status: 'learning' as const,
          sources: [{ mediaHash: 'h1', mediaName: 'Tagesschau' }, { mediaHash: 'h2', mediaName: 'heute' }],
        },
      ],
      rng: () => 0.5,
    })!;
    expect(suggested.trace!.ranking.find((row) => row.key === 's-1')!.meta).toMatchObject({
      source: 'Tagesschau',
      sourceMediaHash: 'h1',
    });
    expect(suggested.trace!.ranking.find((row) => row.key === 'de:surface:zwei')!.meta).toMatchObject({
      sources: [{ mediaHash: 'h1', mediaName: 'Tagesschau' }, { mediaHash: 'h2', mediaName: 'heute' }],
    });

    // Curriculum grammar rows name the package content version they came from.
    const grammar = selectNextEncounter({
      preset: 'CURRICULUM',
      nowMs: 10_000,
      levelStudyItems: [],
      curriculumGrammarItems: [{ language: 'de', pattern: 'weil-Satz', level: 3, contentVersion: 'grammar-data@7' }],
      rng: () => 0.5,
    })!;
    expect(grammar.trace!.ranking.find((row) => row.key === 'de:grammar:weil-Satz')!.meta).toMatchObject({
      pattern: 'weil-Satz',
      level: 3,
      contentVersion: 'grammar-data@7',
    });
  });

  it('yields no candidate when every curriculum item is already known', () => {
    const decision = selectNextEncounter({
      preset: 'CURRICULUM',
      nowMs: 10_000,
      levelStudyItems: [{ key: 'de:wort', word: 'wort', language: 'de', status: 'known' }],
      mediaOpportunities: [
        { key: 'de:surface:bank', word: 'Bank', language: 'de', timesSeen: 9, timesHovered: 0, status: 'known' },
      ],
    });
    expect(decision).toBeNull();
  });
});
