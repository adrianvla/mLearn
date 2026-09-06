import { describe, expect, it } from 'vitest';
import { compoundSplitterConfig, languageSupportsCompoundSplitting } from './languageFeatures';
import { getAvailableAspects } from './types';
import { attestedCompoundAnalysis } from './graph/morphology/attested';
import { createCompoundLexicon, decomposeCompound } from './graph/morphology/compounds';
import type { LanguageCompoundSplittingConfig, LanguageData } from './types';
import { loadLinguisticGraph, relationsOf, surfaceEntityId } from './graph/load';
import { learnableTargetsFor } from './graph/targets';
import type { GraphEntity, GraphRelation, GraphRelationType, CapabilityKind } from './graph/types';
import { predictTargetAccessibility } from './prediction/supportPredictor';
import { applicableCapabilities } from './graph/targets';
import { graphAnalysesFor } from './graph/morphology/attested';
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

  it('orders attested parts by code-unit, independent of host collation', () => {
    // 'ä' (U+00E4) sorts AFTER 'z' in code-unit order but BEFORE it in most
    // host locale collations — this fixture fails under bare localeCompare.
    const surface = surfaceEntityId(UNKNOWN_CODE, 'zcomp');
    const graph = loadLinguisticGraph({
      schemaVersion: 1 as const,
      language: UNKNOWN_CODE,
      generatedAt: '2026-09-05T00:00:00Z',
      sourceVersions: {},
      entities: [
        { id: surface, kind: 'surface' as const, label: 'zcomp' },
        { id: surfaceEntityId(UNKNOWN_CODE, 'zoo'), kind: 'surface' as const, label: 'zoo' },
        { id: surfaceEntityId(UNKNOWN_CODE, 'äther'), kind: 'surface' as const, label: 'äther' },
      ],
      relations: [
        { from: surfaceEntityId(UNKNOWN_CODE, 'äther'), to: surface, type: 'component-of' },
        { from: surfaceEntityId(UNKNOWN_CODE, 'zoo'), to: surface, type: 'component-of' },
      ],
    });
    const analysis = attestedCompoundAnalysis(graph, surface)!;
    // Insertion order is äther-first; code-unit order must put 'zoo' first.
    expect(analysis.parts.map((part) => part.lemma)).toEqual(['zoo', 'äther']);
  });
});

describe('package normalization, prosody, and categories through shared pipelines (x-test-agnostic)', () => {
  // After vi.resetModules-free static imports this block uses only shared
  // pipelines; if any of them ever demand language registration, these
  // assertions fail.
  const normalizedPackage: LanguageData = {
    name: 'Test-Agnostic normalized',
    textProcessing: {
      lexemeNormalization: {
        type: 'surface',
        surfaceScripts: ['Latn'],
        surfaceNormalizers: ['casefold'],
      },
    },
    prosody: { type: 'x-test-agnostic::pitch-length' },
  };

  it('derives the persisted primary form through package normalization', async () => {
    const { createWordFormDeriver } = await import('./utils/wordForms');
    const deriver = createWordFormDeriver(normalizedPackage, UNKNOWN_CODE);
    // The package's identity normalizers shape the persisted primary form…
    expect(deriver('XorqmeK')).toBe('xorqmek');
    // …and the persisted key composes the same derivation with the package's
    // script-conversion gate (none declared here → identity fold).
    const { canonicalKeyHash } = await import('./utils/canonicalWordKey');
    const key = canonicalKeyHash(UNKNOWN_CODE, deriver('XorqmeK'), {
      hashWord: (word) => `h(${word})`,
      languageData: normalizedPackage,
    });
    expect(key).toBe(`${UNKNOWN_CODE}:h(xorqmek)`);
  });

  it('declares a non-Japanese prosody model without any runtime knowledge of it', async () => {
    const { getLanguageProsodyType, languageSupportsProsody } = await import('./languageFeatures');
    expect(getLanguageProsodyType(normalizedPackage)).toBe('x-test-agnostic::pitch-length');
    expect(languageSupportsProsody(normalizedPackage)).toBe(true);
    const withoutProsody: LanguageData = { name: 'Test-Agnostic plain' };
    expect(languageSupportsProsody(withoutProsody)).toBe(false);
  });

  it('treats unfamiliar grammatical category values as package-owned vocabulary', async () => {
    const categorized: LanguageData = {
      name: 'Test-Agnostic categories',
      textProcessing: {
        partOfSpeech: {
          translatable: ['x-test-agnostic::noun-class-7', 'x-test-agnostic::motionspeaker'],
          colors: { 'x-test-agnostic::noun-class-7': '#7a5' },
        },
      },
    };
    const { getTranslatablePartOfSpeechTypes, isTranslatablePartOfSpeech } = await import('./languageFeatures');
    expect(getTranslatablePartOfSpeechTypes(categorized)).toEqual(['x-test-agnostic::noun-class-7', 'x-test-agnostic::motionspeaker']);
    expect(isTranslatablePartOfSpeech('x-test-agnostic::noun-class-7', categorized)).toBe(true);
    expect(isTranslatablePartOfSpeech('noun', categorized)).toBe(false);
  });
});

describe('open-world graph semantics (PART H guards)', () => {
  const LANG = 'x-thirdparty';
  const surface = `${LANG}:surface:gidis`;

  const loadFixture = (entities: GraphEntity[], relations: GraphRelation[]) => loadLinguisticGraph({
    schemaVersion: 1, language: LANG, generatedAt: '2026-09-06T00:00:00Z', sourceVersions: {},
    entities, relations,
  });

  it('keeps namespaced extension kinds and relations loadable, inspectable, and inert', () => {
    const graph = loadFixture(
      [
        { id: surface, kind: 'surface' as const, label: 'gidis' },
        { id: 'x-tp::classifier', kind: 'x-tp::classifier' as unknown as GraphEntityKind },
        { id: `${LANG}:lexeme:git`, kind: 'lexeme' as const, label: 'git' },
      ],
      [
        { from: 'x-tp::classifier', to: surface, type: 'x-tp::classifier-of' as unknown as GraphRelationType },
        { from: `${LANG}:lexeme:git`, to: surface, type: 'component-of' },
      ],
    );
    // Preserved through load: inspectable via relationsOf/nodes.
    const ext = relationsOf(graph, surface, { direction: 'in' }).filter((r) => r.type === ('x-tp::classifier-of' as GraphRelationType));
    expect(ext).toHaveLength(1);
    expect(graph.nodes.get('x-tp::classifier')?.kind).toBe('x-tp::classifier');
    // Inert for learning: no capability from the extension kind/relation.
    const entity = graph.nodes.get(surface)!;
    expect(applicableCapabilities(graph, entity).filter((c) => c === 'x-tp::recognition' as unknown as CapabilityKind)).toEqual([]);
    // Surface capability unchanged (composition edge only).
    expect(applicableCapabilities(graph, entity).filter((c) => c === 'surface-recognition' as unknown as CapabilityKind)).toHaveLength(1);
  });

  it('exposes ordered analysis nodes as competing assertions with no default capability', () => {
    // gidis = git + is(k)  — ordered morphological analysis of an agglutinative form.
    const analysisA = `${LANG}:analysis:ordered`;
    const analysisB = `${LANG}:analysis:alt`;
    const entities: GraphEntity[] = [
      { id: surface, kind: 'surface' as const, label: 'gidis' },
      { id: `${LANG}:morpheme:git`, kind: 'morpheme' as const, label: 'git', learnable: true },
      { id: `${LANG}:morpheme:isk`, kind: 'morpheme' as const, label: 'is(k)' },
      { id: analysisA, kind: 'analysis' as const, analysis: { layer: 'morphological', confidence: 0.9, source: 'builder:tp' } },
      { id: analysisB, kind: 'analysis' as const, analysis: { layer: 'morphological', confidence: 0.4, source: 'builder:tp-alt' } },
    ];
    const relations: GraphRelation[] = [
      { from: `${LANG}:morpheme:git`, to: analysisA, type: 'analysis-member' as unknown as GraphRelationType, order: 0 },
      { from: `${LANG}:morpheme:isk`, to: analysisA, type: 'analysis-member' as unknown as GraphRelationType, order: 1 },
      { from: `${LANG}:morpheme:git`, to: analysisB, type: 'analysis-member' as unknown as GraphRelationType, order: 0 },
      { from: analysisA, to: surface, type: 'analyzes' as unknown as GraphRelationType },
      { from: analysisB, to: surface, type: 'analyzes' as unknown as GraphRelationType },
    ];
    const graph = loadFixture(entities, relations);
    const analyses = graphAnalysesFor(graph, surface);
    expect(analyses).toHaveLength(2);
    // Ordered members, not label-sorted.
    expect(analyses[0]!.parts.map((p) => p.lemma)).toEqual(['git', 'is(k)']);
    // Analysis entities grant no learner capability.
    expect(applicableCapabilities(graph, graph.nodes.get(analysisA)!)).toEqual([]);
    // Opt-in morpheme capability is entity-declared.
    expect(applicableCapabilities(graph, graph.nodes.get(`${LANG}:morpheme:git`)!)).toEqual(['morpheme-recognition']);
    // Non-opt-in morpheme stays structural.
    expect(applicableCapabilities(graph, graph.nodes.get(`${LANG}:morpheme:isk`)!)).toEqual([]);
  });

  it('carries non-m/f/n grammatical categories without core assumptions', () => {
    // Swahili-style noun class (1/3) — not m/f/n.
    const graph = loadFixture(
      [
        { id: `${LANG}:lexeme:kitabu`, kind: 'lexeme' as const, label: 'kitabu' },
        { id: `${LANG}:class:3`, kind: 'grammar-pattern' as const, label: 'class 3' },
      ],
      [{ from: `${LANG}:lexeme:kitabu`, to: `${LANG}:class:3`, type: 'has-gender' }],
    );
    // The capability is granted structurally; the VALUE domain is package-owned.
    expect(applicableCapabilities(graph, graph.nodes.get(`${LANG}:lexeme:kitabu`)!)).toEqual(['gender']);
  });
});

