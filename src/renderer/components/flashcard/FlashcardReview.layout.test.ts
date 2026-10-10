import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/renderer/components/flashcard/FlashcardReview.css', 'utf8');

describe('FlashcardReview popover surfaces', () => {
  it('constrains activity options so the popover stays beside the centered card', () => {
    const rule = css.match(/\.popover-panel\.review-activities-popover\s*\{([^}]*)\}/)?.[1];
    const toggleRule = css.match(/\.review-activities-popover \.toggle-switch\s*\{([^}]*)\}/)?.[1];
    const labelRule = css.match(/\.review-activities-popover \.toggle-label\s*\{([^}]*)\}/)?.[1];

    expect(rule ?? '').toMatch(/display:\s*flex/);
    expect(rule ?? '').toMatch(/flex-direction:\s*column/);
    expect(rule ?? '').toMatch(/width:\s*min\(11rem,\s*calc\(100vw\s*-\s*32px\)\)/);
    expect(toggleRule ?? '').toMatch(/width:\s*100%/);
    expect(toggleRule ?? '').toMatch(/min-width:\s*0/);
    expect(labelRule ?? '').toMatch(/flex:\s*1/);
    expect(labelRule ?? '').toMatch(/min-width:\s*0/);
  });

  it('keeps review menus opaque when they overlay card content', () => {
    const rule = css.match(/\.popover-panel\.review-activities-popover,\s*\.popover-panel\.flashcard-actions-popover\s*\{([^}]*)\}/)?.[1];

    expect(rule ?? '').toMatch(/background:\s*var\(--bg-opaque\)/);
    expect(rule ?? '').toMatch(/backdrop-filter:\s*none/);
    expect(rule ?? '').toMatch(/-webkit-backdrop-filter:\s*none/);
  });
});
