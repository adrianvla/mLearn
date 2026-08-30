import type { GrammarOccurrence } from './occurrences';
import type { GrammarPoint, LanguageData, Token } from '../types';
import { detectGrammarOccurrences } from './occurrences';

/**
 * Options accepted by the FlashcardContext grammar encounter API
 * (`trackGrammarEncountered(pattern, opts?)`). Encounter events are
 * factual-exposure rollups (kind 'rollup', source 'grammar') — never ratings
 * or mastery claims.
 */
export interface GrammarEncounterOptions {
  confidence?: number;
  span?: { start: number; end: number };
  origin?: string;
}

/** Structural contract of FlashcardContext.trackGrammarEncountered. */
export interface GrammarEncounterTracker {
  trackGrammarEncountered: (pattern: string, opts?: GrammarEncounterOptions) => void;
}

/** One factual grammar exposure, ready to journal. */
export interface GrammarEncounter {
  pattern: string;
  confidence: number;
  span: { start: number; end: number };
  origin: string;
}

export interface GrammarEncounterRecorder {
  /** Returns the encounters not yet journalled for this display of `surfaceKey`. */
  record(surfaceKey: string, occurrences: readonly GrammarOccurrence[]): GrammarEncounter[];
  /** Forgets `surfaceKey` so its patterns journal again (fresh OCR pass). */
  reset(surfaceKey: string): void;
}

export interface GrammarEncounterRecorderOptions {
  /**
   * Treat surfaces as mutually exclusive: recording a different surface key
   * forgets the previous one (one subtitle line displayed at a time).
   * Disable when several surfaces are displayed concurrently (reader pages).
   */
  exclusive?: boolean;
}

const MAX_TRACKED_SURFACES = 64;

/**
 * Collapses repeated detections of the same pattern within one surface display
 * (subtitle line, reader page, OCR pass) into a single encounter so rapid
 * re-detection cannot flood the evidence journal. Detections are ephemeral;
 * only what `record` returns should be journaled.
 */
export function createGrammarEncounterRecorder(origin: string, options?: GrammarEncounterRecorderOptions): GrammarEncounterRecorder {
  const exclusive = options?.exclusive ?? true;
  const patternsBySurface = new Map<string, Set<string>>();
  // Exclusive mode retains the current and immediately previous surface only:
  // subtitle flapping (A→B→A) re-uses the retained set instead of re-journaling,
  // while a genuinely later display (A→B→C→A) counts again.
  let active: { key: string; set: Set<string> } | undefined;
  let retired: { key: string; set: Set<string> } | undefined;
  const patternsFor = (surfaceKey: string): Set<string> => {
    if (active?.key === surfaceKey) return active.set;
    if (retired?.key === surfaceKey) {
      const swap = active;
      active = retired;
      retired = swap;
      return active.set;
    }
    const existing = patternsBySurface.get(surfaceKey);
    if (existing) return existing;
    const fresh = new Set<string>();
    if (exclusive) {
      retired = active;
      active = { key: surfaceKey, set: fresh };
      return fresh;
    }
    patternsBySurface.set(surfaceKey, fresh);
    if (patternsBySurface.size > MAX_TRACKED_SURFACES) {
      const oldest = patternsBySurface.keys().next();
      if (!oldest.done) patternsBySurface.delete(oldest.value);
    }
    return fresh;
  };
  return {
    record(surfaceKey, occurrences) {
      const recorded = patternsFor(surfaceKey);
      const encounters: GrammarEncounter[] = [];
      for (const item of occurrences) {
        if (recorded.has(item.patternId)) continue;
        recorded.add(item.patternId);
        encounters.push({
          pattern: item.patternId,
          confidence: item.confidence,
          span: { start: item.sentenceSpan.start, end: item.sentenceSpan.end },
          origin: `${origin}:${item.provenance}`,
        });
      }
      return encounters;
    },
    reset(surfaceKey) {
      patternsBySurface.delete(surfaceKey);
      if (active?.key === surfaceKey) active = undefined;
      if (retired?.key === surfaceKey) retired = undefined;
    },
  };
}

/**
 * Journals new grammar encounters as factual-exposure rollups. Detection is
 * ephemeral; persistence happens only through this rollup path — never as
 * ratings, claims, or recognition ease.
 */
export function journalGrammarEncounters(
  tracker: GrammarEncounterTracker,
  recorder: GrammarEncounterRecorder,
  surfaceKey: string,
  occurrences: readonly GrammarOccurrence[],
): GrammarEncounter[] {
  const encounters = recorder.record(surfaceKey, occurrences);
  for (const encounter of encounters) {
    tracker.trackGrammarEncountered(encounter.pattern, {
      confidence: encounter.confidence,
      span: encounter.span,
      origin: encounter.origin,
    });
  }
  return encounters;
}

/** Detects over paragraph/box token groups (reader pages, OCR results) and journals the new encounters. */
export function journalGrammarEncountersForTokenGroups(
  tracker: GrammarEncounterTracker,
  recorder: GrammarEncounterRecorder,
  surfaceKey: string,
  tokenGroups: readonly (readonly Token[])[],
  params: {
    language: string;
    grammar: readonly GrammarPoint[];
    languageData?: LanguageData | null;
  },
): GrammarEncounter[] {
  const occurrences = tokenGroups.flatMap((tokens) => detectGrammarOccurrences({ ...params, tokens }));
  return journalGrammarEncounters(tracker, recorder, surfaceKey, occurrences);
}
