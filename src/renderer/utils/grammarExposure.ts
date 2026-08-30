import type { MediaStatsGrammarEntry } from '../../shared/types';

/**
 * Exposure floor for tutor-context grammar candidates. Mirrors the default
 * `minEncounters` of grammarEncounterCandidates (same floor semantics, applied
 * at the tutor-context layer rather than the teaching-policy layer).
 */
export const GRAMMAR_EXPOSURE_MIN_ENCOUNTERS = 3;

/** Upper bound on exposure-ranked patterns offered to the tutor prompt. */
export const GRAMMAR_EXPOSURE_MAX_PATTERNS = 10;

export interface GrammarExposureEntry {
  pattern: string;
  timesEncountered: number;
}

/** Resolves a pattern's canonical passive-encounter knowledge (timesEncountered / timesFailed). */
export type GrammarKnowledgeResolver = (pattern: string) => { timesEncountered: number; timesFailed: number } | undefined;

/**
 * REQ39 reverse loop, tutor-context layer: grammar patterns seen in this media
 * that were repeatedly encountered but never failed are exposure-ranked
 * practice candidates. Pure selector over the caller-supplied snapshot — never
 * writes knowledge. These are prediction/exposure signals, NOT demonstrated
 * failures; a pattern with any failure (media-local or canonical) is excluded
 * so it stays only in the failed-grammar path.
 */
export function buildGrammarExposure(
  mediaGrammar: Record<string, MediaStatsGrammarEntry>,
  resolveKnowledge: GrammarKnowledgeResolver,
): GrammarExposureEntry[] {
  return Object.values(mediaGrammar)
    .map((entry) => {
      const knowledge = resolveKnowledge(entry.pattern);
      return {
        pattern: entry.pattern,
        timesEncountered: knowledge?.timesEncountered ?? 0,
        failed: entry.timesFailed > 0 || (knowledge?.timesFailed ?? 0) > 0,
      };
    })
    .filter((entry) => !entry.failed && entry.timesEncountered >= GRAMMAR_EXPOSURE_MIN_ENCOUNTERS)
    .sort((a, b) => b.timesEncountered - a.timesEncountered)
    .slice(0, GRAMMAR_EXPOSURE_MAX_PATTERNS)
    .map(({ pattern, timesEncountered }) => ({ pattern, timesEncountered }));
}
