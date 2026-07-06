export interface DrainedVoicePhrases {
  phrases: string[];
  nextIndex: number;
}

const PHRASE_BOUNDARY = /[.!?。！？؟؛]+(?:["'”’)]*)\s*/g;

export function drainSpeakablePhrases(
  text: string,
  startIndex: number,
  forceTail = false,
): DrainedVoicePhrases {
  const safeStart = Math.max(0, Math.min(startIndex, text.length));
  let cursor = safeStart;
  const phrases: string[] = [];

  PHRASE_BOUNDARY.lastIndex = safeStart;
  let match: RegExpExecArray | null;
  while ((match = PHRASE_BOUNDARY.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const phrase = text.slice(cursor, end).trim();
    if (phrase) {
      phrases.push(phrase);
    }
    cursor = end;
  }

  if (forceTail && cursor < text.length) {
    const tail = text.slice(cursor).trim();
    if (tail) {
      phrases.push(tail);
    }
    cursor = text.length;
  }

  return { phrases, nextIndex: cursor };
}
