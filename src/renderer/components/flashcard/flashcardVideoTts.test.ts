/**
 * Tests for flashcard video + TTS interaction rules:
 * - Cards with videoUrl should skip example TTS
 * - Cards with skipExampleTts should skip example TTS
 * - Cards without video should play example TTS normally
 */

import { describe, it, expect } from 'vitest';
import type { FlashcardContent } from '../../../shared/types';

/**
 * Pure logic extracted from the auto-TTS effect in FlashcardReview.
 * Returns true if example TTS should play, false if it should be skipped.
 */
function shouldPlayExampleTts(content: FlashcardContent, flashcardAutoTts: boolean): boolean {
  if (!flashcardAutoTts) return false;
  if (!content.example || content.example === '-') return false;
  if (content.videoUrl || content.skipExampleTts) return false;
  return true;
}

describe('shouldPlayExampleTts', () => {
  const baseContent: FlashcardContent = {
    type: 'word',
    front: 'test',
    back: 'meaning',
    example: '<span>example sentence</span>',
  };

  it('returns true for normal card with example and autoTts enabled', () => {
    expect(shouldPlayExampleTts(baseContent, true)).toBe(true);
  });

  it('returns false when autoTts is disabled', () => {
    expect(shouldPlayExampleTts(baseContent, false)).toBe(false);
  });

  it('returns false when example is empty', () => {
    expect(shouldPlayExampleTts({ ...baseContent, example: '' }, true)).toBe(false);
  });

  it('returns false when example is dash placeholder', () => {
    expect(shouldPlayExampleTts({ ...baseContent, example: '-' }, true)).toBe(false);
  });

  it('returns false when card has videoUrl', () => {
    const content = { ...baseContent, videoUrl: 'flashcard-video://abc.mp4' };
    expect(shouldPlayExampleTts(content, true)).toBe(false);
  });

  it('returns false when skipExampleTts is true', () => {
    const content = { ...baseContent, skipExampleTts: true };
    expect(shouldPlayExampleTts(content, true)).toBe(false);
  });

  it('returns false when both videoUrl and skipExampleTts are set', () => {
    const content = { ...baseContent, videoUrl: 'flashcard-video://abc.mp4', skipExampleTts: true };
    expect(shouldPlayExampleTts(content, true)).toBe(false);
  });

  it('returns true when videoUrl is empty string', () => {
    const content = { ...baseContent, videoUrl: '' };
    expect(shouldPlayExampleTts(content, true)).toBe(true);
  });

  it('returns true when skipExampleTts is false', () => {
    const content = { ...baseContent, skipExampleTts: false };
    expect(shouldPlayExampleTts(content, true)).toBe(true);
  });

  it('returns false when example is undefined', () => {
    const content = { ...baseContent, example: undefined };
    expect(shouldPlayExampleTts(content, true)).toBe(false);
  });
});
