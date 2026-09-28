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

/** Ordered, active rows can be folded without retaining the full journal. */
export function createGrammarRecognitionFold() {
  let ease: number | undefined;
  let timesEncountered = 0;
  let timesFailed = 0;
  let hasActiveEvidence = false;
  let firstSeen: number | undefined;
  let lastSeen: number | undefined;
  const attemptedItems = new Set<string>();

  return {
    push(event: KnowledgeEvent): void {
      if (firstSeen === undefined) firstSeen = event.t;
      lastSeen = event.t;
      timesEncountered += event.timesSeenDelta ?? 0;
      timesFailed += event.grammarFailedDelta ?? 0;
      if (event.kind === 'rating' || event.easeAfter !== undefined || (event.grammarFailedDelta ?? 0) > 0) {
        hasActiveEvidence = true;
      }
      const itemKey = event.itemRef !== undefined ? `${event.itemRef.id}\u0000${event.itemRef.version}` : null;
      if (event.easeAfter !== undefined) {
        const repeatSuccess = itemKey !== null && attemptedItems.has(itemKey);
        if (itemKey !== null) attemptedItems.add(itemKey);
        if (!repeatSuccess) ease = event.easeAfter;
        return;
      }
      if (itemKey !== null) attemptedItems.add(itemKey);
      const encounters = event.timesSeenDelta ?? 0;
      const failures = event.grammarFailedDelta ?? 0;
      if (encounters === 0 && failures === 0) return;
      let next = ease ?? initialGrammarEase();
      for (let i = 0; i < encounters; i++) next = applyGrammarEncounter(next);
      for (let i = 0; i < failures; i++) next = applyGrammarFailure(next);
      ease = next;
    },
    finish(): GrammarProjection | null {
      if (ease === undefined || firstSeen === undefined || lastSeen === undefined) return null;
      return { ease, timesEncountered, timesFailed, firstSeen, lastSeen, hasActiveEvidence };
    },
  };
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
  const fold = createGrammarRecognitionFold();
  for (const event of active) fold.push(event);
  return fold.finish();
}
