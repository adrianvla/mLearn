// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DictionaryAlternatives, CompoundDecomposition, compoundAnalysisFor, grammarOccurrencesForToken, resolveCompoundDisplay } from './WordHover';
import type { GraphWordLookup } from '../../../shared/graph/ipc';
import type { LanguageData, WordFrequencyEntry, WordFrequencyMap } from '../../../shared/types';
import type { GrammarOccurrence } from '../../../shared/grammar/occurrences';

it('keeps only grammar attached to the hovered token without merging distinct patterns', () => {
  const occurrence = (patternId: string, tokenIndex: number): GrammarOccurrence => ({
    patternId, targetRef: { kind: 'grammar-pattern', id: patternId, capability: 'grammar-recognition' },
    sentenceSpan: { start: tokenIndex, end: tokenIndex + 1 },
    tokenEvidence: [{ tokenIndex }], realizedForm: '分から', confidence: 0.9,
    provenance: 'morphological',
  });
  const all = [occurrence('pattern-a', 0), occurrence('pattern-b', 0), occurrence('ない', 1)];
  expect(grammarOccurrencesForToken(all, 0).map((item) => item.patternId)).toEqual(['pattern-a', 'pattern-b']);
  expect(grammarOccurrencesForToken(all, 1).map((item) => item.patternId)).toEqual(['ない']);
});

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
    const lookup = (compoundAnalysis: GraphWordLookup['compoundAnalysis']): GraphWordLookup => ({
      surfaceId: 'de:surface:x', entries: [], lexemes: [], senses: [], pronunciations: [], compoundAnalysis,
    });
    const attestedAnalysis = {
      form: word, lemma: word, source: 'attested' as const, confidence: 1,
      provenance: { source: 'attested' as const, confidence: 1, lexiconBasis: ['de:surface:papa'] },
      parts: [
        { lemma: 'Papa', entryId: 'de:surface:papa', attested: true },
        { lemma: 'Handschuh', entryId: 'de:surface:handschuh', attested: true },
      ],
      ambiguous: false, alternatives: [],
    };
    // In flight: nothing is guessed.
    expect(resolveCompoundDisplay(undefined, word, compoundLanguage, germanVocabulary)).toEqual({ kind: 'pending' });
    // Absent from the graph (null lookup): productive split, still capability-gated.
    expect(resolveCompoundDisplay(null, word, compoundLanguage, germanVocabulary)?.kind).toBe('unseen');
    expect(resolveCompoundDisplay(null, word, { name: 'German' }, germanVocabulary).kind).toBe('none');
    // Graph-known without attested structure: never guessed.
    expect(resolveCompoundDisplay(lookup(null), word, compoundLanguage, germanVocabulary)).toEqual({ kind: 'none' });
    // Graph-attested structure is primary — even without a declared strategy.
    expect(resolveCompoundDisplay(lookup(attestedAnalysis), word, { name: 'German' }, germanVocabulary).kind).toBe('attested');
  });
});


describe('dictionary alternatives', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => { dispose?.(); document.body.innerHTML = ''; });
  it('shows alternatives without claiming certainty and exposes pending/failed correction states', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const chosen = vi.fn();
    const [saving, setSaving] = createSignal(false); const [failed, setFailed] = createSignal(false);
    dispose = render(() => <DictionaryAlternatives saving={saving()} failed={failed()} onChoose={chosen} t={identityT}
      resolution={{ selectedId: 'first', basis: 'token-hint', candidates: [
        { id: 'first', label: 'X', data: [{ reading: 'first', definitions: 'first meaning' }], metadata: { 'unknown::value': [1, 2] } },
        { id: 'second', label: 'X', data: [{ reading: 'second', definitions: 'second meaning' }] },
      ] }} />, host);
    expect(host.textContent).toContain('mlearn.WordHover.ResolutionHint');
    expect(host.textContent).toContain('second meaning');
    const buttons = host.querySelectorAll('button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    buttons[1].click(); expect(chosen).toHaveBeenCalledWith('second');
    setSaving(true); expect(buttons[1].disabled).toBe(true); expect(host.querySelector('[role="status"]')).not.toBeNull();
    setSaving(false); setFailed(true); expect(buttons[1].disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('mlearn.WordHover.ResolutionSaveFailed');
  });
});
