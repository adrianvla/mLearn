import { describe, it, expect } from 'vitest';
import {
  isCapturedWordEligible,
  isCapturedWordIneligible,
  resolveCapturedWordEligibility,
  type CapturedWordFacts,
} from './wordCaptureEligibility';

const facts = (over: Partial<CapturedWordFacts> = {}): CapturedWordFacts => ({
  word: '将来',
  language: 'ja',
  hasCard: false,
  excluded: false,
  ...over,
});

describe('isCapturedWordEligible', () => {
  it('permits a word that is neither a card nor excluded', () => {
    expect(isCapturedWordEligible(facts())).toEqual({ eligible: true, reason: null });
  });

  it('refuses a word that already has a card, and says so', () => {
    expect(isCapturedWordEligible(facts({ hasCard: true }))).toEqual({
      eligible: false,
      reason: 'already-a-card',
    });
  });

  it('refuses an excluded word, and says so', () => {
    expect(isCapturedWordEligible(facts({ excluded: true }))).toEqual({
      eligible: false,
      reason: 'excluded',
    });
  });

  /**
   * A word can be both. The reason has to be one the surface can act on, and
   * "you already have this" is the fact the learner can see; exclusion is the
   * policy that made the duplicate possible.
   */
  it('reports the card rather than the exclusion when a word is both', () => {
    expect(isCapturedWordEligible(facts({ hasCard: true, excluded: true })).reason)
      .toBe('already-a-card');
  });

  /**
   * Knowledge is deliberately not part of this rule. The surfaces filter
   * settled words out of the list separately; conflating the two here would
   * make "known but uncaptured" uncapturable, which is a different product
   * decision than the one this owner was written to make.
   */
  it('does not treat a known word as ineligible on its own', () => {
    expect(isCapturedWordEligible(facts()).eligible).toBe(true);
  });
});

describe('isCapturedWordIneligible', () => {
  it('is the inverse, for use as a bulkAddWords skip', () => {
    expect(isCapturedWordIneligible(facts())).toBe(false);
    expect(isCapturedWordIneligible(facts({ hasCard: true }))).toBe(true);
    expect(isCapturedWordIneligible(facts({ excluded: true }))).toBe(true);
  });
});

describe('resolveCapturedWordEligibility', () => {
  it('applies the same rule to facts read from the store', () => {
    expect(resolveCapturedWordEligibility('将来', 'ja', false, false).eligible).toBe(true);
    expect(resolveCapturedWordEligibility('将来', 'ja', true, false).reason).toBe('already-a-card');
    expect(resolveCapturedWordEligibility('将来', 'ja', false, true).reason).toBe('excluded');
  });
});
