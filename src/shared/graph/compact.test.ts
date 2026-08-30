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
    // Appended last: every pre-existing relation keeps its wire id, contrasts-with takes the next free slot.
    expect(COMPACT_RELATION_TYPES.at(-1)).toBe('contrasts-with');
    const contrastsWithId = COMPACT_RELATION_TYPES.length - 1;
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
});
