export const READER_TEXT_THEME_IDS = ['original', 'paper', 'calm', 'quiet', 'night', 'focus'] as const;

export type ReaderTextThemeId = (typeof READER_TEXT_THEME_IDS)[number];

export const MIN_READER_TEXT_SIZE = 0.8;
export const MAX_READER_TEXT_SIZE = 1.6;

export const readerTextThemeClass = (themeId: string | undefined): string => {
  const id = READER_TEXT_THEME_IDS.includes(themeId as ReaderTextThemeId) ? themeId : 'original';
  return `reader-text-theme-${id}`;
};

export const stepReaderTextSize = (current: number, delta: number): number => {
  const stepped = Math.round((current + delta) * 100) / 100;
  return Math.min(MAX_READER_TEXT_SIZE, Math.max(MIN_READER_TEXT_SIZE, stepped));
};
