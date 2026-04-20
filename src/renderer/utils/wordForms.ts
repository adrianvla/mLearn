export function getWordFormCandidates(
  word: string,
  getCanonicalForm: (word: string) => string,
  getWordVariants?: (word: string) => string[],
): string[] {
  if (!word) return [];

  if (getWordVariants) {
    const variants = getWordVariants(word).filter(Boolean);
    if (variants.length > 0) {
      return variants;
    }
  }

  const canonical = getCanonicalForm(word);
  return canonical && canonical !== word ? [canonical, word] : [word];
}
