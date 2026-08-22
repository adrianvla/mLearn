import { describe, expect, it } from 'vitest';
import { diffGraphAssets } from './diff';
import {
  entitiesInDomains,
  grammarEntityId,
  GraphLoadError,
  identityNeighbors,
  loadLinguisticGraph,
  relationsOf,
  surfaceEntityId,
} from './load';
import { applicableCapabilities, learnableTargetsFor } from './targets';
import type { GraphEntity, LinguisticGraphAsset } from './types';

// Synthetic ja fixture encoding the brief's golden semantic cases. Surface
// localIds stand in for SHA-256 hashes; only structure matters here.
const JA: LinguisticGraphAsset = {
  schemaVersion: 1,
  language: 'ja',
  generatedAt: '2026-08-22T00:00:00Z',
  sourceVersions: { jmdict: '2026-01', kanjidic2: '2026-01' },
  entities: [
    // 橋 / 箸 / 端 — homophones: one shared pronunciation, never one lexeme.
    { id: 'ja:entry:hashi-bridge', kind: 'dictionary-entry' },
    { id: 'ja:entry:hashi-chopsticks', kind: 'dictionary-entry' },
    { id: 'ja:entry:hashi-edge', kind: 'dictionary-entry' },
    { id: surfaceEntityId('ja', 'h-0'), kind: 'surface', label: '橋' },
    { id: surfaceEntityId('ja', 'h-1'), kind: 'surface', label: '箸' },
    { id: surfaceEntityId('ja', 'h-2'), kind: 'surface', label: '端' },
    { id: 'ja:pron:hashi', kind: 'pronunciation' },
    // 増える / 殖える — one dictionary entry, two surfaces, support-only relation.
    { id: 'ja:entry:fueru', kind: 'dictionary-entry' },
    { id: surfaceEntityId('ja', 'f-0'), kind: 'surface', label: '増える' },
    { id: surfaceEntityId('ja', 'f-1'), kind: 'surface', label: '殖える' },
    { id: 'ja:sense:fueru-1', kind: 'sense' },
    // 食べる / 食べた — genuine inflectional identity.
    { id: surfaceEntityId('ja', 't-0'), kind: 'surface', label: '食べる' },
    { id: surfaceEntityId('ja', 't-1'), kind: 'surface', label: '食べた' },
    // 文体 with component support + pronunciation property.
    { id: surfaceEntityId('ja', 'b-0'), kind: 'surface', label: '文体' },
    { id: 'ja:char:文', kind: 'character' },
    { id: 'ja:char:体', kind: 'character' },
    { id: 'ja:pron:buntai', kind: 'pronunciation' },
    // Names domain must stay out of ordinary inference.
    { id: surfaceEntityId('ja', 'n-0'), kind: 'surface', label: '亀田', domain: 'names' },
  ],
  relations: [
    { from: surfaceEntityId('ja', 'h-0'), to: 'ja:entry:hashi-bridge', type: 'realizes' },
    { from: surfaceEntityId('ja', 'h-1'), to: 'ja:entry:hashi-chopsticks', type: 'realizes' },
    { from: surfaceEntityId('ja', 'h-2'), to: 'ja:entry:hashi-edge', type: 'realizes' },
    { from: surfaceEntityId('ja', 'h-0'), to: 'ja:pron:hashi', type: 'has-pronunciation' },
    { from: surfaceEntityId('ja', 'h-1'), to: 'ja:pron:hashi', type: 'has-pronunciation' },
    { from: surfaceEntityId('ja', 'h-2'), to: 'ja:pron:hashi', type: 'has-pronunciation' },

    { from: surfaceEntityId('ja', 'f-0'), to: 'ja:entry:fueru', type: 'realizes' },
    { from: surfaceEntityId('ja', 'f-1'), to: 'ja:entry:fueru', type: 'realizes' },
    {
      from: surfaceEntityId('ja', 'f-1'), to: surfaceEntityId('ja', 'f-0'),
      type: 'orthographic-variant-of', confidence: 1, transparency: 0.9, provenance: 'jmdict-same-entry',
    },
    { from: 'ja:entry:fueru', to: 'ja:sense:fueru-1', type: 'has-sense' },

    { from: surfaceEntityId('ja', 't-1'), to: surfaceEntityId('ja', 't-0'), type: 'inflection-of', provenance: 'tokenizer-lemma' },

    { from: surfaceEntityId('ja', 'b-0'), to: 'ja:pron:buntai', type: 'has-pronunciation' },
    { from: 'ja:char:文', to: surfaceEntityId('ja', 'b-0'), type: 'component-of' },
    { from: 'ja:char:体', to: surfaceEntityId('ja', 'b-0'), type: 'component-of' },
  ],
};

function load(): ReturnType<typeof loadLinguisticGraph> {
  return loadLinguisticGraph(JA);
}

describe('linguistic graph golden semantics', () => {
  it('never merges homophone surfaces sharing a pronunciation (橋/箸/端)', () => {
    const graph = load();
    const bridge = surfaceEntityId('ja', 'h-0');
    const chopsticks = surfaceEntityId('ja', 'h-1');
    // Shared pronunciation node is a property target, not an identity edge.
    expect(identityNeighbors(graph, bridge)).toEqual([]);
    expect(identityNeighbors(graph, chopsticks)).toEqual([]);
    expect(graph.nodes.get(bridge)?.kind).toBe('surface');
    expect(graph.nodes.get(chopsticks)?.kind).toBe('surface');
  });

  it('keeps 増える/殖える independently learnable: same entry, support-not-identity', () => {
    const graph = load();
    const fueru = surfaceEntityId('ja', 'f-0');
    const shoku = surfaceEntityId('ja', 'f-1');
    const relations = relationsOf(graph, fueru, { category: 'identity' });
    expect(relations).toHaveLength(0);
    const support = relationsOf(graph, fueru, { category: 'support' });
    expect(support).toHaveLength(1);
    expect(support[0].type).toBe('orthographic-variant-of');
    expect(graph.nodes.get(shoku)).toBeDefined();
  });

  it('treats 食べた → 食べる as genuine inflectional identity without fabricating observations', () => {
    const graph = load();
    const ta = surfaceEntityId('ja', 't-1');
    const neighbors = identityNeighbors(graph, ta);
    expect(neighbors).toEqual([surfaceEntityId('ja', 't-0')]);
  });

  it('derives applicability from graph structure, not language names', () => {
    const graph = load();
    const buntai = graph.nodes.get(surfaceEntityId('ja', 'b-0'))!;
    // Pronunciation present → reading targets exist; components are support-only.
    expect(applicableCapabilities(graph, buntai)).toContain('surface-reading');
    const wen = graph.nodes.get('ja:char:文')!;
    // No has-reading edges in this fixture → no CharacterReading capability yet.
    expect(applicableCapabilities(graph, wen)).toEqual([]);
    const grammar = graph.nodes.get(grammarEntityId('ja', 'ている')) ?? null;
    expect(grammar).toBeNull(); // absent from fixture → no fabricated targets
  });

  it('emits sense targets only through real has-sense structure', () => {
    const graph = load();
    const targets = learnableTargetsFor(graph, entitiesInDomains(graph, ['common']));
    const senseTargets = targets.filter((target) => target.capability === 'sense-recognition');
    // Exactly the one real sense node; no surface fabricates its own sense target.
    expect(senseTargets).toEqual([{ entityId: 'ja:sense:fueru-1', capability: 'sense-recognition' }]);
  });

  it('excludes specialized domains from ordinary candidate sets by default', () => {
    const graph = load();
    const commonIds = new Set(entitiesInDomains(graph, ['common']).map((entity) => entity.id));
    expect(commonIds.has(surfaceEntityId('ja', 'n-0'))).toBe(false);
  });

  it('rejects unsupported schema versions and dangling relations', () => {
    expect(() => loadLinguisticGraph({ ...JA, schemaVersion: 99 as unknown as 1 })).toThrow(GraphLoadError);
    expect(() => loadLinguisticGraph({
      ...JA,
      relations: [...JA.relations, { from: 'ja:ghost', to: 'ja:char:文', type: 'component-of' }],
    })).toThrow(GraphLoadError);
  });

  it('reports added/removed/changed/ambiguous identity drift between builds', () => {
    const entities: GraphEntity[] = [
      ...JA.entities,
      { id: 'ja:new', kind: 'surface' },
    ];
    const next: LinguisticGraphAsset = {
      ...JA,
      entities: entities
        .map((entity) => (entity.id === 'ja:entry:fueru' ? { ...entity, kind: 'lexeme' as const } : entity))
        .map((entity) => (entity.id === 'ja:char:文' ? { ...entity, label: 'wen' } : entity))
        .filter((entity) => entity.id !== 'ja:char:体'),
    };
    const diff = diffGraphAssets(JA, next);
    expect(diff.added).toEqual(['ja:new']);
    expect(diff.removed).toEqual(['ja:char:体']);
    expect(diff.changed).toEqual(['ja:char:文']);
    expect(diff.ambiguous).toEqual(['ja:entry:fueru']);
  });
});
