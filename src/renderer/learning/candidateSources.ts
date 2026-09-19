import { SRS_EASE } from '../../shared/constants';
import { grammarEntityId } from '../../shared/graph/load';
import type { LearnableTarget } from '../../shared/graph/types';
import type { FlashcardState, MediaStats } from '../../shared/types';
import type { Candidate } from './types';
import { GRAMMAR_RECOGNIZE_TASK } from './types';

export interface FlashcardLike {
  id: string;
  word?: string;
  language: string;
  targets: LearnableTarget[];
  dueDate: number;
  interval: number;
  /** Derived retention pressure when the scheduler has already replayed evidence. */
  pressure?: number;
  suspended?: boolean;
  buried?: boolean;
  /**
   * Scheduler-replayed journal state used by the momentum producer (R08):
   * a card reviewed within MOMENTUM_WINDOW_MS at or above the graduated
   * ease default is recently consolidated. Absent fields = no momentum
   * signal (legacy callers stay byte-identical). A lapsed (relearning) or
   * in-progress (learning) card is explicitly NOT consolidated: momentum 0.
   */
  state?: FlashcardState;
  /**
   * Scheduler admission: the entry came from the scheduler's own same-day
   * queue, so it stays in scope for today even when its due time is later
   * today. Admission is fill-only: later-today entries enter the pool when
   * nothing is due now, never ahead of due-now cards (R08 same-day order).
   */
  scheduledForToday?: boolean;
  lastReviewed?: number;
  ease?: number;
  reviews?: number;
}

export type CalibrationPoolItem = Omit<Candidate, 'origin'>;

export interface LearnableWordSourceItem {
  key: string;
  word: string;
  language: string;
  /**
   * Optional canonical journal status. When present, a `known` item yields NO
   * candidate: secure knowledge deserves no practice slot now (R03/R21).
   * Absent status keeps the historical caller-owned prefilter contract.
   */
  status?: 'unmeasured' | 'learning' | 'known';
  /**
   * Optional passive recurrence of the word in the learner's CURRENTLY
   * SELECTED content (R21): recorded exposures, saturating at
   * MEDIA_SATURATION_ENCOUNTERS. Coverage heuristic only — lookups are never
   * counted and this is never read as knowledge.
   */
  timesSeen?: number;
  /**
   * Where this item was captured from (R20 provenance): the source media's
   * display name and its content hash, carried verbatim into candidate meta
   * so a trace row can identify the media snapshot behind a recommendation.
   * Absent = no recorded provenance; meta simply omits the fields.
   */
  source?: string;
  sourceMediaHash?: string;
}

export interface WeakTargetEntry {
  word: string;
  language: string;
  status: 'unknown' | 'learning' | 'known';
  ease: number;
}

export interface SupportedProbeTarget {
  target: LearnableTarget;
  pSuccess: number;
  uncertainty: number;
}

/**
 * A missing written bridge on an ALREADY-SYNCHRONIZED lexical object (sense
 * or spoken access known, graph-resolved across variant surfaces). Completing
 * one directed access is cheap graph completion, not teaching a novel word.
 */
export interface BridgeCandidateInput {
  key: string;
  word: string;
  language: string;
  /** The missing written accesses (surface-recognition / surface-reading targets). */
  missingBridges: readonly LearnableTarget[];
  /** Graph-relative predicted accessibility of the bridge (entry + character support). */
  pSuccess?: number;
  /** The lexical object is synchronized (sense/spoken known through any authoritative variant). */
  synchronized: boolean;
}


export interface ProbeCooldownState {
  nowMs: number;
  cooldownMs: number;
  uncertaintyFloor: number;
  cooldowns: ReadonlyMap<string, number>;
}

export interface GrammarEncounterEntry {
  pattern: string;
  language: string;
  /** Passive exposure count (timesEncountered from the grammar knowledge store / evidence replay). */
  timesEncountered: number;
  /** True when recorded evidence or an explicit claim already measures the pattern. */
  measured: boolean;
}

export interface GrammarEncounterOptions {
  /** Patterns below this passive exposure count are not offered yet. */
  minEncounters?: number;
  /** Exposure count mapped to a full relevance score. Defaults to twice minEncounters. */
  saturationCount?: number;
}

export function retentionDueCandidates(cards: readonly FlashcardLike[], nowMs: number): Candidate[] {
  const available = cards.filter((card) => !card.suspended && !card.buried);
  const dueNow = available.filter((card) => card.dueDate <= nowMs);
  // Same-day admission fills the pool only when nothing is due now: a card
  // whose step time has not arrived never jumps the scheduler's due-now
  // order or its push-to-end lapse handling (R08). With nothing due now, the
  // scheduler's remaining same-day workload IS the pool.
  const pool = dueNow.length > 0
    ? dueNow
    : available.filter((card) => card.scheduledForToday === true);
  return pool
    .map((card) => {
      // A queued never-reviewed card is EXPLORATION, not repair: its dueDate
      // is its creation time and its interval is 0, so the lateness formula
      // would fabricate maximal retention-need. It scores novelty instead and
      // carries the 'new-card' origin (action TEACH) so the trace stays honest.
      if (card.state === 'new') {
        return {
          key: card.id,
          word: card.word,
          language: card.language,
          targets: card.targets,
          origin: 'new-card' as const,
          scores: { novelty: 1 },
          // Source inputs verbatim for the trace (R20): the never-reviewed
          // state IS the novelty score's derivation, and dueDate is the
          // creation-time admission into the pool.
          meta: { state: 'new', dueDate: card.dueDate },
        };
      }
      const momentum = momentumScore(card, nowMs);
      return {
        key: card.id,
        word: card.word,
        language: card.language,
        targets: card.targets,
        origin: 'retention' as const,
        scores: {
          'retention-need': card.pressure ?? clamp((nowMs - card.dueDate) / Math.max(1, card.interval)),
          ...(momentum !== undefined ? { momentum } : {}),
        },
        // Source inputs verbatim for the trace (R20): the lateness
        // arithmetic (dueDate/interval, or the scheduler's own pressure
        // override) and the scheduler-replayed state feeding momentum —
        // timestamps and counts the scores were derived from, not just the
        // arithmetic.
        meta: {
          dueDate: card.dueDate,
          interval: card.interval,
          state: card.state,
          ...(card.pressure !== undefined ? { pressure: card.pressure } : {}),
          ...(card.lastReviewed !== undefined ? { lastReviewed: card.lastReviewed } : {}),
          ...(card.ease !== undefined ? { ease: card.ease } : {}),
          ...(card.reviews !== undefined ? { reviews: card.reviews } : {}),
        },
      };
    });
}

/**
 * Recent-consolidation window (R08 producer heuristic, bounded): a graduated
 * review within this window pads selection momentum. Labelled heuristic —
 * selection-only, never evidence and never a threshold.
 */
export const MOMENTUM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Honest momentum derivation from scheduler-replayed journal state (R08):
 * momentum requires the card to have graduated reviews AND a current ease at
 * or above the graduated default (a lapsed/struggling card is not recently
 * consolidated); the score decays linearly over the window. Returns
 * undefined when the caller supplied no replay state — no invented signal.
 */
export function momentumScore(card: FlashcardLike, nowMs: number): number | undefined {
  if (card.lastReviewed === undefined || card.ease === undefined || !card.reviews) return undefined;
  // The graduation rule made explicit against scheduler-replayed state: only
  // a graduated card is recently consolidated. A lapsed (relearning) or
  // in-progress (learning) card owes the scheduler's delay and is NEVER
  // momentum padding, whatever its ease or recency (R08).
  if (card.state === 'relearning' || card.state === 'learning') return 0;
  if (card.ease < SRS_EASE.DEFAULT_KNOWN) return 0;
  return clamp(1 - (nowMs - card.lastReviewed) / MOMENTUM_WINDOW_MS);
}

export function calibrationUnmeasuredCandidates(poolItems: readonly CalibrationPoolItem[]): Candidate[] {
  return poolItems.map((item) => ({ ...item, origin: 'calibration' }));
}

/**
 * Bridge source: synchronized lexical objects with missing written accesses.
 * Value ≈ useful graph completion ÷ teaching cost — information-gain is full
 * (the graph genuinely completes), novelty is zero (nothing linguistically
 * new), and attention-cost falls as the graph-relative prediction rises, so
 * cheap bridges outrank novel objects under a cost-aware policy.
 */
export function bridgeCandidates(items: readonly BridgeCandidateInput[]): Candidate[] {
  return items.filter((item) => item.synchronized).map((item) => ({
    key: item.key,
    word: item.word,
    language: item.language,
    targets: [...item.missingBridges],
    origin: 'bridge' as const,
    scores: {
      'information-gain': 1,
      novelty: 0,
      uncertainty: 1,
      'attention-cost': item.pSuccess !== undefined ? clamp(1 - item.pSuccess) : 0.5,
    },
    meta: { bridge: true, ...(item.pSuccess !== undefined ? { pSuccess: item.pSuccess } : {}) },
  }));
}

export function curriculumCandidates(items: readonly LearnableWordSourceItem[]): Candidate[] {
  return wordCandidates(items, 'curriculum', 'curriculum-relevance');
}

export function mediaOpportunityCandidates(items: readonly LearnableWordSourceItem[]): Candidate[] {
  return wordCandidates(items, 'media', 'novelty');
}

/**
 * Encounter total below this is a one-off, not a recurring blocker (R21).
 * The suggestion path reuses the SAME threshold when current-media
 * recurrence admits an off-list term — one recurrence rule, two consumers.
 */
export const MEDIA_MIN_ENCOUNTERS = 2;

/** Encounters mapped to a full media-relevance score (diminishing-returns cap, R21). */
export const MEDIA_SATURATION_ENCOUNTERS = 6;

/**
 * One unmeasured-or-learning term from the learner's CURRENTLY SELECTED
 * media (R21). Recurrence means the token repeatedly blocks comprehension of
 * content the learner chose — exam-list membership is irrelevant. Lookups
 * (timesHovered) are assisted access, never knowledge: status stays the
 * caller's canonical journal answer.
 */
export interface MediaOpportunityInput {
  key: string;
  word: string;
  language: string;
  /** Passive exposures of the surface in the selected content. */
  timesSeen: number;
  /** Dictionary/hover lookups in the selected content (assisted access). */
  timesHovered: number;
  /** Canonical journal status; `known` yields NO candidate (no practice value now). */
  status: 'unmeasured' | 'learning' | 'known';
  /**
   * Contributing media identities (R20 provenance), deduplicated by hash and
   * capped at MEDIA_OPPORTUNITY_SOURCE_CAP; `sourcesOmitted` counts the rest.
   * Recorded in candidate meta so a trace names WHICH content supplied the
   * recurrence — counts alone cannot (R20).
   */
  sources?: ReadonlyArray<{ mediaHash: string; mediaName?: string }>;
  sourcesOmitted?: number;
}

/**
 * Bounded trace size: contributing media identities kept per aggregated
 * media-opportunity word (R20 persistence bound).
 */
export const MEDIA_OPPORTUNITY_SOURCE_CAP = 4;

export interface MediaOpportunityOptions {
  /** Encounter total below this is a one-off, not a recurring blocker. */
  minEncounters?: number;
  /** Encounters mapped to a full relevance score (diminishing returns cap). */
  saturationEncounters?: number;
}

/**
 * Media-fit source: recurring, not-yet-secure terms from the learner's own
 * content, fed through the SAME teaching policy as curriculum/retention
 * (R21 — no separate media scheduler, no per-show mastery store).
 *
 * Coverage/access/understanding stay distinct: `media-relevance` derives
 * ONLY from `timesSeen` — passive coverage recurrence in the selected
 * content (saturating clamp = diminishing returns, one occurrence is never
 * an independent learning gain). `timesHovered` lookups are assisted access:
 * recorded in meta for the trace, never scored as coverage and never read
 * as knowledge. `novelty` = 1 unmeasured / 0.5 learning (partially
 * measured); `known` yields NO candidate.
 */
export function mediaRelevanceCandidates(
  items: readonly MediaOpportunityInput[],
  options: MediaOpportunityOptions = {},
): Candidate[] {
  const minEncounters = options.minEncounters ?? MEDIA_MIN_ENCOUNTERS;
  const saturation = Math.max(1, options.saturationEncounters ?? MEDIA_SATURATION_ENCOUNTERS);
  return items
    .filter((item) => item.status !== 'known')
    .map((item) => ({
      key: item.key,
      word: item.word,
      language: item.language,
      targets: [{ entityId: `${item.language}:surface:${item.word}`, capability: 'surface-recognition' as const }],
      origin: 'media' as const,
      scores: {
        'media-relevance': clamp(item.timesSeen / saturation),
        novelty: item.status === 'unmeasured' ? 1 : 0.5,
      },
      meta: {
        timesSeen: item.timesSeen,
        timesHovered: item.timesHovered,
        status: item.status,
        // Media identity provenance (R20): which selected content supplied
        // the recurrence — bounded, deduplicated by hash, remainder counted.
        ...(item.sources?.length ? { sources: item.sources } : {}),
        ...(item.sourcesOmitted ? { sourcesOmitted: item.sourcesOmitted } : {}),
      },
    }))
    .filter((candidate) => (candidate.meta.timesSeen as number) >= minEncounters);
}

/**
 * R21 producer: aggregates the learner's recorded media statistics into
 * media-fit opportunity inputs. `timesSeen`/`timesHovered` SUM across the
 * learner's selected content; the canonical STATUS stays the caller's
 * journal answer via `statusOf` — media counts are coverage, never
 * knowledge, so this producer never classifies by proxy. Pure and total:
 * absent `wordsEncountered` contributes nothing.
 */
export interface MediaOpportunitiesFromStatsOptions {
  statusOf: (word: string) => 'unmeasured' | 'learning' | 'known';
  /** Restrict aggregation to one learning language. */
  language?: string;
}

export function mediaOpportunitiesFromStats(
  statsList: readonly MediaStats[],
  options: MediaOpportunitiesFromStatsOptions,
): MediaOpportunityInput[] {
  const byWord = new Map<string, MediaOpportunityInput>();
  for (const stats of statsList) {
    if (options.language !== undefined && stats.language !== options.language) continue;
    const language = options.language ?? stats.language;
    for (const entry of Object.values(stats.wordsEncountered ?? {})) {
      if (!entry?.word) continue;
      const key = `${language}:surface:${entry.word}`;
      const existing = byWord.get(key);
      const identity = { mediaHash: stats.mediaHash, ...(stats.mediaName ? { mediaName: stats.mediaName } : {}) };
      if (existing) {
        existing.timesSeen += entry.timesSeen;
        existing.timesHovered += entry.timesHovered;
        // Bounded provenance (R20): each contributing media once per word,
        // capped; beyond the cap the remainder is counted, not dropped
        // silently.
        const sources = existing.sources ?? [];
        if (!sources.some((source) => source.mediaHash === stats.mediaHash)) {
          if (sources.length < MEDIA_OPPORTUNITY_SOURCE_CAP) {
            existing.sources = [...sources, identity];
          } else {
            existing.sourcesOmitted = (existing.sourcesOmitted ?? 0) + 1;
          }
        }
      } else {
        byWord.set(key, {
          key,
          word: entry.word,
          language,
          timesSeen: entry.timesSeen,
          timesHovered: entry.timesHovered,
          status: options.statusOf(entry.word),
          sources: [identity],
        });
      }
    }
  }
  return [...byWord.values()];
}

/** Package-declared curriculum membership for one grammar construction. */
export interface CurriculumGrammarItem {
  language: string;
  pattern: string;
  /** Bucket on the language's OWN grammar scale (GrammarPoint.level). */
  level: number;
  /** Optional package-defined weight; default 1. */
  weight?: number;
  /** Optional package-declared semantic family (e.g. "conditional"). Present enables category-bottleneck pressure. */
  category?: string;
  /**
   * Package-declared content version the construction's curriculum placement
   * came from (R20 provenance), e.g. the language package's manifest version.
   * Recorded in candidate meta so a trace names WHICH curriculum snapshot
   * supplied the recommendation. Absent = the caller had no version; meta
   * simply omits the field.
   */
  contentVersion?: string;
}

export interface CurriculumGrammarOptions {
  /**
   * Category-bottleneck pressure (R07): per-category failure density 0..1
   * derived from recorded measurements (`grammarCategoryPressure`).
   * Constructions of a pressured category gain curriculum-relevance in the
   * SAME weighted pick — no separate scheduler. Absent/empty = legacy
   * behavior byte-identical.
   */
  categoryPressure?: Readonly<Record<string, number>>;
}

/**
 * Curriculum grammar source: constructions the package's curriculum data
 * places on its grammar scale, emitted as first-class curriculum candidates
 * whose task template declares that it measures grammar-recognition. Lexical
 * curriculum flow (level-study bulk add) does NOT consume these — they have
 * no word form.
 */
export function curriculumGrammarCandidates(
  items: readonly CurriculumGrammarItem[],
  options: CurriculumGrammarOptions = {},
): Candidate[] {
  const pressure = options.categoryPressure ?? {};
  return items.map((item) => {
    // Weight stays clamped to [0,1]; pressure adds beyond it so a pressured
    // category genuinely outranks an unpressured weight-1 construction
    // (heuristic score values discriminate — never probabilities).
    const boost = item.category !== undefined ? clamp(pressure[item.category] ?? 0) : 0;
    return {
      key: `${item.language}:grammar:${item.pattern}`,
      language: item.language,
      targets: [{ entityId: grammarEntityId(item.language, item.pattern), capability: 'grammar-recognition' as const }],
      origin: 'curriculum' as const,
      task: GRAMMAR_RECOGNIZE_TASK,
      scores: { 'curriculum-relevance': clamp(item.weight ?? 1) + boost },
      meta: {
        pattern: item.pattern,
        level: item.level,
        ...(item.contentVersion !== undefined ? { contentVersion: item.contentVersion } : {}),
        ...(boost > 0 ? { category: item.category, categoryPressure: boost } : {}),
      },
    };
  });
}

export function suggestedLearningCandidates(items: readonly LearnableWordSourceItem[]): Candidate[] {
  return wordCandidates(items, 'curriculum', 'curriculum-relevance');
}

export function weakTargetCandidates(entries: readonly WeakTargetEntry[]): Candidate[] {
  const learningRange = SRS_EASE.DEFAULT_KNOWN - SRS_EASE.MIN;
  return entries
    .filter((entry) => entry.status === 'learning')
    .map((entry) => ({
      key: `${entry.language}:${entry.word}`,
      word: entry.word,
      language: entry.language,
      targets: [{
        entityId: `${entry.language}:surface:${entry.word}`,
        capability: 'surface-recognition',
      }],
      origin: 'weak-target',
      scores: {
        'curriculum-relevance': clamp((entry.ease - SRS_EASE.MIN) / learningRange),
      },
      // Source input verbatim for the trace (R20): the ease the relevance
      // score was derived from.
      meta: { ease: entry.ease },
    }));
}

/**
 * REQ39 exposure source: repeatedly-seen-but-unmeasured grammar patterns gain
 * candidate priority through the teaching policy's weighted pick. Pure selector
 * over the caller-supplied exposure snapshot — never writes knowledge.
 */
export function grammarEncounterCandidates(
  entries: readonly GrammarEncounterEntry[],
  options: GrammarEncounterOptions = {},
): Candidate[] {
  const minEncounters = options.minEncounters ?? 3;
  const saturation = Math.max(1, options.saturationCount ?? minEncounters * 2);
  return entries
    .filter((entry) => !entry.measured && entry.timesEncountered >= minEncounters)
    .map((entry) => ({
      key: grammarEntityId(entry.language, entry.pattern),
      language: entry.language,
      targets: [{
        entityId: grammarEntityId(entry.language, entry.pattern),
        capability: 'grammar-recognition',
      }],
      origin: 'grammar',
      scores: { 'curriculum-relevance': clamp(entry.timesEncountered / saturation) },
      meta: { pattern: entry.pattern, timesEncountered: entry.timesEncountered },
    }));
}

export function probeCandidates(
  supportedTargets: readonly SupportedProbeTarget[],
  cooldownState: ProbeCooldownState,
): Candidate[] {
  return supportedTargets.flatMap(({ target, pSuccess, uncertainty }) => {
    const key = `${target.entityId}:${target.capability}`;
    const lastProbeAt = cooldownState.cooldowns.get(key);
    const cooldownPassed = lastProbeAt === undefined
      || cooldownState.nowMs - lastProbeAt >= cooldownState.cooldownMs;
    if (uncertainty <= cooldownState.uncertaintyFloor || !cooldownPassed) return [];

    return [{
      key,
      language: target.entityId.split(':', 1)[0],
      targets: [target],
      origin: 'probe',
      scores: {
        'information-gain': binaryEntropy(clamp(pSuccess)),
        uncertainty,
      },
      meta: { pSuccess },
    }];
  });
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mediaSaturation(): number {
  return Math.max(1, MEDIA_SATURATION_ENCOUNTERS);
}

function wordCandidates(
  items: readonly LearnableWordSourceItem[],
  origin: Candidate['origin'],
  score: 'curriculum-relevance' | 'novelty',
): Candidate[] {
  // A `known` item deserves no practice slot now (R03/R21): secure knowledge
  // is excluded at the source. Absent status keeps the legacy caller-owned
  // prefilter contract byte-identical.
  return items
    .filter((item) => item.status !== 'known')
    .map((item) => ({
      ...item,
      targets: [{ entityId: `${item.language}:surface:${item.word}`, capability: 'surface-recognition' }],
      origin,
      scores: {
        [score]: 1,
        // Recurrence in the learner's selected content rides the SAME
        // candidate (R21) — no duplicate word entry in the pool.
        ...(item.timesSeen !== undefined
          ? { 'media-relevance': clamp(item.timesSeen / mediaSaturation()) }
          : {}),
      },
      // Source inputs verbatim for the trace (R20): media-relevance derives
      // from this recurrence count, status is the canonical journal answer
      // the source filtered on, and source/sourceMediaHash identify the
      // media snapshot the item was captured from.
      meta: {
        ...(item.timesSeen !== undefined ? { timesSeen: item.timesSeen } : {}),
        ...(item.status !== undefined ? { status: item.status } : {}),
        ...(item.source !== undefined ? { source: item.source } : {}),
        ...(item.sourceMediaHash !== undefined ? { sourceMediaHash: item.sourceMediaHash } : {}),
      },
    }));
}

function binaryEntropy(probability: number): number {
  if (probability === 0 || probability === 1) return 0;
  return -probability * Math.log2(probability)
    - (1 - probability) * Math.log2(1 - probability);
}
