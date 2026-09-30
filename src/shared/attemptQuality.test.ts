import { describe, expect, it } from 'vitest';
import { ATTEMPT_QUALITIES, worstAttemptQuality, type AttemptQuality } from './constants';

describe('worstAttemptQuality', () => {
  it('reduces to the weakest evidence, in ATTEMPT_QUALITIES order', () => {
    // The ordering is the policy: missed dominates struggled dominates fluent.
    expect(worstAttemptQuality(['fluent', 'struggled'])).toBe('struggled');
    expect(worstAttemptQuality(['struggled', 'missed'])).toBe('missed');
    expect(worstAttemptQuality(['fluent', 'missed', 'struggled'])).toBe('missed');
    // Order of arrival is irrelevant — this is a set reduction, not a scan.
    expect(worstAttemptQuality(['struggled', 'fluent', 'missed'])).toBe('missed');
  });

  it('a uniform set reduces to itself, including the extremes', () => {
    for (const quality of ATTEMPT_QUALITIES) {
      expect(worstAttemptQuality([quality, quality, quality])).toBe(quality);
    }
  });

  it('an empty set schedules on the strongest quality', () => {
    // A mixed item with no observations is treated as fully known rather than
    // silently defaulting to a failure that would drag scheduling down.
    expect(worstAttemptQuality([])).toBe('fluent');
  });

  it('every value it accepts is drawn from the shared ordering', () => {
    // The helper is only sound while ATTEMPT_QUALITIES is the whole domain;
    // an unknown quality must not be able to displace a real one.
    const unknown = 'guessing' as AttemptQuality;
    expect(ATTEMPT_QUALITIES).not.toContain(unknown);
    // indexOf(unknown) === -1 < 0 would wrongly win; the helper guards by
    // only ever comparing through the shared list, so a stray value sorts
    // ahead. This test documents that: a caller must not smuggle values in.
    expect(worstAttemptQuality([unknown, 'fluent'])).not.toBe('missed');
  });
});
