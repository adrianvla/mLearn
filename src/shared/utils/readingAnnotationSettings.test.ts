import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import {
  hideReadingAnnotationsForKnownWords,
  ocrReadingAnnotationFilteringEnabled,
  readerReadingAnnotationHiderEnabled,
  readingAnnotationMoreContrastEnabled,
  readingAnnotationSizePercent,
  readingAnnotationsEnabled,
} from '../readingAnnotationSettings';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('reading annotation settings', () => {
  it('uses the generic reading annotation setting', () => {
    expect(readingAnnotationsEnabled(makeSettings({
      showReadingAnnotations: false,
    }))).toBe(false);
    expect(readingAnnotationsEnabled(makeSettings({
      showReadingAnnotations: true,
    }))).toBe(true);
  });

  it('uses generic defaults when optional reading annotation settings are absent', () => {
    expect(readingAnnotationsEnabled(makeSettings({ showReadingAnnotations: undefined }))).toBe(true);
    expect(ocrReadingAnnotationFilteringEnabled(makeSettings({
      ocrReadingAnnotationFiltering: undefined,
    }))).toBe(true);
    expect(readerReadingAnnotationHiderEnabled(makeSettings({
      readerReadingAnnotationHider: undefined,
    }))).toBe(false);
    expect(readingAnnotationMoreContrastEnabled(makeSettings({
      readingAnnotationMoreContrast: undefined,
    }))).toBe(false);
    expect(readingAnnotationSizePercent(makeSettings({
      readingAnnotationSizePercent: undefined,
    }))).toBe(100);
  });

  it('resolves reader and OCR reading annotation toggles with defaults', () => {
    expect(hideReadingAnnotationsForKnownWords(makeSettings({ hideReadingForKnownWords: true }))).toBe(true);
    expect(ocrReadingAnnotationFilteringEnabled(makeSettings({
      ocrReadingAnnotationFiltering: false,
    }))).toBe(false);
    expect(ocrReadingAnnotationFilteringEnabled(makeSettings({ ocrReadingAnnotationFiltering: undefined }))).toBe(true);
    expect(readerReadingAnnotationHiderEnabled(makeSettings({
      readerReadingAnnotationHider: true,
    }))).toBe(true);
    expect(readerReadingAnnotationHiderEnabled(makeSettings({ readerReadingAnnotationHider: undefined }))).toBe(false);
  });

  it('resolves reading appearance settings', () => {
    expect(readingAnnotationMoreContrastEnabled(makeSettings({
      readingAnnotationMoreContrast: true,
    }))).toBe(true);
    expect(readingAnnotationSizePercent(makeSettings({
      readingAnnotationSizePercent: 130,
    }))).toBe(130);
  });
});
