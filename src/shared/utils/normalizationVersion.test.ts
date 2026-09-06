import { describe, expect, it } from 'vitest';
import { CURRENT_NORMALIZATION_VERSION, legacyCasingCandidates, resolveNormalizationVersion } from './normalizationVersion';

describe('normalization version + legacy casing salvage', () => {
  it('enumerates legacy host-locale casing variants for Turkic-sensitive words', () => {
    // Historical ambient lowercasing on a tr/az host produced 'ızmir' for 'Izmir';
    // root-locale ('und') produces 'izmir'. Both legacy candidates are enumerated
    // deterministically from the raw word.
    const candidates = legacyCasingCandidates('Izmir');
    expect(candidates).toContain('izmir');
    expect(candidates).toContain('ızmir');
  });

  it('deduplicates when all locales agree', () => {
    const candidates = legacyCasingCandidates('Haus');
    expect(candidates).toEqual(['haus']);
  });

  it('versions normalization so rebuilds never depend on the historical host locale', () => {
    expect(CURRENT_NORMALIZATION_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('salvage keys are deterministic and include the current form first', () => {
    // D4 contract: candidate-derived keys probe legacy variants only after the
    // current-version key; raw word is the sole source of truth.
    const word = 'Izmir';
    const current = word.toLocaleLowerCase('und');
    expect(current).toBe('izmir');
    const probes = legacyCasingCandidates(word);
    expect(probes[0]).toBe('izmir');
    expect(probes).toContain('ızmir');
  });
});

describe('normalization version stamp policy', () => {
  it('absent stamp adopts the current version', () => {
    expect(resolveNormalizationVersion(undefined)).toBe(CURRENT_NORMALIZATION_VERSION);
  });

  it('legacy stamps adopt the current version', () => {
    expect(resolveNormalizationVersion(1)).toBe(CURRENT_NORMALIZATION_VERSION);
  });

  it('preserves a future store version instead of downgrading it', () => {
    expect(resolveNormalizationVersion(CURRENT_NORMALIZATION_VERSION + 1)).toBe(CURRENT_NORMALIZATION_VERSION + 1);
  });
});
