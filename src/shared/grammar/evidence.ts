import { grammarEntityId } from '../graph/load';
import type { CapabilityKind, LearnableTarget } from '../graph/types';
import { stripRetractions, type AttemptId, type KnowledgeEvent } from '../knowledgeEvents';

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
  for (const event of active) {
    if (event.easeAfter !== undefined) ease = event.easeAfter;
    timesEncountered += event.timesSeenDelta ?? 0;
    timesFailed += event.grammarFailedDelta ?? 0;
  }
  if (ease === undefined) return null;
  return { ease, timesEncountered, timesFailed, firstSeen: active[0].t, lastSeen: active[active.length - 1].t };
}
