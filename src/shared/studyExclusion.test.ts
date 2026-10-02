import { describe, expect, it } from 'vitest';
import type { IgnoredWordEntry } from './types';
import { isStudyExcluded, mergeStudyExclusion } from './studyExclusion';

const legacy: IgnoredWordEntry = { word: 'word', language: 'package', ignoredAt: 10 };
const withdrawal: IgnoredWordEntry = { ...legacy, excluded: false, updatedAt: 30 };

describe('study exclusion preferences', () => {
  it('treats absence as no policy and legacy entries as excluded', () => {
    expect(isStudyExcluded(undefined)).toBe(false);
    expect(isStudyExcluded(null)).toBe(false);
    expect(isStudyExcluded(legacy)).toBe(true);
    expect(isStudyExcluded({ ...legacy, excluded: true })).toBe(true);
    expect(isStudyExcluded(withdrawal)).toBe(false);
  });

  it('keeps a newer withdrawal regardless of an older exclusion timestamp', () => {
    const stale = { ...legacy, ignoredAt: 20 };
    expect(mergeStudyExclusion(withdrawal, stale)).toEqual(withdrawal);
    expect(mergeStudyExclusion(stale, withdrawal)).toEqual(withdrawal);
  });

  it('accepts a newer re-exclusion after a withdrawal', () => {
    const latest = { ...legacy, excluded: true, updatedAt: 40 };
    expect(mergeStudyExclusion(withdrawal, latest)).toEqual(latest);
    expect(mergeStudyExclusion(latest, withdrawal)).toEqual(latest);
  });

  it('prefers withdrawal on equal preference timestamps', () => {
    const tied = { ...legacy, ignoredAt: 30 };
    expect(mergeStudyExclusion(tied, withdrawal)).toEqual(withdrawal);
    expect(mergeStudyExclusion(withdrawal, tied)).toEqual(withdrawal);
  });

  it('converges equal-status metadata deterministically without stripping or mutating it', () => {
    const first = { ...withdrawal, reading: 'a', extension: { future: ['opaque', 1] } };
    const second = { extension: { future: ['opaque', 2] }, reading: 'z', ...withdrawal };
    const before = JSON.stringify([first, second]);
    const merged = mergeStudyExclusion(first, second);
    expect(merged).toEqual(mergeStudyExclusion(second, first));
    expect(merged).toMatchObject({ reading: 'z', extension: { future: ['opaque', 2] } });
    expect(JSON.stringify([first, second])).toBe(before);
  });

  it('retains a complete incoming legacy record when no current preference exists', () => {
    expect(mergeStudyExclusion(undefined, legacy)).toEqual(legacy);
  });
});
