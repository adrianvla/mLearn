// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { CompoundDecomposition, compoundAnalysisFor } from './WordHover';
import type { LanguageData, WordFrequencyEntry, WordFrequencyMap } from '../../../shared/types';

const entry: WordFrequencyEntry = { reading: '', level: '1', raw_level: 1 };

const germanVocabulary: WordFrequencyMap = {
  Papa: entry,
  Hand: entry,
  Schuh: entry,
  Handschuh: entry,
};
const compoundLanguage: LanguageData = { name: 'German', compoundSplitting: true };

const identityT = (key: string) => key;

describe('German compound hover analysis', () => {
  const container = () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  };
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('decomposes a fixture compound through the shared splitter', () => {
    const analysis = compoundAnalysisFor('Papashandschuhe', compoundLanguage, germanVocabulary);
    expect(analysis).not.toBeNull();
    expect(analysis!.parts[0]).toMatchObject({ lemma: 'Papa', linkingElement: 's' });
    expect(analysis!.parts[1]).toMatchObject({
      lemma: 'Handschuh',
      parts: [{ lemma: 'Hand' }, { lemma: 'Schuh' }],
    });
  });

  it('renders the decomposition tree for a fixture compound', () => {
    const analysis = compoundAnalysisFor('Papashandschuhe', compoundLanguage, germanVocabulary)!;
    const host = container();
    dispose = render(() => <CompoundDecomposition analysis={analysis} t={identityT} />, host);
    expect(host.textContent).toContain('mlearn.WordHover.Compound.Title');
    expect(host.textContent).toContain('Papa + Handschuh');
    expect(host.textContent).toContain('Hand + Schuh');
  });

  it('notes ambiguity when several parses survive', () => {
    const analysis = compoundAnalysisFor('Nachtisch', compoundLanguage, {
      Nach: entry, Nacht: entry, Tisch: entry, isch: entry,
    })!;
    expect(analysis.ambiguous).toBe(true);
    const host = container();
    dispose = render(() => <CompoundDecomposition analysis={analysis} t={identityT} />, host);
    expect(host.textContent).toContain('mlearn.WordHover.Compound.Ambiguous');
  });

  it('renders nothing without the compound capability: non-compounds and undeclared packages', () => {
    // Attested single lexeme — not a compound, no tree.
    expect(compoundAnalysisFor('Handschuh', compoundLanguage, germanVocabulary)).toBeNull();
    // Word with no parse at all.
    expect(compoundAnalysisFor('Haus', compoundLanguage, { Haus: entry })).toBeNull();
    // The capability is declared metadata, not a language-code literal:
    // without the flag the compound UI degrades away, whatever the code.
    expect(compoundAnalysisFor('Papashandschuhe', { name: 'Japanese' }, germanVocabulary)).toBeNull();
    expect(compoundAnalysisFor('Papashandschuhe', { name: 'German' }, germanVocabulary)).toBeNull();
    expect(compoundAnalysisFor('Papashandschuhe', { name: 'German', compoundSplitting: false }, germanVocabulary)).toBeNull();
    expect(compoundAnalysisFor('Papashandschuhe', undefined, germanVocabulary)).toBeNull();
  });
});
