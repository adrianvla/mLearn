import { describe, expect, it } from 'vitest';
import { followsTailAfterScroll } from './messageScroll';

describe('Messenger tail following', () => {
  const bottom = { top: 600, height: 1000, viewport: 400 };
  it('keeps following when a widget expands without a user scroll', () => {
    expect(followsTailAfterScroll(true, bottom, { ...bottom, height: 1400 })).toBe(true);
  });
  it('stops following an upward history scroll and stays there during hydration', () => {
    const history = { ...bottom, top: 200 };
    expect(followsTailAfterScroll(true, bottom, history)).toBe(false);
    expect(followsTailAfterScroll(false, history, { ...history, height: 1400 })).toBe(false);
  });
  it('resumes when the user reaches the newest message', () => {
    expect(followsTailAfterScroll(false, { ...bottom, top: 200 }, bottom)).toBe(true);
  });
  it('keeps following when composer growth reduces the viewport', () => {
    expect(followsTailAfterScroll(true, bottom, { ...bottom, viewport: 200 })).toBe(true);
  });
});
