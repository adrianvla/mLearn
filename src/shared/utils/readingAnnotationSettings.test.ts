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
import { applyReadingScaffoldStance, readingScaffoldStance } from '../scaffoldPreferences';

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

describe('reading scaffold stance (accessibility constraint dial)', () => {
  it('derives the stance from visibility and known-word hiding', () => {
    expect(readingScaffoldStance(makeSettings())).toBe('require'); // defaults: shown, never hidden
    expect(readingScaffoldStance(makeSettings({ showReadingAnnotations: false }))).toBe('forbid');
    expect(readingScaffoldStance(makeSettings({ hideReadingForKnownWords: true }))).toBe('adaptive');
  });

  it('applies exact field mappings per stance', () => {
    expect(applyReadingScaffoldStance('forbid')).toEqual({ showReadingAnnotations: false });
    expect(applyReadingScaffoldStance('require')).toEqual({ showReadingAnnotations: true, hideReadingForKnownWords: false });
    expect(applyReadingScaffoldStance('adaptive')).toEqual({ showReadingAnnotations: true, hideReadingForKnownWords: true });
  });

  it('round-trips: applied stances read back as themselves', () => {
    for (const stance of ['forbid', 'adaptive', 'require'] as const) {
      expect(readingScaffoldStance({ ...makeSettings(), ...applyReadingScaffoldStance(stance) })).toBe(stance);
    }
  });
});
