export function getWordFormCandidates(
  word: string,
  getCanonicalForm: (word: string) => string,
): string[] {
  if (!word) return [];

  const canonical = getCanonicalForm(word);
  return canonical && canonical !== word ? [canonical, word] : [word];
}