import { describe, expect, it } from 'vitest';
import type { MediaStatsGrammarEntry } from '../../shared/types';
import { GRAMMAR_EXPOSURE_MAX_PATTERNS, GRAMMAR_EXPOSURE_MIN_ENCOUNTERS, buildGrammarExposure } from './grammarExposure';

function mediaGrammar(entries: Record<string, { ease?: number; timesFailed?: number }>): Record<string, MediaStatsGrammarEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([pattern, rest]) => [pattern, { pattern, ease: rest.ease ?? 2.5, timesFailed: rest.timesFailed ?? 0 }]),
  );
}

describe('buildGrammarExposure', () => {
  it('keeps only patterns with at least the exposure floor and zero failures', () => {
    const exposure = buildGrammarExposure(
      mediaGrammar({ 'counted-3x': {}, 'too-fresh': {}, 'media-failed': { timesFailed: 1 } }),
      (pattern) => (
        pattern === 'counted-3x' ? { timesEncountered: 3, timesFailed: 0 }
          : pattern === 'too-fresh' ? { timesEncountered: GRAMMAR_EXPOSURE_MIN_ENCOUNTERS - 1, timesFailed: 0 }
            : { timesEncountered: 9, timesFailed: 2 }
      ),
    );

    expect(exposure).toEqual([{ pattern: 'counted-3x', timesEncountered: 3 }]);
  });

  it('excludes patterns whose canonical knowledge records a failure even when the media entry did not', () => {
    const exposure = buildGrammarExposure(
      mediaGrammar({ 'seen-often-failed-elsewhere': {} }),
      () => ({ timesEncountered: 7, timesFailed: 1 }),
    );

    expect(exposure).toEqual([]);
  });

  it('ranks by timesEncountered descending', () => {
    const exposure = buildGrammarExposure(
      mediaGrammar({ 'less-seen': {}, 'most-seen': {}, 'middle-seen': {} }),
      (pattern) => ({
        timesEncountered: pattern === 'most-seen' ? 12 : pattern === 'middle-seen' ? 5 : 4,
        timesFailed: 0,
      }),
    );
  });

  it('caps the list at the maximum pattern count', () => {
    const count = GRAMMAR_EXPOSURE_MAX_PATTERNS + 5;
    const patterns = Array.from({ length: count }, (_, i) => `p${i}`);
    const exposure = buildGrammarExposure(
      mediaGrammar(Object.fromEntries(patterns.map((p) => [p, {}]))),
      (p) => ({ timesEncountered: 3 + Number(p.slice(1)), timesFailed: 0 }),
    );

    expect(exposure).toHaveLength(GRAMMAR_EXPOSURE_MAX_PATTERNS);
    expect(exposure[0]).toEqual({ pattern: `p${count - 1}`, timesEncountered: 3 + count - 1 });
  });

  it('treats unknown canonical knowledge as zero exposure', () => {
    const exposure = buildGrammarExposure(mediaGrammar({ 'never-tracked': {} }), () => undefined);

    expect(exposure).toEqual([]);
  });

  it('does not mutate the media stats snapshot', () => {
    const stats = mediaGrammar({ 'a': {}, 'b': { timesFailed: 1 } });
    const frozen = Object.freeze(stats);

    buildGrammarExposure(frozen, () => ({ timesEncountered: 5, timesFailed: 0 }));

    expect(Object.keys(frozen)).toEqual(['a', 'b']);
  });
});
