import { SRS_EASE } from '../constants';
import type { WordStatus } from '../constants';

/**
 * Grammar exposure/failure policy. Grammar encounters are observations, not
 * attempts: small familiarity bumps on exposure, explicit penalties on
 * demonstrated failure, classified with the SAME anchors as word projection.
 * These constants replace the inline arithmetic that used to live in
 * FlashcardContext's grammar trackers.
 */
export const GRAMMAR_ENCOUNTER_EASE_BUMP = 0.01;
export const GRAMMAR_FAIL_EASE_PENALTY = 0.15;
/** Failure floor matches the historical tracker behavior (ease can reach 0). */
export const GRAMMAR_FAIL_EASE_FLOOR = 0;
export const GRAMMAR_EASE_MAX = 5;

export interface GrammarClassificationThresholds {
  learning: number;
  known: number;
}

export function classifyGrammarStatus(ease: number, thresholds: GrammarClassificationThresholds): WordStatus {
  if (ease >= thresholds.known) return 'known';
  if (ease >= thresholds.learning) return 'learning';
  return 'unknown';
}

export function applyGrammarEncounter(ease: number): number {
  return Math.min(GRAMMAR_EASE_MAX, ease + GRAMMAR_ENCOUNTER_EASE_BUMP);
}

export function applyGrammarFailure(ease: number): number {
  return Math.max(GRAMMAR_FAIL_EASE_FLOOR, ease - GRAMMAR_FAIL_EASE_PENALTY);
}

export function initialGrammarEase(): number {
  return SRS_EASE.MIN;
}
