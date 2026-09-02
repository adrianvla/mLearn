import { getBackend } from '../../shared/backends';
import { getLogger } from '../../shared/utils/logger';
import type { KnowledgeEvent, KnowledgeEventLog, Rating } from '../../shared/knowledgeEvents';
import type { AnkiReviewEntry } from '../hooks/useAnki';
import type { AnkiCardInfo } from '../hooks/useAnki';
import { appendEvents, getEventLogForLanguage } from './knowledgeEvents';
import { hashWordSync } from './srsAlgorithm';
import { grammarEvidenceKey, grammarTarget, type GrammarCapability } from '../../shared/grammar/evidence';
import type { GrammarPoint } from '../../shared/types';

const log = getLogger('renderer.services.ankiReviewImport');

const REVIEW_BATCH_SIZE = 500;

const RATING_BY_BUTTON: Record<number, Rating> = {
  1: 'again',
  2: 'hard',
  3: 'good',
  4: 'easy',
};

export interface AnkiReviewImportResult {
  words: number;
  imported: number;
  skipped: number;
  /** Word texts that received newly appended events; caller refreshes their materialized projections. */
  importedWords: string[];
}

export interface AnkiReviewImportDeps {
  fetchReviews: (cardIds: number[]) => Promise<Record<string, AnkiReviewEntry[]>>;
  /** Optional card metadata enables conservative grammar imports from explicit card text. */
  fetchCards?: (cardIds: number[]) => Promise<AnkiCardInfo[]>;
  grammar?: readonly GrammarPoint[];
}

function toReviewEvent(entry: AnkiReviewEntry, easeBefore: number | undefined): KnowledgeEvent | null {
  // Revlog type 3 = filtered/cram, 4 = manual reschedule — not knowledge evidence.
  if (entry.type > 2) return null;
  return {
    t: entry.id,
    kind: 'review',
    source: 'anki',
    aspect: 'meaning',
    rating: RATING_BY_BUTTON[entry.ease],
    intervalBefore: entry.lastIvl,
    intervalAfter: entry.ivl,
    // Anki events carry the RAW anki factor (e.g. 1800), not SRS ease — replay
    // normalizes per source domain. Do NOT /1000 here.
    easeAfter: entry.factor > 0 ? entry.factor : undefined,
    easeBefore,
    ankiReviewId: entry.id,
  };
}

function ankiQuality(ease: number): KnowledgeEvent['quality'] {
  return ease === 1 ? 'missed' : ease === 2 ? 'struggled' : 'fluent';
}

function cardContainsPattern(card: AnkiCardInfo, pattern: string): boolean {
  const fields = Object.values(card.fields).map((field) => field.value).join('\n');
  return fields.includes(pattern);
}

/** Strip AnkiConnect HTML from a rendered card side. */
function stripHtml(value: string | undefined): string {
  return (value ?? '').replace(/<[^>]*>/g, '');
}

/**
 * Which side of the card presents `pattern`, when the template sides are
 * distinguishable.
 *
 * - 'template' source: AnkiConnect `question`/`answer` HTML — the prompt is
 *   exactly what the learner saw, so the attribution is trustworthy.
 * - 'fields' source: only raw note fields are available (no rendered sides).
 *   Field ORDER says nothing about the template layout for arbitrary decks, so
 *   an answer-only hit here is directionally unverifiable.
 */
function patternCardSide(card: AnkiCardInfo, pattern: string): { side: 'question' | 'answer' | 'both' | 'unknown'; source: 'template' | 'fields' } {
  const question = stripHtml(card.question);
  const answer = stripHtml(card.answer);
  if (question !== '' || answer !== '') {
    const qHas = question.includes(pattern);
    const aHas = answer.includes(pattern);
    if (qHas && aHas) return { side: 'both', source: 'template' };
    if (qHas) return { side: 'question', source: 'template' };
    if (aHas) return { side: 'answer', source: 'template' };
    return { side: 'unknown', source: 'template' };
  }
  return { side: 'unknown', source: 'fields' };
}

/**
 * Template-derived capability for a grammar review:
 * - Pattern on the prompt (question) side → the learner saw the pattern →
 *   recognition.
 * - Pattern on the answer side only, prompt verified non-blank and pattern-free
 *   → the card asked the learner to produce the pattern → grammar-production.
 * - Anything less (rendered sides unavailable, or prompt blank) → recognition;
 *   the caller records the pattern as template-ambiguous.
 */
function capabilityForCard(
  card: AnkiCardInfo,
  pattern: string,
): { capability: GrammarCapability; ambiguous: boolean } {
  const { side, source } = patternCardSide(card, pattern);
  if (side === 'answer' && source === 'template' && stripHtml(card.question) !== '') {
    return { capability: 'grammar-production', ambiguous: false };
  }
  return { capability: 'grammar-recognition', ambiguous: side === 'answer' || side === 'unknown' };
}

export interface GrammarAnkiMapping {
  /** Events to persist, keyed by capability-scoped evidence key. */
  events: Array<{ key: string; event: KnowledgeEvent }>;
  /**
   * Patterns whose review stayed recognition even though the card layout was
   * production-like (pattern on the answer side only) but template direction
   * could not be verified. Reported, never silently dropped.
   */
  ambiguousProduction: string[];
}

/**
 * Maps an Anki card's reviews to capability-scoped grammar evidence.
 *
 * The card template decides the capability: a prompt that displays the pattern
 * is recognition; only a card whose verified prompt side lacks the pattern and
 * whose answer requires it maps to grammar-production. Anything unverifiable
 * stays recognition and is reported in `ambiguousProduction`. A review button
 * alone never upgrades a capability.
 *
 * Idempotent per (capability target, ankiReviewId): re-runs skip reviews whose
 * id is already stored for that target key.
 */
export function mapAnkiGrammarReviews(params: {
  language: string;
  grammar: readonly GrammarPoint[];
  card: AnkiCardInfo;
  reviews: readonly AnkiReviewEntry[];
  existingReviewIdsByTarget: ReadonlyMap<string, ReadonlySet<number>>;
}): GrammarAnkiMapping {
  const events: GrammarAnkiMapping['events'] = [];
  const ambiguousProduction: string[] = [];
  for (const point of params.grammar) {
    if (!point.pattern || !cardContainsPattern(params.card, point.pattern)) continue;
    const { capability, ambiguous } = capabilityForCard(params.card, point.pattern);
    const key = grammarEvidenceKey(params.language, point.pattern, capability);
    const existing = params.existingReviewIdsByTarget.get(key) ?? new Set<number>();
    for (const review of params.reviews) {
      if (review.type > 2 || existing.has(review.id)) continue;
      events.push({
        key,
        event: {
          t: review.id,
          kind: 'review',
          source: 'anki',
          aspect: 'grammar',
          targetRef: { kind: 'grammar-pattern', id: grammarTarget(params.language, point.pattern, capability).entityId, capability },
          ankiReviewId: review.id,
          schedulerCardId: String(params.card.cardId),
          rating: RATING_BY_BUTTON[review.ease],
          quality: ankiQuality(review.ease),
          timesSeenDelta: 1,
          presentedSurface: Object.values(params.card.fields).map((field) => field.value).join('\n'),
          origin: capability === 'grammar-production' ? 'anki-production-review' : 'anki-review',
        },
      });
    }
    if (ambiguous) ambiguousProduction.push(point.pattern);
  }
  return { events, ambiguousProduction };
}

/**
 * One-time backfill of Anki review history into the knowledge event store.
 * Idempotent: re-runs skip events whose ankiReviewId is already stored.
 * Keys events by the anki word's primary hash, same as the live anki status diff.
 */
export async function importAnkiReviewHistory(
  language: string,
  deps: AnkiReviewImportDeps,
): Promise<AnkiReviewImportResult> {
  const statuses = await getBackend().getAnkiWordStatuses();
  const byWord = new Map<string, number[]>();
  for (const record of statuses) {
    if (record.cardId == null) continue;
    const ids = byWord.get(record.word);
    if (ids) ids.push(record.cardId);
    else byWord.set(record.word, [record.cardId]);
  }
  if (byWord.size === 0) return { words: 0, imported: 0, skipped: 0, importedWords: [] };

  const allCardIds = [...byWord.values()].flat();
  const reviewsByCard = new Map<number, AnkiReviewEntry[]>();
  for (let i = 0; i < allCardIds.length; i += REVIEW_BATCH_SIZE) {
    const batch = allCardIds.slice(i, i + REVIEW_BATCH_SIZE);
    const result = await deps.fetchReviews(batch);
    for (const [cardId, entries] of Object.entries(result)) {
      reviewsByCard.set(Number(cardId), entries);
    }
  }

  const existing = await getEventLogForLanguage(language);
  const newEventsByKey: KnowledgeEventLog = {};
  let words = 0;
  let imported = 0;
  let skipped = 0;
  const importedWords: string[] = [];
  let ambiguousGrammar: string[] = [];

  const cardsById = new Map<number, AnkiCardInfo>();
  if (deps.fetchCards && deps.grammar?.length) {
    for (const card of await deps.fetchCards(allCardIds)) cardsById.set(card.cardId, card);
  }
  const existingGrammarIds = new Map<string, Set<number>>();
  for (const [key, events] of Object.entries(existing)) {
    if (!key.startsWith(`${language}:grammar:`)) continue;
    existingGrammarIds.set(key, new Set(events.map((event) => event.ankiReviewId).filter((id): id is number => id != null)));
  }

  for (const [word, cardIds] of byWord) {
    const key = `${language}:${hashWordSync(word)}`;
    const existingIds = new Set(
      (existing[key] ?? []).map((e) => e.ankiReviewId).filter((id): id is number => id != null),
    );
    const wordEvents: KnowledgeEvent[] = [];
    let wordImported = false;
    for (const cardId of cardIds) {
      // Factor chains are per-card in Anki — sort and chain easeBefore within one
      // card only, then merge across the word's cards.
      const entries = (reviewsByCard.get(cardId) ?? []).slice().sort((a, b) => a.id - b.id);
      let prevFactor: number | undefined;
      for (const entry of entries) {
        const event = toReviewEvent(entry, prevFactor);
        if (!event) continue;
        if (event.easeAfter != null) prevFactor = event.easeAfter;
        if (existingIds.has(entry.id)) {
          skipped++;
          continue;
        }
        wordEvents.push(event);
      }
      const card = cardsById.get(cardId);
      if (card && deps.grammar) {
        const mapped = mapAnkiGrammarReviews({ language, grammar: deps.grammar, card, reviews: entries, existingReviewIdsByTarget: existingGrammarIds });
        for (const mappedEvent of mapped.events) {
          const events = newEventsByKey[mappedEvent.key] ?? [];
          events.push(mappedEvent.event);
          newEventsByKey[mappedEvent.key] = events;
          const importedIds = existingGrammarIds.get(mappedEvent.key) ?? new Set<number>();
          importedIds.add(mappedEvent.event.ankiReviewId!);
          existingGrammarIds.set(mappedEvent.key, importedIds);
          imported++;
          wordImported = true;
        }
        if (mapped.ambiguousProduction.length > 0) {
          ambiguousGrammar = [...ambiguousGrammar, ...mapped.ambiguousProduction];
        }
      }
    }
    if (wordEvents.length === 0 && !wordImported) continue;
    if (wordEvents.length > 0) {
      wordEvents.sort((a, b) => a.t - b.t);
      newEventsByKey[key] = wordEvents;
      words++;
      imported += wordEvents.length;
    }
    importedWords.push(word);
  }

  if (imported > 0) {
    await appendEvents(newEventsByKey);
  }
  if (ambiguousGrammar.length > 0) {
    const unique = [...new Set(ambiguousGrammar)];
    log.info(`anki review import (${language}): production-like templates kept as recognition — direction unverifiable for: ${unique.join(', ')}`);
  }
  log.info(`anki review import (${language}): ${imported} events across ${words} words, ${skipped} skipped`);
  return { words, imported, skipped, importedWords };
}