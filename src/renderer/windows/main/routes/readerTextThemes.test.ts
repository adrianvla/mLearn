import { describe, expect, it } from 'vitest';
import {
  READER_TEXT_THEME_IDS,
  readerTextThemeClass,
  stepReaderTextSize,
} from './readerTextThemes';

describe('READER_TEXT_THEME_IDS', () => {
  it('has 6 unique preset ids', () => {
    expect(READER_TEXT_THEME_IDS).toHaveLength(6);
    expect(new Set(READER_TEXT_THEME_IDS).size).toBe(READER_TEXT_THEME_IDS.length);
  });

  it('lists original first', () => {
    expect(READER_TEXT_THEME_IDS[0]).toBe('original');
  });

  it('contains the expected preset ids', () => {
    expect(READER_TEXT_THEME_IDS).toEqual([
      'original',
      'paper',
      'calm',
      'quiet',
      'night',
      'focus',
    ]);
  });
});

describe('readerTextThemeClass', () => {
  it('maps a known theme id to its class', () => {
    expect(readerTextThemeClass('paper')).toBe('reader-text-theme-paper');
    expect(readerTextThemeClass('night')).toBe('reader-text-theme-night');
    expect(readerTextThemeClass('focus')).toBe('reader-text-theme-focus');
  });

  it('falls back to original for unknown ids', () => {
    expect(readerTextThemeClass('rainbow')).toBe('reader-text-theme-original');
    expect(readerTextThemeClass('')).toBe('reader-text-theme-original');
  });

  it('falls back to original for undefined', () => {
    expect(readerTextThemeClass(undefined)).toBe('reader-text-theme-original');
  });
});

describe('stepReaderTextSize', () => {
  it('increments by the delta and rounds to 2 decimals (float safety)', () => {
    expect(stepReaderTextSize(1.05, 0.05)).toBe(1.1);
    expect(stepReaderTextSize(1.05, 0.05 * 3)).toBe(1.2);
    expect(stepReaderTextSize(1.0, 0.05 * 7)).toBe(1.35);
  });

  it('decrements by the delta', () => {
    expect(stepReaderTextSize(1.05, -0.05)).toBe(1.0);
    expect(stepReaderTextSize(1.1, -0.05 * 2)).toBe(1.0);
  });

  it('clamps at the 1.6 maximum', () => {
    expect(stepReaderTextSize(1.6, 0.05)).toBe(1.6);
    expect(stepReaderTextSize(1.58, 0.05)).toBe(1.6);
    expect(stepReaderTextSize(2.0, 0.05)).toBe(1.6);
  });

  it('clamps at the 0.8 minimum', () => {
    expect(stepReaderTextSize(0.8, -0.05)).toBe(0.8);
    expect(stepReaderTextSize(0.82, -0.05)).toBe(0.8);
    expect(stepReaderTextSize(0.1, -0.05)).toBe(0.8);
  });
});
