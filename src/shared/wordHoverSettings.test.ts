import { describe, expect, it } from 'vitest';
import { wordHoverSizePercent, wordHoverScale } from './wordHoverSettings';

describe('shared word popup sizing', () => {
  it.each([
    [undefined, 100, 1], [NaN, 100, 1], [Infinity, 100, 1],
    [0, 60, 0.6], [50, 60, 0.6], [75, 75, 0.75], [140, 140, 1.4], [999, 140, 1.4],
  ])('keeps persisted size %s readable and bounded', (value, percent, scale) => {
    expect(wordHoverSizePercent({ wordHoverSizePercent: value })).toBe(percent);
    expect(wordHoverScale({ wordHoverSizePercent: value })).toBe(scale);
  });
});
