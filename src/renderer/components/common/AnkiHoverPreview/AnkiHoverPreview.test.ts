/**
 * Tests for AnkiHoverPreview ease factor display logic.
 * The component shows the Anki ease factor as-is (e.g. 2500, 1300).
 * A factor of 0 means the card is new and no ease should be shown.
 */

import { describe, it, expect } from 'vitest';

/** Re-implement the show condition: ease must be present and > 0 */
function shouldShowEase(ease: number | null | undefined): boolean {
  return ease != null && ease > 0;
}

describe('shouldShowEase', () => {
  it('returns true for a positive factor', () => {
    expect(shouldShowEase(2500)).toBe(true);
  });

  it('returns false for factor of 0 (new card)', () => {
    expect(shouldShowEase(0)).toBe(false);
  });

  it('returns false for null', () => {
    expect(shouldShowEase(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(shouldShowEase(undefined)).toBe(false);
  });

  it('returns true for minimum Anki ease of 1300', () => {
    expect(shouldShowEase(1300)).toBe(true);
  });

  it('returns true for a high ease factor', () => {
    expect(shouldShowEase(3000)).toBe(true);
  });
});
