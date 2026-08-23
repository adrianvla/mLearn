export type GermanCompoundSource = 'attested' | 'generated';

export interface GermanLexiconEntry {
  lemma: string;
  entryId?: string;
  gender?: 'm' | 'f' | 'n';
}

export interface GermanCompoundPart extends GermanLexiconEntry {
  parts?: readonly GermanCompoundPart[];
  linkingElement?: string;
}

export interface GermanCompoundAnalysis {
  form: string;
  lemma: string;
  source: GermanCompoundSource;
  confidence: number;
  parts: readonly GermanCompoundPart[];
  head: GermanCompoundPart;
  linkingElement?: string;
}

export type GermanCompoundLexicon = ReadonlyMap<string, GermanLexiconEntry>;

const LINKING_ELEMENTS = ['', 'es', 'en', 'er', 'n', 's'] as const;
const INFLECTION_SUFFIXES = ['ern', 'en', 'er', 'es', 'e', 'n', 's'] as const;
const MIN_PART_LENGTH = 3;

export function createGermanCompoundLexicon(entries: readonly GermanLexiconEntry[]): Map<string, GermanLexiconEntry> {
  return new Map(entries.map((entry) => [entry.lemma.toLocaleLowerCase('de'), entry]));
}

/** Removes inflection candidates before, and independently from, compound splitting. */
export function stripGermanInflection(form: string): string[] {
  const normalized = form.trim();
  if (normalized.length < MIN_PART_LENGTH) return [];
  return [normalized, ...INFLECTION_SUFFIXES
    .filter((suffix) => normalized.toLocaleLowerCase('de').endsWith(suffix) && normalized.length - suffix.length >= MIN_PART_LENGTH)
    .map((suffix) => normalized.slice(0, -suffix.length))];
}

export function decomposeGermanCompound(form: string, lexicon: GermanCompoundLexicon): GermanCompoundAnalysis | null {
  const normalized = form.trim();
  if (!/^[\p{L}]+$/u.test(normalized) || normalized.length < MIN_PART_LENGTH) return null;
  const attested = lookup(normalized, lexicon);
  if (attested) return atomicAnalysis(normalized, attested);

  const candidates = stripGermanInflection(normalized)
    .flatMap((lemma) => splitCompound(lemma, lexicon).map((parts) => ({ lemma, parts })));
  const unique = dedupeCandidates(candidates);
  if (unique.length !== 1) return null;

  const [{ lemma, parts }] = unique;
  const leaves = leafParts(parts);
  if (leaves.length < 2 || leaves.some((part) => part.lemma.length < MIN_PART_LENGTH)) return null;
  const head = rightmost(parts);
  return {
    form: normalized,
    lemma,
    source: 'generated',
    confidence: Math.min(0.9, 0.5 + leaves.length * 0.1 + 0.1 + 0.1),
    parts,
    head,
    linkingElement: parts[0]?.linkingElement,
  };
}

function atomicAnalysis(form: string, entry: GermanLexiconEntry): GermanCompoundAnalysis {
  const part = { ...entry };
  return { form, lemma: entry.lemma, source: 'attested', confidence: 1, parts: [part], head: part };
}

function splitCompound(word: string, lexicon: GermanCompoundLexicon): GermanCompoundPart[][] {
  const candidates: GermanCompoundPart[][] = [];
  for (let boundary = MIN_PART_LENGTH; boundary <= word.length - MIN_PART_LENGTH; boundary += 1) {
    for (const linkingElement of LINKING_ELEMENTS) {
      if (word.slice(boundary, boundary + linkingElement.length).toLocaleLowerCase('de') !== linkingElement) continue;
      const left = word.slice(0, boundary);
      const right = word.slice(boundary + linkingElement.length);
      if (right.length < MIN_PART_LENGTH) continue;
      const leftEntry = lookup(left, lexicon);
      if (!leftEntry) continue;
      const rightParts = parsePart(right, lexicon);
      if (!rightParts) continue;
      candidates.push([{ ...leftEntry, linkingElement: linkingElement || undefined }, rightParts]);
    }
  }
  return candidates;
}

function parsePart(word: string, lexicon: GermanCompoundLexicon): GermanCompoundPart | null {
  const entry = lookup(word, lexicon);
  const nested = splitCompound(word, lexicon);
  if (nested.length > 1) return null;
  if (nested.length === 1) {
    const parts = nested[0];
    return { ...(entry ?? { lemma: word[0]!.toLocaleUpperCase('de') + word.slice(1) }), parts, linkingElement: parts[0]?.linkingElement };
  }
  return entry ? { ...entry } : null;
}

function lookup(word: string, lexicon: GermanCompoundLexicon): GermanLexiconEntry | undefined {
  return lexicon.get(word.toLocaleLowerCase('de'));
}

function dedupeCandidates(candidates: Array<{ lemma: string; parts: GermanCompoundPart[] }>): Array<{ lemma: string; parts: GermanCompoundPart[] }> {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.lemma}:${partKey(candidate.parts)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function partKey(parts: readonly GermanCompoundPart[]): string {
  return parts.map((part) => `${part.lemma}[${part.linkingElement ?? ''}:${part.parts ? partKey(part.parts) : ''}]`).join('+');
}

function leafParts(parts: readonly GermanCompoundPart[]): GermanCompoundPart[] {
  return parts.flatMap((part) => part.parts ? leafParts(part.parts) : [part]);
}

function rightmost(parts: readonly GermanCompoundPart[]): GermanCompoundPart {
  const part = parts[parts.length - 1]!;
  return part.parts ? rightmost(part.parts) : part;
}
