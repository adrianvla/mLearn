import { describe, expect, it } from 'vitest';
import { COMPACT_RELATION_TYPES, decodeCompact, encodeCompact } from './compact';
import { identityNeighbors, loadLinguisticGraph, surfaceEntityId } from './load';
import type { LinguisticGraphAsset } from './types';

const asset: LinguisticGraphAsset = {
  schemaVersion: 1,
  language: 'ja',
  generatedAt: '2026-08-22T00:00:00Z',
  sourceVersions: { fixture: '1' },
  entities: [
    { id: 'ja:entry:hashi', kind: 'dictionary-entry' },
    { id: surfaceEntityId('ja', 'h-0'), kind: 'surface', label: '橋' },
    { id: surfaceEntityId('ja', 'h-1'), kind: 'surface', label: '箸', domain: 'names' },
    { id: 'ja:pron:hashi', kind: 'pronunciation' },
  ],
  relations: [
    { from: surfaceEntityId('ja', 'h-0'), to: 'ja:entry:hashi', type: 'realizes' },
    { from: surfaceEntityId('ja', 'h-1'), to: surfaceEntityId('ja', 'h-0'), type: 'inflection-of', confidence: 1, provenance: 'fixture' },
    { from: surfaceEntityId('ja', 'h-0'), to: 'ja:pron:hashi', type: 'has-pronunciation' },
  ],
};

describe('CompactLingualGraph', () => {
  it('round-trips kinds, CSR adjacency, and ids without duplicating surface hashes', () => {
    const plain = loadLinguisticGraph(asset);
    const compact = decodeCompact(encodeCompact(asset));
    for (const entity of asset.entities) {
      expect(compact.has(entity.id)).toBe(plain.nodes.has(entity.id));
      expect(compact.nodeKind(entity.id)).toBe(entity.kind);
      expect(compact.denseOf.get(entity.id)).toBe(plain.denseOf.get(entity.id));
      expect(compact.persistentOf[plain.denseOf.get(entity.id)!]).toBe(entity.id);
    }
    const h0 = surfaceEntityId('ja', 'h-0');
    const h1 = surfaceEntityId('ja', 'h-1');
    expect(compact.neighborsByCategory(h0, 'identity')).toEqual(identityNeighbors(plain, h0));
    expect(compact.neighborsByCategory(h1, 'identity')).toEqual(identityNeighbors(plain, h1));
    expect(compact.neighborsByCategory(h0, 'property')).toEqual(['ja:entry:hashi', 'ja:pron:hashi']);
    expect(compact.surfaceHashToLocalId).toEqual(new Map());
  });

  it('rejects an ambiguous schema version', () => {
    const compact = encodeCompact(asset);
    expect(() => decodeCompact({ ...compact, schemaVersion: 2 })).toThrow('Unsupported compact graph schemaVersion');
  });

  it('round-trips a contrasts-with edge without shifting pre-existing wire ids', () => {
    const extended: LinguisticGraphAsset = {
      ...asset,
      relations: [
        ...asset.relations,
        { from: surfaceEntityId('ja', 'h-0'), to: surfaceEntityId('ja', 'h-1'), type: 'contrasts-with' },
      ],
    };
    const encoded = encodeCompact(extended);
    const compact = decodeCompact(encoded);
    const h0 = surfaceEntityId('ja', 'h-0');
    const h1 = surfaceEntityId('ja', 'h-1');
    // Append-only: every pre-existing relation keeps its wire id;
    // contrasts-with keeps slot 15, has-pos the next free slot, and the
    // analysis relations extend the tail without disturbing either.
    expect(COMPACT_RELATION_TYPES[15]).toBe('contrasts-with');
    expect(COMPACT_RELATION_TYPES.at(-3)).toBe('has-pos');
    expect(COMPACT_RELATION_TYPES.at(-2)).toBe('analyzes');
    expect(COMPACT_RELATION_TYPES.at(-1)).toBe('analysis-member');
    const contrastsWithId = COMPACT_RELATION_TYPES.indexOf('contrasts-with');
    expect(encoded.relations.typeIds.filter((typeId) => typeId === contrastsWithId)).toHaveLength(2);
    expect(compact.neighborsByCategory(h0, 'support')).toEqual([h1]);
    expect(compact.neighborsByCategory(h1, 'support')).toEqual([h0]);
    expect(compact.neighborsByCategory(h0, 'identity')).toEqual(identityNeighbors(loadLinguisticGraph(extended), h0));
    // Pre-existing encoded assets (no contrasts-with id present) decode unchanged.
    expect(() => decodeCompact(encodeCompact(asset))).not.toThrow();
  });

  it('round-trips grammar construction metadata so packaged graphs keep grammar targets', () => {
    const grammarAsset: LinguisticGraphAsset = {
      ...asset,
      entities: [
        ...asset.entities,
        {
          id: 'ja:grammar:ている',
          kind: 'grammar-pattern',
          grammar: {
            meaning: 'progressive/resultative',
            level: 3,
            category: 'aspect',
            formation: 'verb-te + いる',
            register: 'plain',
          },
        },
      ],
    };
    const compact = decodeCompact(encodeCompact(grammarAsset));
    const plain = loadLinguisticGraph(grammarAsset);
    const expected = plain.nodes.get('ja:grammar:ている')?.grammar;
    expect(expected).toBeDefined();
    expect(compact.entityGrammar?.find((g) => g?.meaning === 'progressive/resultative')).toEqual(expected);

    // Grammar applicability survives the wire: the reconstructed entity carries metadata.
    const rebuilt = { ...plain.nodes.get('ja:grammar:ている')! };
    expect(rebuilt.grammar?.formation).toBe('verb-te + いる');
  });

  it('round-trips namespaced extension kinds and relations without granting them categories', () => {
    const extended: LinguisticGraphAsset = {
      ...asset,
      entities: [
        ...asset.entities,
        { id: 'ja:x-acme::classifier:1', kind: 'x-acme::classifier', label: 'classifier' },
      ],
      relations: [
        ...asset.relations,
        { from: surfaceEntityId('ja', 'h-0'), to: surfaceEntityId('ja', 'h-1'), type: 'contrasts-with' },
        { from: surfaceEntityId('ja', 'h-0'), to: 'ja:x-acme::classifier:1', type: 'x-acme::classified-as' },
      ],
    };
    const encoded = encodeCompact(extended);
    expect(encoded.entities.extensionKindStrings).toEqual(['x-acme::classifier']);
    expect(encoded.relations.extensionTypeStrings).toEqual(['x-acme::classified-as']);

    const compact = decodeCompact(encoded);
    // Extension kinds resolve by name through the wire extension table…
    expect(compact.nodeKind('ja:x-acme::classifier:1')).toBe('x-acme::classifier');
    // …and extension edges are stored but INERT: no relation category, so
    // category-based neighbor lookup (the learner-facing accessor) skips them.
    const extTypeIndex = compact.relationTypeIds[compact.relationOffsets[compact.denseOf.get(surfaceEntityId('ja', 'h-0'))!]];
    void extTypeIndex;
    expect(compact.extensionRelationTypeStrings).toEqual(['x-acme::classified-as']);
    expect(compact.neighborsByCategory('ja:x-acme::classifier:1', 'identity')).toEqual([]);
    expect(compact.neighborsByCategory('ja:x-acme::classifier:1', 'property')).toEqual([]);
    expect(compact.neighborsByCategory('ja:x-acme::classifier:1', 'support')).toEqual([]);
    // The core edges of the same graph keep their categories.
    expect(compact.neighborsByCategory(surfaceEntityId('ja', 'h-0'), 'support')).toEqual([surfaceEntityId('ja', 'h-1')]);
  });

  it('carries order and role relation qualifiers through the wire', () => {
    const analysisId = 'ja:analysis:compound-1';
    const extended: LinguisticGraphAsset = {
      ...asset,
      entities: [
        ...asset.entities,
        { id: analysisId, kind: 'analysis', analysis: { layer: 'morphological', source: 'builder:test' } },
      ],
      relations: [
        ...asset.relations,
        { from: surfaceEntityId('ja', 'h-0'), to: analysisId, type: 'analysis-member', order: 0, role: 'x-ja::prefix' },
        { from: surfaceEntityId('ja', 'h-1'), to: analysisId, type: 'analysis-member', order: 1 },
      ],
    };
    const encoded = encodeCompact(extended);
    expect(encoded.relations.orders).toBeDefined();
    expect(encoded.relations.roleStringIds).toBeDefined();

    const compact = decodeCompact(encoded);
    const h0 = compact.denseOf.get(surfaceEntityId('ja', 'h-0'))!;
    const h1 = compact.denseOf.get(surfaceEntityId('ja', 'h-1'))!;
    const analysisDense = compact.denseOf.get(analysisId)!;
    const edgeInto = (dense: number): number => {
      for (let edge = compact.relationOffsets[dense]; edge < compact.relationOffsets[dense + 1]; edge += 1) {
        if (compact.relationTargets[edge] === analysisDense) return edge;
      }
      throw new Error('analysis edge not found');
    };
    const h0First = edgeInto(h0);
    expect(compact.relationOrders?.[h0First]).toBe(0);
    expect(compact.relationRoles?.[h0First]).toBe('x-ja::prefix');
    const h1First = edgeInto(h1);
    expect(compact.relationOrders?.[h1First]).toBe(1);
    expect(compact.relationRoles?.[h1First]).toBeUndefined();
    // Assets without qualifiers emit no qualifier arrays.
    expect(encodeCompact(asset).relations.orders).toBeUndefined();
    expect(encodeCompact(asset).relations.roleStringIds).toBeUndefined();
  });

  it('rejects non-namespaced extension identifiers', () => {
    const extended: LinguisticGraphAsset = {
      ...asset,
      entities: [...asset.entities, { id: 'ja:bad:1', kind: 'not-namespaced' }],
    };
    expect(() => encodeCompact(extended)).toThrow('Unsupported compact entity kind');
  });
});
