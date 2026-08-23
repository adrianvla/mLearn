import { describe, expect, it } from 'vitest';
import { decodeCompact, encodeCompact } from './compact';
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
});
