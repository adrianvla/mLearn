import { DEFAULT_SETTINGS, type Settings } from './types';

type ReadingAnnotationSettings = Pick<
  Settings,
  'showReadingAnnotations'
  | 'readingAnnotationMoreContrast'
  | 'readingAnnotationSizePercent'
  | 'hideReadingForKnownWords'
  | 'ocrReadingAnnotationFiltering'
  | 'ocrReadingAnnotationWidthRatio'
  | 'ocrReadingAnnotationNeighborWindowMultiplier'
  | 'ocrReadingAnnotationNeighborLookahead'
  | 'readerReadingAnnotationHider'
>;

export function readingAnnotationsEnabled(settings: ReadingAnnotationSettings): boolean {
  return settings.showReadingAnnotations ?? DEFAULT_SETTINGS.showReadingAnnotations!;
}

export function readingAnnotationMoreContrastEnabled(settings: ReadingAnnotationSettings): boolean {
  return settings.readingAnnotationMoreContrast ?? DEFAULT_SETTINGS.readingAnnotationMoreContrast!;
}

export function readingAnnotationSizePercent(settings: ReadingAnnotationSettings): number {
  return settings.readingAnnotationSizePercent ?? DEFAULT_SETTINGS.readingAnnotationSizePercent!;
}

export function hideReadingAnnotationsForKnownWords(settings: ReadingAnnotationSettings): boolean {
  return settings.hideReadingForKnownWords ?? DEFAULT_SETTINGS.hideReadingForKnownWords ?? false;
}

export function ocrReadingAnnotationFilteringEnabled(settings: ReadingAnnotationSettings): boolean {
  return settings.ocrReadingAnnotationFiltering ?? DEFAULT_SETTINGS.ocrReadingAnnotationFiltering!;
}

export function readerReadingAnnotationHiderEnabled(settings: ReadingAnnotationSettings): boolean {
  return settings.readerReadingAnnotationHider ?? DEFAULT_SETTINGS.readerReadingAnnotationHider!;
}

export function ocrReadingAnnotationWidthRatio(settings: ReadingAnnotationSettings): number {
  return settings.ocrReadingAnnotationWidthRatio ?? DEFAULT_SETTINGS.ocrReadingAnnotationWidthRatio!;
}

export function ocrReadingAnnotationNeighborWindowMultiplier(settings: ReadingAnnotationSettings): number {
  return settings.ocrReadingAnnotationNeighborWindowMultiplier ?? DEFAULT_SETTINGS.ocrReadingAnnotationNeighborWindowMultiplier!;
}

export function ocrReadingAnnotationNeighborLookahead(settings: ReadingAnnotationSettings): number {
  return settings.ocrReadingAnnotationNeighborLookahead ?? DEFAULT_SETTINGS.ocrReadingAnnotationNeighborLookahead!;
}
