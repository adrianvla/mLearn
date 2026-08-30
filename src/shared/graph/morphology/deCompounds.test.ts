import { describe, expect, it } from 'vitest';
import { createGermanCompoundLexicon, decomposeGermanCompound } from './deCompounds';

const lexicon = createGermanCompoundLexicon([
  { lemma: 'Papa', entryId: 'de:entry:papa' },
  { lemma: 'Hand', entryId: 'de:entry:hand', gender: 'f' },
  { lemma: 'Schuh', entryId: 'de:entry:schuh', gender: 'm' },
  { lemma: 'Arbeit', entryId: 'de:entry:arbeit' },
  { lemma: 'Zimmer', entryId: 'de:entry:zimmer' },
  { lemma: 'Bund', entryId: 'de:entry:bund' },
  { lemma: 'Kanzler', entryId: 'de:entry:kanzler' },
]);

describe('German productive compound decomposition', () => {
  it('decomposes Papashandschuhe after independent inflection stripping', () => {
    const analysis = decomposeGermanCompound('Papashandschuhe', lexicon);
    expect(analysis).toMatchObject({
      form: 'Papashandschuhe', lemma: 'Papashandschuh', source: 'generated', head: { lemma: 'Schuh' }, linkingElement: 's',
      parts: [{ lemma: 'Papa', linkingElement: 's' }, { lemma: 'Handschuh', parts: [{ lemma: 'Hand' }, { lemma: 'Schuh' }] }],
    });
    expect(analysis!.confidence).toBeLessThan(1);
  });

  it('recognizes supported linking elements without vocabulary exceptions', () => {
    expect(decomposeGermanCompound('Arbeitszimmer', lexicon)?.parts[0]).toMatchObject({ lemma: 'Arbeit', linkingElement: 's' });
    expect(decomposeGermanCompound('Bundeskanzler', lexicon)?.parts[0]).toMatchObject({ lemma: 'Bund', linkingElement: 'es' });
  });

  it('rejects short junk', () => {
    expect(decomposeGermanCompound('abc', lexicon)).toBeNull();
  });

  it('records ambiguity when several parses survive dedupe instead of returning null', () => {
    const ambiguous = createGermanCompoundLexicon([
      { lemma: 'Arbe', entryId: '1' }, { lemma: 'itszimmer', entryId: '2' },
      { lemma: 'Arbeit', entryId: '3' }, { lemma: 'Zimmer', entryId: '4' },
    ]);
    const analysis = decomposeGermanCompound('Arbeitszimmer', ambiguous);
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
    const nightTable = createGermanCompoundLexicon([
      { lemma: 'Nach', entryId: 'nach' }, { lemma: 'Nacht', entryId: 'nacht' },
      { lemma: 'Tisch', entryId: 'tisch' }, { lemma: 'isch', entryId: 'isch' },
    ]);
    const analysis = decomposeGermanCompound('Nachtisch', nightTable)!;
    expect(analysis.ambiguous).toBe(true);
    // Leftmost split is the deterministic preferred parse.
    expect(analysis.parts.map((part) => part.lemma)).toEqual(['Nach', 'Tisch']);
    expect(analysis.alternatives).toHaveLength(1);
    expect(analysis.alternatives[0]!.parts.map((part) => part.lemma)).toEqual(['Nacht', 'isch']);
    expect(analysis.alternatives[0]!.ambiguous).toBe(false);
    expect(analysis.provenance.lexiconBasis).toEqual(['nach', 'tisch']);
  });

  it('prefers an attested compound over generated parts and reports its provenance', () => {
    const attested = createGermanCompoundLexicon([...lexicon.values(), { lemma: 'Handschuh', entryId: 'de:entry:handschuh' }]);
    const analysis = decomposeGermanCompound('Handschuh', attested);
    expect(analysis).toMatchObject({ source: 'attested', confidence: 1, head: { lemma: 'Handschuh' } });
    expect(analysis!.provenance).toEqual({ source: 'attested', confidence: 1, lexiconBasis: ['de:entry:handschuh'] });
    expect(analysis!.ambiguous).toBe(false);
    expect(analysis!.alternatives).toEqual([]);
  });

  it('reports generated provenance and keeps the unique-decomposition predictor contract', () => {
    const analysis = decomposeGermanCompound('Papashandschuhe', lexicon)!;
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
});
