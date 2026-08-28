import { describe, expect, it } from 'vitest';
import { getColoredProsodyFadeStrength } from './coloredProsody';

describe('getColoredProsodyFadeStrength', () => {
  it('fades strong direct prosody evidence', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'known', ease: 2.5 },
    )).toBe(1);
  });

  it('fades partial mastery to the learning anchor', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'learning', ease: 1.55 },
    )).toBe(0.5);
  });

  it('keeps an unmeasured prosody target fully colored', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'unknown', ease: 0, untracked: true },
    )).toBe(0);
  });

  it('never fades an untracked target (prediction is not demonstrated mastery; the surface cannot distinguish predicted from unmeasured)', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'unknown', ease: 0, untracked: true },
    )).toBe(0);
  });

  it('does not treat an excluded target as known prosody evidence', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'known', ease: 2.5, excluded: true },
    )).toBe(0);
  });

  it('fades by the aspect-specific effective state, never the stored word ease', () => {
    // Claim records seed their ease from the WORD entry (FlashcardContext claim
    // path). A claim-known prosody on a low-ease word must still fade fully,
    // and a claim-learning prosody on a high-ease word must only reach the
    // learning anchor — the word's ease must not leak into the scaffold.
    expect(getColoredProsodyFadeStrength(
      { status: 'known', ease: 1.3 },
    )).toBe(1);
    expect(getColoredProsodyFadeStrength(
      { status: 'learning', ease: 2.5 },
    )).toBe(0.5);
  });
});