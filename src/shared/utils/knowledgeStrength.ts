import { ANKI_EASE, SRS_EASE, type WordStatus } from '../constants';

// Anki factor and SRS ease (×1000) share the same numeric domain (1300–1800+),
// so one normalization curve serves both. Anchors come from ANKI_EASE/SRS_EASE.
const MIN_EASE: number = ANKI_EASE.MIN;
const LEARNING_THRESHOLD = ANKI_EASE.DEFAULT_LEARNING;
const KNOWN_THRESHOLD = ANKI_EASE.DEFAULT_KNOWN;

export function normalizedStrength(
  ease: number,
  learningThreshold: number,
  knownThreshold: number,
  minEase = MIN_EASE,
): number {
  if (ease <= minEase) return 0;
  if (ease >= knownThreshold) return 1;
  if (ease <= learningThreshold) {
    return ((ease - minEase) / (learningThreshold - minEase)) * 0.5;
  }
  return 0.5 + ((ease - learningThreshold) / (knownThreshold - learningThreshold)) * 0.5;
}

export function ankiFactorToStrength(factor: number): number {
  return normalizedStrength(factor, LEARNING_THRESHOLD, KNOWN_THRESHOLD);
}

export function srsEaseToStrength(ease: number): number {
  return normalizedStrength(ease * 1000, LEARNING_THRESHOLD, KNOWN_THRESHOLD);
}

export function statusToStrength(status: WordStatus): number {
  if (status === 'known') return 1;
  if (status === 'learning') return 0.5;
  return 0;
}

/**
 * Canonical status classification on the SRS ease scale — the ONE rule every
 * resolver (replay, target explanations, predictor, renderer) must agree on.
 */
export function easeToStatus(ease: number): WordStatus {
  if (ease >= SRS_EASE.DEFAULT_KNOWN) return 'known';
  if (ease > SRS_EASE.MIN) return 'learning';
  return 'unknown';
}

/** Derivable event outcome: the representative ease a status maps back to. */
export function statusToEase(status: WordStatus): number {
  if (status === 'known') return SRS_EASE.DEFAULT_KNOWN;
  if (status === 'learning') return SRS_EASE.DEFAULT_LEARNING;
  return SRS_EASE.MIN;
}

/**
 * Anki imports persist raw factors (1300–3500, ankiReviewImport contract);
 * SRS/migration/manual paths write the SRS scale directly. Replay normalizes
 * both into the one SRS-scale domain before any classification.
 */
export function normalizeEvidenceEase(source: string, ease: number): number {
  return source === 'anki' && ease >= 1000 ? ease / 1000 : ease;
}
