// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { CompoundDecomposition, compoundAnalysisFor, resolveCompoundDisplay } from './WordHover';
import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import type { LanguageData, WordFrequencyEntry, WordFrequencyMap } from '../../../shared/types';

const entry: WordFrequencyEntry = { reading: '', level: '1', raw_level: 1 };

const germanVocabulary: WordFrequencyMap = {
  Papa: entry,
  Hand: entry,
  Schuh: entry,
  Handschuh: entry,
};
const compoundLanguage: LanguageData = {
  name: 'German',
  compoundSplitting: { locale: 'de', linkingElements: ['', 'es', 'en', 'er', 'n', 's'], inflectionSuffixes: ['ern', 'en', 'er', 'es', 'e', 'n', 's'], minPartLength: 3 },
};

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
    expect(compoundAnalysisFor('Papashandschuhe', { name: 'German', compoundSplitting: { locale: 'de', linkingElements: [] } }, germanVocabulary)).toBeNull();
    expect(compoundAnalysisFor('Papashandschuhe', undefined, germanVocabulary)).toBeNull();
  });

  it('normalizes the shared frequency lexicon per declared locale, not per cached map', () => {
    const sharedMap: WordFrequencyMap = { ...germanVocabulary, PAPI: entry };
    // First hover warms the lexicon cache under the German locale.
    expect(compoundAnalysisFor('Papihandschuh', compoundLanguage, sharedMap)).not.toBeNull();
    // The same map object under a package declaring Turkish: 'PAPI' normalizes
    // to 'papı', so the 'Papi' leaf must no longer resolve — the cached
    // German-normalized lexicon must not leak across locales.
    const turkish: LanguageData = { name: 'Turkish', compoundSplitting: { locale: 'tr', linkingElements: ['', 's'], minPartLength: 3 } };
    expect(compoundAnalysisFor('Papihandschuh', turkish, sharedMap)).toBeNull();
  });

  it('resolves hover decomposition graph-first with a tri-state', () => {
    const word = 'Papashandschuhe';
    // In flight or stale: nothing is guessed.
    expect(resolveCompoundDisplay(undefined, word, compoundLanguage, germanVocabulary)).toEqual({ kind: 'pending' });
    const stale: KnowledgeProjection = { status: 'ready', querySurface: 'Otherword', surfaceKnown: false, compoundAnalysis: null, targets: [] };
    expect(resolveCompoundDisplay(stale, word, compoundLanguage, germanVocabulary)).toEqual({ kind: 'pending' });
    const error: KnowledgeProjection = { status: 'error', targets: [] };
    expect(resolveCompoundDisplay(error, word, compoundLanguage, germanVocabulary)).toEqual({ kind: 'pending' });
    // Absent from the graph: productive split, still capability-gated.
    const unseen: KnowledgeProjection = { status: 'ready', querySurface: word, surfaceKnown: false, compoundAnalysis: null, targets: [] };
    expect(resolveCompoundDisplay(unseen, word, compoundLanguage, germanVocabulary)?.kind).toBe('unseen');
    expect(resolveCompoundDisplay(unseen, word, { name: 'German' }, germanVocabulary).kind).toBe('none');
    // Graph-known without attested structure: never guessed.
    const knownStructureless: KnowledgeProjection = { ...unseen, surfaceKnown: true };
    expect(resolveCompoundDisplay(knownStructureless, word, compoundLanguage, germanVocabulary)).toEqual({ kind: 'none' });
    // Graph-attested structure is primary — even without a declared strategy.
    const attested: KnowledgeProjection = {
      ...knownStructureless,
      compoundAnalysis: {
        form: word, lemma: word, source: 'attested', confidence: 1,
        provenance: { source: 'attested', confidence: 1, lexiconBasis: ['de:surface:papa'] },
        parts: [
          { lemma: 'Papa', entryId: 'de:surface:papa', attested: true },
          { lemma: 'Handschuh', entryId: 'de:surface:handschuh', attested: true },
        ],
        ambiguous: false, alternatives: [],
      },
    };
    const resolved = resolveCompoundDisplay(attested, word, { name: 'German' }, germanVocabulary);
    expect(resolved.kind).toBe('attested');
  });
});
