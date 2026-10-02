import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/types';
import { getColoredProsodyFadeStrength, resolveColoredProsodyStyle } from './coloredProsody';

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

describe('resolveColoredProsodyStyle', () => {
  it('softens demonstrated mastery toward theme text instead of washing it out with white', () => {
    expect(resolveColoredProsodyStyle('#ffa500', DEFAULT_SETTINGS, 1, undefined)['--language-word-ink'])
      .toBe('color-mix(in srgb, color-mix(in srgb, #ffa500 18%, var(--language-word-foreground)) 40%, var(--language-word-foreground))');
    expect(resolveColoredProsodyStyle('#ffa500', DEFAULT_SETTINGS, 0.5, undefined)['--language-word-ink'])
      .toBe('color-mix(in srgb, color-mix(in srgb, #ffa500 59%, var(--language-word-foreground)) 40%, var(--language-word-foreground))');
  });

  it('preserves full cues when unmeasured or when fading is disabled', () => {
    expect(resolveColoredProsodyStyle('#ffa500', DEFAULT_SETTINGS, 0, undefined)['--language-word-ink']).toBe('color-mix(in srgb, #ffa500 40%, var(--language-word-foreground))');
    expect(resolveColoredProsodyStyle('#ffa500', {
      ...DEFAULT_SETTINGS, coloredProsodyEaseMixEnabled: false,
    }, 1, undefined)['--language-word-ink']).toBe('color-mix(in srgb, #ffa500 40%, var(--language-word-foreground))');
  });

  it('honors category coloring and falls back to theme text when the category has no color', () => {
    const settings = { ...DEFAULT_SETTINGS, coloredProsodyEaseMixTarget: 'part-of-speech' as const };
    expect(resolveColoredProsodyStyle('#ffa500', settings, 1, '#345678')['--language-word-ink'])
      .toBe('color-mix(in srgb, color-mix(in srgb, #ffa500 18%, #345678) 40%, var(--language-word-foreground))');
    expect(resolveColoredProsodyStyle('#ffa500', settings, 1, undefined)['--language-word-ink'])
      .toBe('color-mix(in srgb, color-mix(in srgb, #ffa500 18%, var(--language-word-foreground)) 40%, var(--language-word-foreground))');
  });

  it('keeps saturation and supports package colors expressed beyond hexadecimal', () => {
    expect(resolveColoredProsodyStyle('#f00', {
      ...DEFAULT_SETTINGS, coloredProsodySaturation: 0,
    }, 0, undefined)['--language-word-ink']).toBe('color-mix(in srgb, #363636 40%, var(--language-word-foreground))');
    expect(resolveColoredProsodyStyle('rgb(255, 165, 0)', DEFAULT_SETTINGS, 1, undefined)['--language-word-ink'])
      .toBe('color-mix(in srgb, color-mix(in srgb, rgb(255, 165, 0) 18%, var(--language-word-foreground)) 40%, var(--language-word-foreground))');
  });
});
