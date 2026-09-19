import { grammarEntityId } from '../graph/load';
import type { CapabilityKind, LearnableTarget } from '../graph/types';
import { stripRetractions, type AttemptId, type KnowledgeEvent } from '../knowledgeEvents';
import { applyGrammarEncounter, applyGrammarFailure, initialGrammarEase } from '../utils/grammarPolicy';

export type GrammarCapability = Extract<CapabilityKind,
  'grammar-recognition' | 'grammar-comprehension' | 'grammar-formation' | 'grammar-production'>;

export const GRAMMAR_CAPABILITIES: readonly GrammarCapability[] = [
  'grammar-recognition',
  'grammar-comprehension',
  'grammar-formation',
  'grammar-production',
];

export interface GrammarProjection {
  ease: number;
  timesEncountered: number;
  timesFailed: number;
  firstSeen: number;
  lastSeen: number;
  /**
   * True when the replay contained measured evidence: an explicit outcome
   * (rating / easeAfter — ratings, anki imports, legacy rollups) or a
   * failure rollup (`grammarFailedDelta > 0`). Pure encounter rollups are
   * passive familiarity: consumers must treat `hasActiveEvidence: false`
   * as unmeasured, never classify the ease.
   */
  hasActiveEvidence: boolean;
}

export function grammarTarget(language: string, pattern: string, capability: GrammarCapability): LearnableTarget {
  return { entityId: grammarEntityId(language, pattern), capability };
}

/** Journal keys are capability-scoped, so contrast and task type never transfer mastery. */
export function grammarEvidenceKey(language: string, pattern: string, capability: GrammarCapability): string {
  return `${language}:grammar:${grammarTarget(language, pattern, capability).entityId}:${capability}`;
}

export function grammarRecognitionEvidence(
  language: string,
  pattern: string,
  event: Omit<KnowledgeEvent, 'source' | 'aspect' | 'targetRef'> & { attemptId?: AttemptId },
): KnowledgeEvent {
  return {
    ...event,
    source: 'grammar',
    aspect: 'grammar',
    targetRef: { kind: 'grammar-pattern', id: grammarEntityId(language, pattern), capability: 'grammar-recognition' },
  };
}

/** Materialized recognition read-model, replayed from capability-specific evidence. */
export function replayGrammarRecognition(events: readonly KnowledgeEvent[]): GrammarProjection | null {
  const active = stripRetractions(events).sort((a, b) => a.t - b.t);
  if (active.length === 0) return null;

  let ease: number | undefined;
  let timesEncountered = 0;
  let timesFailed = 0;
  let hasActiveEvidence = false;
  // Items already attempted earlier in this replay (same id+content version),
  // in attempt order (G02 repeated-item familiarity).
  const attemptedItems = new Set<string>();
  for (const event of active) {
    timesEncountered += event.timesSeenDelta ?? 0;
    timesFailed += event.grammarFailedDelta ?? 0;
    // Active measurement: interactive ratings, anki imports, legacy
    // migration rollups with an explicit ease outcome, and failure rollups
    // (interactive/media task failure is measured, unlike pure exposure).
    if (event.kind === 'rating' || event.easeAfter !== undefined || (event.grammarFailedDelta ?? 0) > 0) {
      hasActiveEvidence = true;
    }
    const itemKey = event.itemRef !== undefined ? `${event.itemRef.id}\u0000${event.itemRef.version}` : null;
    if (event.easeAfter !== undefined) {
      // Repeated-item familiarity (G02): a SUCCESS on an item already
      // attempted earlier in this replay is not fresh contextual
      // generalization — it demonstrates recognition of a memorized item.
      // The observation stays measured and in the journal, but it never
      // raises the projection. Failures keep their full force: repeated
      // confusion on the same item is still failure evidence.
      const repeatSuccess = itemKey !== null && attemptedItems.has(itemKey);
      if (itemKey !== null) attemptedItems.add(itemKey);
      if (!repeatSuccess) {
        // Explicit recorded outcome wins (Anki ratings, legacy migration rollups).
        ease = event.easeAfter;
      }
      continue;
    }
    if (itemKey !== null) attemptedItems.add(itemKey);
    // Observation rows (encounter/failure deltas only) move ease along the
    // grammarPolicy anchors, seeded at the initial ease — identical to the
    // arithmetic the legacy in-place tracker applied.
    const encounters = event.timesSeenDelta ?? 0;
    const failures = event.grammarFailedDelta ?? 0;
    if (encounters === 0 && failures === 0) continue;
    let next = ease ?? initialGrammarEase();
    for (let i = 0; i < encounters; i++) next = applyGrammarEncounter(next);
    for (let i = 0; i < failures; i++) next = applyGrammarFailure(next);
    ease = next;
  }
  if (ease === undefined) return null;
  return { ease, timesEncountered, timesFailed, firstSeen: active[0].t, lastSeen: active[active.length - 1].t, hasActiveEvidence };
}
