/** A rendered segment that may occupy one combined upright cell in vertical text. */
export interface VerticalTextSegment {
  text: string;
  combineUpright: boolean;
}

/** A sequence of items that may occupy one combined upright cell in vertical text. */
export interface VerticalTextGroup<T> {
  items: T[];
  combineUpright: boolean;
}

const PUNCTUATION_ONLY = /^\p{P}+$/u;
const PUNCTUATION_RUN = /\p{P}+/gu;

function shouldCombineUpright(text: string): boolean {
  return Array.from(text).length > 1 && PUNCTUATION_ONLY.test(text);
}

/**
 * Groups consecutive punctuation tokens so a vertical renderer can combine
 * them into a single upright character cell.
 */
export function groupVerticalPunctuationRuns<T>(
  items: readonly T[],
  getText: (item: T) => string,
): VerticalTextGroup<T>[] {
  const groups: VerticalTextGroup<T>[] = [];
  let punctuationRun: T[] = [];

  const flushPunctuationRun = () => {
    if (punctuationRun.length === 0) return;
    const text = punctuationRun.map(getText).join('');
    groups.push({ items: punctuationRun, combineUpright: shouldCombineUpright(text) });
    punctuationRun = [];
  };

  for (const item of items) {
    if (PUNCTUATION_ONLY.test(getText(item))) {
      punctuationRun.push(item);
      continue;
    }

    flushPunctuationRun();
    groups.push({ items: [item], combineUpright: false });
  }

  flushPunctuationRun();
  return groups;
}

/**
 * Splits raw OCR text into normal and multi-character punctuation segments for
 * the same vertical-text treatment when tokenization is not available yet.
 */
export function splitVerticalPunctuationRuns(text: string): VerticalTextSegment[] {
  const segments: VerticalTextSegment[] = [];
  let textStart = 0;

  for (const match of text.matchAll(PUNCTUATION_RUN)) {
    const index = match.index ?? 0;
    if (index > textStart) {
      segments.push({ text: text.slice(textStart, index), combineUpright: false });
    }

    segments.push({ text: match[0], combineUpright: shouldCombineUpright(match[0]) });
    textStart = index + match[0].length;
  }

  if (textStart < text.length) {
    segments.push({ text: text.slice(textStart), combineUpright: false });
  }

  return segments;
}
