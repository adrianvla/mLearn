export interface MaterialPracticeContext {
  language: string;
  label: string;
  words: string[];
}

/** A material handoff stays in its source language and carries an explicit selection. */
export function materialPracticeContext(value: unknown, language: string): MaterialPracticeContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (input.language !== language || typeof input.label !== 'string' || !input.label.trim()
    || !Array.isArray(input.words) || input.words.some(word => typeof word !== 'string')) return undefined;
  const words = [...new Set((input.words as string[]).map(word => word.trim()).filter(Boolean))];
  return words.length ? { language, label: input.label.trim(), words } : undefined;
}
