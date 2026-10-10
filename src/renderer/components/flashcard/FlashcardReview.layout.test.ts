import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/components/flashcard/FlashcardReview.css', 'utf8');

describe('FlashcardReview popover surfaces', () => {
  it('keeps review menus opaque when they overlay card content', () => {
    const rule = css.match(/\.popover-panel\.review-activities-popover,\s*\.popover-panel\.flashcard-actions-popover\s*\{([^}]*)\}/)?.[1];

    expect(rule ?? '').toMatch(/background:\s*var\(--bg-opaque\)/);
    expect(rule ?? '').toMatch(/backdrop-filter:\s*none/);
    expect(rule ?? '').toMatch(/-webkit-backdrop-filter:\s*none/);
  });
});
