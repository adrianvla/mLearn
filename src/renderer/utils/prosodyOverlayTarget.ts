export interface ProsodyOverlayTextTargetOptions {
  slot: 'word' | 'reading';
  displayReading: string;
}

export interface ProsodyOverlayTextTarget {
  word: string;
  reading: string;
}

export function getProsodyOverlayTextTarget(
  surfaceWord: string,
  reading: string | null | undefined,
  options: ProsodyOverlayTextTargetOptions,
): ProsodyOverlayTextTarget {
  if (options.slot === 'reading') {
    const displayedReading = options.displayReading || reading || surfaceWord;
    return {
      word: displayedReading,
      reading: displayedReading,
    };
  }

  return {
    word: surfaceWord,
    reading: reading || surfaceWord,
  };
}
