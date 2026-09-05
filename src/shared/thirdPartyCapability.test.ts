import { describe, expect, it } from 'vitest';
import { compoundSplitterConfig, languageSupportsCompoundSplitting } from './languageFeatures';
import { getAvailableAspects } from './types';
import { attestedCompoundAnalysis } from './graph/morphology/attested';
import { createCompoundLexicon, decomposeCompound } from './graph/morphology/compounds';
import type { LanguageCompoundSplittingConfig, LanguageData } from './types';
import { loadLinguisticGraph, relationsOf, surfaceEntityId } from './graph/load';
import { learnableTargetsFor } from './graph/targets';
import type { GraphEntity } from './graph/types';
import { predictTargetAccessibility } from './prediction/supportPredictor';

/**
 * Third-party catalog proof: a language unknown to this repository, with a
 * deliberately unfamiliar capability combination, must obtain mLearn features
 * purely from its package metadata/assets. No runtime source may mention this
 * language or its code.
 */
const UNKNOWN_CODE = 'x-test-agnostic';

const unfamiliarStrategy: LanguageCompoundSplittingConfig = {
  locale: 'und',
  linkingElements: ['q'],
  minPartLength: 3,
};

const syntheticPackage: LanguageData = {
  name: 'Test-Agnostic',
  compoundSplitting: unfamiliarStrategy,
};

describe('third-party catalog capability parity (x-test-agnostic)', () => {
  it('activates compound splitting purely from package metadata', () => {
    expect(languageSupportsCompoundSplitting(syntheticPackage)).toBe(true);
    expect(compoundSplitterConfig(syntheticPackage)).toBe(unfamiliarStrategy);
  });

  it('decomposes unseen productive forms under the declared unfamiliar strategy', () => {
    const lexicon = createCompoundLexicon([
      { lemma: 'zor', entryId: 'x:zor' },
      { lemma: 'mek', entryId: 'x:mek' },
    ], unfamiliarStrategy.locale);
    const analysis = decomposeCompound('Zorqmek', lexicon, unfamiliarStrategy);
    expect(analysis).toMatchObject({
      source: 'generated',
      parts: [{ lemma: 'zor', linkingElement: 'q' }, { lemma: 'mek' }],
    });
    expect(analysis!.provenance.lexiconBasis).toEqual(['x:zor', 'x:mek']);
  });

  it('keeps the feature unavailable when the capability is absent — absence is semantic, not language identity', () => {
    const withoutCapability: LanguageData = { name: 'Test-Agnostic' };
    expect(languageSupportsCompoundSplitting(withoutCapability)).toBe(false);
    expect(compoundSplitterConfig(withoutCapability)).toBeNull();
    // Same unknown code, no capability: identical lexical behavior to any
    // other package without the declaration.
    expect(getAvailableAspects(withoutCapability)).toEqual(['meaning']);
  });

  it('derives learnable targets from graph structure, never from language identity', () => {
    // Unfamiliar combination: character-reading and grammar data, plus a
    // component-of composition edge, but no prosody or gender anywhere.
    const graph = loadLinguisticGraph({
      schemaVersion: 1 as const,
      language: UNKNOWN_CODE,
      generatedAt: '2026-09-05T00:00:00Z',
      sourceVersions: {},
      entities: [
        { id: surfaceEntityId(UNKNOWN_CODE, 'a'), kind: 'surface', label: 'a' },
        { id: 'x:char:a', kind: 'character' },
        { id: 'x:pron:a', kind: 'pronunciation', label: 'a' },
        { id: 'x:pattern:q', kind: 'grammar-pattern', grammar: { meaning: 'marks compounds', level: 1 } },
      ] satisfies GraphEntity[],
      relations: [
        { from: 'x:char:a', to: 'x:pron:a', type: 'has-reading' },
        { from: 'x:char:a', to: surfaceEntityId(UNKNOWN_CODE, 'a'), type: 'component-of' },
        { from: surfaceEntityId(UNKNOWN_CODE, 'a'), to: 'x:pron:a', type: 'has-pronunciation' },
      ],
    });
    const capabilities = learnableTargetsFor(graph, [...graph.nodes.values()])
      .map((target) => target.capability)
      .sort();
    // Exactly the capabilities the structure supplies — nothing fabricated for
    // the language, nothing withheld because the language is unknown.
    expect(capabilities).toEqual([
      'character-reading',
      'grammar-comprehension',
      'grammar-formation',
      'grammar-production',
      'grammar-recognition',
      'pronunciation-production',
      'surface-reading',
      'surface-recognition',
    ]);
  });

  it('feeds caller-decomposed analyses to prediction regardless of language identity', () => {
    const graph = loadLinguisticGraph({
      schemaVersion: 1 as const,
      language: UNKNOWN_CODE,
      generatedAt: '2026-09-05T00:00:00Z',
      sourceVersions: {},
      entities: [{ id: 'x:surface:unseen', kind: 'surface' as const }],
      relations: [],
    });
    const lexicon = createCompoundLexicon([{ lemma: 'zor' }, { lemma: 'mek' }], unfamiliarStrategy.locale);
    const analysis = decomposeCompound('Zorqmek', lexicon, unfamiliarStrategy)!;
    const prediction = predictTargetAccessibility({
      graph,
      direct: null,
      target: { entityId: 'x:surface:unseen', capability: 'sense-recognition' },
      classify: () => 'unknown',
      compound: { analysis, isKnownPart: (lemma) => lemma === 'zor' },
    });
    expect(prediction.kind).toBe('prediction');
    expect(prediction.supportPath.some((hop) => hop.via === 'generated-compound')).toBe(true);
  });

  it('runtime parses correspond 1:1 to the graph component-of vocabulary builders emit', () => {
    // What a Python builder emits for an ATTESTED compound: surface entities +
    // component-of relations. The runtime splitter computes the identical
    // structure for unseen forms — same vocabulary, no parallel model.
    const graph = loadLinguisticGraph({
      schemaVersion: 1 as const,
      language: UNKNOWN_CODE,
      generatedAt: '2026-09-05T00:00:00Z',
      sourceVersions: {},
      entities: [
        { id: surfaceEntityId(UNKNOWN_CODE, 'zor'), kind: 'surface', label: 'zor' },
        { id: surfaceEntityId(UNKNOWN_CODE, 'mek'), kind: 'surface', label: 'mek' },
        { id: surfaceEntityId(UNKNOWN_CODE, 'zorqmek'), kind: 'surface', label: 'zorqmek' },
      ],
      relations: [
        { from: surfaceEntityId(UNKNOWN_CODE, 'zor'), to: surfaceEntityId(UNKNOWN_CODE, 'zorqmek'), type: 'component-of' },
        { from: surfaceEntityId(UNKNOWN_CODE, 'mek'), to: surfaceEntityId(UNKNOWN_CODE, 'zorqmek'), type: 'component-of' },
      ],
    });
    const graphComponents = relationsOf(graph, surfaceEntityId(UNKNOWN_CODE, 'zorqmek'), { direction: 'in' })
      .filter((relation) => relation.type === 'component-of')
      .map((relation) => graph.nodes.get(relation.from)?.label)
      .sort();
    const lexicon = createCompoundLexicon([{ lemma: 'zor' }, { lemma: 'mek' }], unfamiliarStrategy.locale);
    const parseLeaves = decomposeCompound('Zorqmek', lexicon, unfamiliarStrategy)!
      .parts.flatMap((part) => (part.parts ? part.parts : [part]))
      .map((part) => part.lemma.toLocaleLowerCase(unfamiliarStrategy.locale))
      .sort();
    expect(parseLeaves).toEqual(graphComponents);
  });

  it('serves a structurally different morphology from graph structure alone', () => {
    // Root-and-pattern (templatic) morphology: morpheme entities compose the
    // surface via component-of edges. The package declares NO splitting
    // strategy — productive concatenative splitting is correctly unavailable —
    // yet the attested decomposition feature path works purely from graph
    // structure, with zero core changes.
    const surface = surfaceEntityId(UNKNOWN_CODE, 'kataba');
    const graph = loadLinguisticGraph({
      schemaVersion: 1 as const,
      language: UNKNOWN_CODE,
      generatedAt: '2026-09-05T00:00:00Z',
      sourceVersions: {},
      entities: [
        { id: surface, kind: 'surface', label: 'kataba' },
        { id: `${UNKNOWN_CODE}:morpheme:ktb`, kind: 'morpheme', label: 'k-t-b (root)' },
        { id: `${UNKNOWN_CODE}:morpheme:apattern`, kind: 'morpheme', label: 'a-a (pattern)' },
      ],
      relations: [
        { from: `${UNKNOWN_CODE}:morpheme:ktb`, to: surface, type: 'component-of' },
        { from: `${UNKNOWN_CODE}:morpheme:apattern`, to: surface, type: 'component-of' },
      ],
    });
    const analysis = attestedCompoundAnalysis(graph, surface);
    expect(analysis).toMatchObject({ source: 'attested', ambiguous: false });
    // component-of is a set: parts are compared order-independently; the
    // adapter sorts them deterministically, but ordering is not graph data.
    expect([...analysis!.parts.map((part) => part.lemma)].sort()).toEqual(['a-a (pattern)', 'k-t-b (root)']);
    expect([...analysis!.provenance.lexiconBasis].sort()).toEqual([
      `${UNKNOWN_CODE}:morpheme:apattern`,
      `${UNKNOWN_CODE}:morpheme:ktb`,
    ]);
    // Productive splitting stays unavailable — capability absence, not identity.
    const morphologyOnly: LanguageData = { name: 'Test-Agnostic' };
    expect(languageSupportsCompoundSplitting(morphologyOnly)).toBe(false);
    // Prediction consumes the graph-attested analysis.
    const prediction = predictTargetAccessibility({
      graph,
      direct: null,
      target: { entityId: surface, capability: 'sense-recognition' },
      classify: () => 'unknown',
      compound: { analysis: analysis!, isKnownPart: () => true },
    });
    expect(prediction.supportPath).toHaveLength(2);
    expect(prediction.supportPath.every((hop) => hop.via === 'attested-compound')).toBe(true);
  });
});
