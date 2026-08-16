import { ANKI_EASE, type WordStatus } from '../constants';

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
