import { getBackend } from '../../shared/backends';
import { getLogger } from '../../shared/utils/logger';
import type { KnowledgeEvent, KnowledgeEventLog, Rating } from '../../shared/knowledgeEvents';
import type { AnkiReviewEntry } from '../hooks/useAnki';
import type { AnkiCardInfo } from '../hooks/useAnki';
import { appendEvents, getEventLogForLanguage } from './knowledgeEvents';
import { hashWordSync } from './srsAlgorithm';
import { grammarEvidenceKey, grammarTarget } from '../../shared/grammar/evidence';
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

/**
 * An Anki prompt containing a known pattern is recognition evidence only. This
 * deliberately never infers formation or production from a review button.
 */
export function mapAnkiGrammarReviews(params: {
  language: string;
  grammar: readonly GrammarPoint[];
  card: AnkiCardInfo;
  reviews: readonly AnkiReviewEntry[];
  existingReviewIdsByTarget: ReadonlyMap<string, ReadonlySet<number>>;
}): Array<{ key: string; event: KnowledgeEvent }> {
  const mapped: Array<{ key: string; event: KnowledgeEvent }> = [];
  for (const point of params.grammar) {
    if (!point.pattern || !cardContainsPattern(params.card, point.pattern)) continue;
    const key = grammarEvidenceKey(params.language, point.pattern, 'grammar-recognition');
    const existing = params.existingReviewIdsByTarget.get(key) ?? new Set<number>();
    for (const review of params.reviews) {
      if (review.type > 2 || existing.has(review.id)) continue;
      mapped.push({
        key,
        event: {
          t: review.id,
          kind: 'review',
          source: 'anki',
          aspect: 'grammar',
          targetRef: { kind: 'grammar-pattern', id: grammarTarget(params.language, point.pattern, 'grammar-recognition').entityId, capability: 'grammar-recognition' },
          ankiReviewId: review.id,
          schedulerCardId: String(params.card.cardId),
          rating: RATING_BY_BUTTON[review.ease],
          quality: ankiQuality(review.ease),
          timesSeenDelta: 1,
          presentedSurface: Object.values(params.card.fields).map((field) => field.value).join('\n'),
          origin: 'anki-review',
        },
      });
    }
  }
  return mapped;
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
  if (byWord.size === 0) return { words: 0, imported: 0, skipped: 0 };

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
        for (const mapped of mapAnkiGrammarReviews({ language, grammar: deps.grammar, card, reviews: entries, existingReviewIdsByTarget: existingGrammarIds })) {
          const events = newEventsByKey[mapped.key] ?? [];
          events.push(mapped.event);
          newEventsByKey[mapped.key] = events;
          const importedIds = existingGrammarIds.get(mapped.key) ?? new Set<number>();
          importedIds.add(mapped.event.ankiReviewId!);
          existingGrammarIds.set(mapped.key, importedIds);
          imported++;
        }
      }
    }
    if (wordEvents.length === 0) continue;
    wordEvents.sort((a, b) => a.t - b.t);
    newEventsByKey[key] = wordEvents;
    words++;
    imported += wordEvents.length;
  }

  if (imported > 0) {
    await appendEvents(newEventsByKey);
  }
  log.info(`anki review import (${language}): ${imported} events across ${words} words, ${skipped} skipped`);
  return { words, imported, skipped };
}
