import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { getColoredProsodyFadeStrength } from './coloredProsody';

describe('getColoredProsodyFadeStrength', () => {
  it('fades strong direct prosody evidence', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'known', ease: DEFAULT_SETTINGS.easeThresholdKnown },
      DEFAULT_SETTINGS,
    )).toBe(1);
  });

  it('keeps an unmeasured prosody target fully colored', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'unknown', ease: 0, untracked: true },
      DEFAULT_SETTINGS,
    )).toBe(0);
  });

  it('uses predicted accessibility only for an unmeasured prosody target', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'unknown', ease: 0, untracked: true, predictedAccessibility: 0.5 },
      DEFAULT_SETTINGS,
    )).toBe(0.5);
  });

  it('does not treat an excluded target as known prosody evidence', () => {
    expect(getColoredProsodyFadeStrength(
      { status: 'known', ease: DEFAULT_SETTINGS.easeThresholdKnown, excluded: true },
      DEFAULT_SETTINGS,
    )).toBe(0);
  });
});
