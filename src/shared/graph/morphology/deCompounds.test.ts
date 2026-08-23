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

  it('rejects short junk and ambiguous parses', () => {
    expect(decomposeGermanCompound('abc', lexicon)).toBeNull();
    const ambiguous = createGermanCompoundLexicon([
      { lemma: 'Arbe', entryId: '1' }, { lemma: 'itszimmer', entryId: '2' },
      { lemma: 'Arbeit', entryId: '3' }, { lemma: 'Zimmer', entryId: '4' },
    ]);
    expect(decomposeGermanCompound('Arbeitszimmer', ambiguous)).toBeNull();
  });

  it('prefers an attested compound over generated parts', () => {
    const attested = createGermanCompoundLexicon([...lexicon.values(), { lemma: 'Handschuh', entryId: 'de:entry:handschuh' }]);
    expect(decomposeGermanCompound('Handschuh', attested)).toMatchObject({ source: 'attested', confidence: 1, head: { lemma: 'Handschuh' } });
  });
});
