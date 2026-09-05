import { describe, expect, it } from 'vitest';
import { createCompoundLexicon, decomposeCompound } from './compounds';
import type { LanguageCompoundSplittingConfig } from '../../types';

const german: LanguageCompoundSplittingConfig = {
  locale: 'de',
  linkingElements: ['', 'es', 'en', 'er', 'n', 's'],
  inflectionSuffixes: ['ern', 'en', 'er', 'es', 'e', 'n', 's'],
  minPartLength: 3,
};

const lexicon = createCompoundLexicon([
  { lemma: 'Papa', entryId: 'de:entry:papa' },
  { lemma: 'Hand', entryId: 'de:entry:hand' },
  { lemma: 'Schuh', entryId: 'de:entry:schuh' },
  { lemma: 'Arbeit', entryId: 'de:entry:arbeit' },
  { lemma: 'Zimmer', entryId: 'de:entry:zimmer' },
  { lemma: 'Bund', entryId: 'de:entry:bund' },
  { lemma: 'Kanzler', entryId: 'de:entry:kanzler' },
], german.locale);

describe('generic productive compound decomposition', () => {
  it('decomposes Papashandschuhe after independent inflection stripping', () => {
    const analysis = decomposeCompound('Papashandschuhe', lexicon, german);
    expect(analysis).toMatchObject({
      form: 'Papashandschuhe', lemma: 'Papashandschuh', source: 'generated', linkingElement: 's',
      parts: [{ lemma: 'Papa', linkingElement: 's' }, { lemma: 'Handschuh', parts: [{ lemma: 'Hand' }, { lemma: 'Schuh' }] }],
    });
    expect(analysis!.confidence).toBeLessThan(1);
  });

  it('recognizes supported linking elements without vocabulary exceptions', () => {
    expect(decomposeCompound('Arbeitszimmer', lexicon, german)?.parts[0]).toMatchObject({ lemma: 'Arbeit', linkingElement: 's' });
    expect(decomposeCompound('Bundeskanzler', lexicon, german)?.parts[0]).toMatchObject({ lemma: 'Bund', linkingElement: 'es' });
  });

  it('rejects short junk', () => {
    expect(decomposeCompound('abc', lexicon, german)).toBeNull();
  });

  it('records ambiguity when several parses survive dedupe instead of returning null', () => {
    const ambiguous = createCompoundLexicon([
      { lemma: 'Arbe', entryId: '1' }, { lemma: 'itszimmer', entryId: '2' },
      { lemma: 'Arbeit', entryId: '3' }, { lemma: 'Zimmer', entryId: '4' },
    ], german.locale);
    const analysis = decomposeCompound('Arbeitszimmer', ambiguous, german);
    expect(analysis).not.toBeNull();
    expect(analysis!.ambiguous).toBe(true);
    expect(analysis!.alternatives).toHaveLength(1);
    // Deterministic preference: the leftmost split wins attested-ratio ties.
    expect(analysis!.parts[0]).toMatchObject({ lemma: 'Arbe', linkingElement: undefined });
    const alternative = analysis!.alternatives[0]!;
    expect(alternative.parts[0]).toMatchObject({ lemma: 'Arbeit', linkingElement: 's' });
    expect(alternative.provenance).toMatchObject({ source: 'generated' });
  });

  it('exposes every alternative parse as a complete analysis for a two-way ambiguous form', () => {
    const nightTable = createCompoundLexicon([
      { lemma: 'Nach', entryId: 'nach' }, { lemma: 'Nacht', entryId: 'nacht' },
      { lemma: 'Tisch', entryId: 'tisch' }, { lemma: 'isch', entryId: 'isch' },
    ], german.locale);
    const analysis = decomposeCompound('Nachtisch', nightTable, german)!;
    expect(analysis.ambiguous).toBe(true);
    // Leftmost split is the deterministic preferred parse.
    expect(analysis.parts.map((part) => part.lemma)).toEqual(['Nach', 'Tisch']);
    expect(analysis.alternatives).toHaveLength(1);
    expect(analysis.alternatives[0]!.parts.map((part) => part.lemma)).toEqual(['Nacht', 'isch']);
    expect(analysis.alternatives[0]!.ambiguous).toBe(false);
    expect(analysis.provenance.lexiconBasis).toEqual(['nach', 'tisch']);
  });

  it('prefers an attested compound over generated parts and reports its provenance', () => {
    const attested = createCompoundLexicon([...lexicon.values(), { lemma: 'Handschuh', entryId: 'de:entry:handschuh' }], german.locale);
    const analysis = decomposeCompound('Handschuh', attested, german);
    expect(analysis).toMatchObject({ source: 'attested', confidence: 1 });
    expect(analysis!.provenance).toEqual({ source: 'attested', confidence: 1, lexiconBasis: ['de:entry:handschuh'] });
    expect(analysis!.ambiguous).toBe(false);
    expect(analysis!.alternatives).toEqual([]);
  });

  it('reports generated provenance and keeps the unique-decomposition predictor contract', () => {
    const analysis = decomposeCompound('Papashandschuhe', lexicon, german)!;
    // supportPredictor consumes source/confidence/parts of unique analyses.
    expect(analysis).toMatchObject({
      source: 'generated',
      confidence: 0.9,
      parts: [{ lemma: 'Papa', linkingElement: 's' }, { lemma: 'Handschuh', parts: [{ lemma: 'Hand' }, { lemma: 'Schuh' }] }],
    });
    expect(analysis.ambiguous).toBe(false);
    expect(analysis.alternatives).toEqual([]);
    expect(analysis.provenance).toEqual({
      source: 'generated',
      confidence: analysis.confidence,
      lexiconBasis: ['de:entry:papa', 'de:entry:hand', 'de:entry:schuh'],
    });
    expect(analysis.parts[0]!.attested).toBe(true);
  });

  it('splits under any package-declared strategy, not only the German one', () => {
    const swedish: LanguageCompoundSplittingConfig = { locale: 'sv', linkingElements: ['', 's', 'e'], minPartLength: 3 };
    const swedishLexicon = createCompoundLexicon([
      { lemma: 'hus', entryId: 'sv:hus' }, { lemma: 'djur', entryId: 'sv:djur' },
    ], swedish.locale);
    const analysis = decomposeCompound('husdjur', swedishLexicon, swedish);
    expect(analysis).toMatchObject({
      source: 'generated',
      parts: [{ lemma: 'hus' }, { lemma: 'djur' }],
    });
  });
});
