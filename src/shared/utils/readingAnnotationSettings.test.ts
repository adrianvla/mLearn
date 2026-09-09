import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import {
  applyReadingScaffoldMode,
  hideReadingAnnotationsForKnownWords,
  readingScaffoldMode,
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

describe('reading scaffold mode (Off | Auto | Always)', () => {
  it('derives the mode from visibility and known-word hiding', () => {
    expect(readingScaffoldMode(makeSettings())).toBe('always'); // defaults: shown, never hidden
    expect(readingScaffoldMode(makeSettings({ showReadingAnnotations: false }))).toBe('off');
    expect(readingScaffoldMode(makeSettings({ hideReadingForKnownWords: true }))).toBe('auto');
  });

  it('applies exact field mappings per mode', () => {
    expect(applyReadingScaffoldMode('off')).toEqual({ showReadingAnnotations: false });
    expect(applyReadingScaffoldMode('always')).toEqual({ showReadingAnnotations: true, hideReadingForKnownWords: false });
    expect(applyReadingScaffoldMode('auto')).toEqual({ showReadingAnnotations: true, hideReadingForKnownWords: true });
  });

  it('round-trips: applied modes read back as themselves', () => {
    for (const mode of ['off', 'auto', 'always'] as const) {
      expect(readingScaffoldMode({ ...makeSettings(), ...applyReadingScaffoldMode(mode) })).toBe(mode);
    }
  });
});
