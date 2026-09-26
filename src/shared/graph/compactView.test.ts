import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { decodeCompact, encodeCompact } from './compact';
import { createCompactGraphView } from './compactView';
import { attestedCompoundAnalysis } from './morphology/attested';
import { surfacesRealizingEntry } from './addressing';
import { identityNeighbors, loadLinguisticGraph, relationsOf, entitiesInDomains, surfaceEntityId, type LingualGraph } from './load';
import type { GraphEntity, GraphRelation, LinguisticGraphAsset } from './types';

const hash = (surface: string): string =>
  crypto.createHash('sha256').update(surface).digest('hex');

const asset: LinguisticGraphAsset = {
  schemaVersion: 1,
  language: 'ja',
  generatedAt: '2026-01-01T00:00:00.000Z',
  sourceVersions: { jmnedict: 'test' },
  entities: [
    { id: surfaceEntityId('ja', hash('猫')), kind: 'surface', label: '猫' },
    { id: 'ja:dictionary-entry:neko', kind: 'dictionary-entry', label: '猫', domain: 'common' },
    { id: 'ja:sense:neko-1', kind: 'sense', label: 'cat' },
    { id: 'ja:lexeme:neko', kind: 'lexeme', label: 'ねこ' },
    { id: 'ja:dictionary-entry:neko-compound', kind: 'dictionary-entry', label: '飼い猫', domain: 'common' },
    { id: 'ja:pronunciation:neko-hi', kind: 'pronunciation', label: 'ひ' },
    { id: 'ja:grammar:ている', kind: 'grammar-pattern', label: 'ている', grammar: { meaning: 'progressive', level: 5, recognitionRules: [{ type: 'text', text: 'ている' }] } },
    { id: 'ja:analysis:compound-1', kind: 'analysis', analysis: { layer: 'morphological', source: 'builder:test' } },
    { id: 'ja:x-test::classifier:1', kind: 'x-test::classifier', label: 'classifier' },
    { id: surfaceEntityId('ja', hash('文')), kind: 'character', label: '文', domain: 'names' },
  ],
  relations: [
    { from: 'ja:dictionary-entry:neko', to: surfaceEntityId('ja', hash('猫')), type: 'realizes', confidence: 0.9, provenance: 'jmdict' },
    { from: 'ja:dictionary-entry:neko', to: 'ja:sense:neko-1', type: 'has-sense' },
    { from: 'ja:lexeme:neko', to: 'ja:dictionary-entry:neko', type: 'lemma-of' },
    { from: 'ja:pronunciation:neko-hi', to: surfaceEntityId('ja', hash('猫')), type: 'has-pronunciation' },
    { from: surfaceEntityId('ja', hash('猫')), to: 'ja:dictionary-entry:neko-compound', type: 'component-of', order: 1, role: 'x-ja::head' },
    { from: surfaceEntityId('ja', hash('文')), to: surfaceEntityId('ja', hash('猫')), type: 'x-test::composes', confidence: 0.5 },
    { from: 'ja:grammar:ている', to: 'ja:lexeme:neko', type: 'contrasts-with' },
    { from: 'ja:analysis:compound-1', to: 'ja:dictionary-entry:neko-compound', type: 'analyzes' },
    { from: 'ja:analysis:compound-1', to: 'ja:dictionary-entry:neko', type: 'analysis-member', order: 0, role: 'x-ja::prefix' },
    { from: 'ja:analysis:compound-1', to: surfaceEntityId('ja', hash('文')), type: 'analysis-member', order: 1 },
  ],
};

function buildAll(): { plain: LingualGraph; view: LingualGraph } {
  const plain = loadLinguisticGraph(asset);
  const view = createCompactGraphView(decodeCompact(encodeCompact(asset)), 'ja');
  return { plain, view };
}

const canonical = (relations: GraphRelation[]): string[] =>
  relations.map((relation) => JSON.stringify({
    ...relation,
    ...(relation.confidence !== undefined ? { confidence: Math.fround(relation.confidence) } : {}),
  })).sort();

describe('compact graph view parity with the plain graph', () => {
  const surface = surfaceEntityId('ja', hash('猫'));

  it('exposes identical entities (kind, label, domain, grammar, analysis)', () => {
    const { plain, view } = buildAll();
    for (const entity of asset.entities) {
      expect(view.nodes.get(entity.id)).toEqual(plain.nodes.get(entity.id));
    }
    expect(view.nodes.get('missing')).toBeUndefined();
    expect(view.nodes.has(surface)).toBe(true);
    expect(view.nodes.has('missing')).toBe(false);
    expect(view.nodes.size).toBe(plain.nodes.size);
  });

  it('retains authored relation direction while serving symmetric neighbor lookup', () => {
    const { plain, view } = buildAll();
    for (const entity of asset.entities) {
      expect(canonical(relationsOf(view, entity.id, { direction: 'out' })))
        .toEqual(canonical(relationsOf(plain, entity.id, { direction: 'out' })));
      expect(canonical(relationsOf(view, entity.id, { direction: 'in' })))
        .toEqual(canonical(relationsOf(plain, entity.id, { direction: 'in' })));
    }
    expect(relationsOf(view, surface, { direction: 'in' }).some((relation) => relation.type === 'component-of')).toBe(false);
  });

  it('preserves per-edge qualifiers (confidence, provenance, order, role) per node slice', () => {
    const { view } = buildAll();
    const entryId = 'ja:dictionary-entry:neko';
    const memberEdges = relationsOf(view, entryId, { direction: 'in' })
      .filter((relation) => relation.type === 'analysis-member');
    // The analysis asserts members INTO the entry — in-scans resolve them
    // with asserted order and namespaced role intact.
    expect(memberEdges).toContainEqual({
      from: 'ja:analysis:compound-1', to: entryId, type: 'analysis-member', order: 0, role: 'x-ja::prefix',
    });
  });

  it('resolves attested compound parts through the in-direction scan', () => {
    const { view } = buildAll();
    const compoundId = 'ja:dictionary-entry:neko-compound';
    const parts = relationsOf(view, compoundId, { direction: 'in' })
      .filter((relation) => relation.type === 'component-of')
      .map((relation) => view.nodes.get(relation.from)?.label);
    expect(parts).toContain('猫');
  });

  it('matches identity neighbors and domain scans', () => {
    const { plain, view } = buildAll();
    // No identity-category edges in this fixture: both graphs resolve none.
    expect(identityNeighbors(view, surface)).toEqual(identityNeighbors(plain, surface));
    expect(entitiesInDomains(view, ['common']).map((entity) => entity.id))
      .toEqual(entitiesInDomains(plain, ['common']).map((entity) => entity.id));
  });

  it('exposes the dense id bookkeeping the prediction pipeline reads', () => {
    const { plain, view } = buildAll();
    expect([...view.denseOf.entries()]).toEqual([...plain.denseOf.entries()]);
    expect([...view.persistentOf]).toEqual([...plain.persistentOf]);
    expect(view.nodes.values().next().value).toEqual(plain.nodes.values().next().value);
  });

  it('finds sibling surfaces from an authored entry-to-surface realizes edge', () => {
    const { plain, view } = buildAll();
    const entryId = 'ja:dictionary-entry:neko';
    expect(surfacesRealizingEntry(plain, entryId)).toEqual([surface]);
    expect(surfacesRealizingEntry(view, entryId)).toEqual([surface]);
  });

  it('does not infer compound structure from a legacy asset with no authored directions', () => {
    const compoundAsset: LinguisticGraphAsset = {
      schemaVersion: 1,
      language: 'xx',
      generatedAt: '2026-01-01',
      sourceVersions: {},
      entities: [
        { id: 'xx:surface:a', kind: 'surface', label: 'a' },
        { id: 'xx:surface:b', kind: 'surface', label: 'b' },
        { id: 'xx:surface:ab', kind: 'surface', label: 'ab' },
      ],
      relations: [
        { from: 'xx:surface:a', to: 'xx:surface:ab', type: 'component-of' },
        { from: 'xx:surface:b', to: 'xx:surface:ab', type: 'component-of' },
      ],
    };
    const encoded = encodeCompact(compoundAsset);
    const current = createCompactGraphView(decodeCompact(encoded), 'xx');
    expect(attestedCompoundAnalysis(current, 'xx:surface:ab')?.parts.map((part) => part.lemma)).toEqual(['a', 'b']);

    const legacy = createCompactGraphView(decodeCompact({
      ...encoded,
      relations: { ...encoded.relations, directions: undefined },
    }), 'xx');
    expect(attestedCompoundAnalysis(legacy, 'xx:surface:ab')).toBeNull();
  });
});
