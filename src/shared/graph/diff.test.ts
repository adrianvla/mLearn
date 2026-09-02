import { describe, expect, it } from 'vitest';

import { diffCompactGraphAssets, diffGraphAssets, diffGraphEntityIdentity } from './diff';
import type { CompactAssetJSON } from './compact';
import type { GraphDomain, GraphEntityKind, LinguisticGraphAsset } from './types';

function entity(id: string, kind: GraphEntityKind, extra: { domain?: GraphDomain; label?: string } = {}): { id: string; kind: GraphEntityKind; domain?: GraphDomain; label?: string } {
  return { id, kind, ...extra };
}

function asset(entities: Array<{ id: string; kind: GraphEntityKind; domain?: GraphDomain; label?: string }>): LinguisticGraphAsset {
  return {
    schemaVersion: 1,
    language: 'ja',
    generatedAt: '2026-01-01T00:00:00Z',
    sourceVersions: {},
    entities: entities as LinguisticGraphAsset['entities'],
    relations: [],
  };
}

/** Minimal valid CompactAssetJSON carrying ids in the string-table prefix. */
function compactAsset(entities: Array<{ id: string; kind: number; label?: string }>): CompactAssetJSON {
  const stringTable = [...entities.map((entry) => entry.id), ...entities.filter((entry) => entry.label).map((entry) => entry.label as string)];
  const labelOffset = entities.length;
  let labelIndex = 0;
  return {
    schemaVersion: 1,
    language: 'ja',
    generatedAt: '2026-01-01T00:00:00Z',
    sourceVersions: {},
    stringTable,
    entities: {
      kindIds: entities.map((entry) => entry.kind),
      domainIds: entities.map(() => 0),
      labelStringIds: entities.map((entry) => (entry.label ? labelOffset + labelIndex++ : -1)),
    },
    relations: {
      offsets: new Array(entities.length + 1).fill(0),
      targets: [],
      typeIds: [],
    },
    meta: {
      surfaceHashStringIds: [],
      surfaceLocalIds: [],
    },
  } as unknown as CompactAssetJSON;
}

// COMPACT_ENTITY_KINDS order: dictionary-entry, lexeme, surface, sense, …
const KIND_SURFACE = 2;
const KIND_LEXEME = 1;
const KIND_SENSE = 3;

describe('diffGraphAssets', () => {
  it('detects added, removed, changed, and ambiguous entities', () => {
    const diff = diffGraphAssets(
      asset([
        entity('ja:surface:keep', 'surface'),
        entity('ja:surface:label-drift', 'surface', { label: 'old' }),
        entity('ja:surface:removed', 'surface'),
        entity('ja:sense:remapped', 'sense'),
      ]),
      asset([
        entity('ja:surface:keep', 'surface'),
        entity('ja:surface:label-drift', 'surface', { label: 'new' }),
        entity('ja:surface:added', 'surface'),
        entity('ja:sense:remapped', 'surface'),
      ]),
    );

    expect(diff).toEqual({
      added: ['ja:surface:added'],
      removed: ['ja:surface:removed'],
      changed: ['ja:surface:label-drift'],
      ambiguous: ['ja:sense:remapped'],
    });
  });

  it('reports no changes for identical entity sets', () => {
    const entities = [entity('ja:surface:a', 'surface', { domain: 'common', label: 'a' })];
    expect(diffGraphAssets(asset(entities), asset([...entities]))).toEqual({
      added: [],
      removed: [],
      changed: [],
      ambiguous: [],
    });
  });

  it('diffs plain entity lists identically to full assets', () => {
    const prev = [entity('a', 'surface'), entity('b', 'sense')];
    const next = [entity('a', 'lexeme'), entity('c', 'sense')];
    expect(diffGraphEntityIdentity(prev, next)).toEqual(diffGraphAssets(asset(prev), asset(next)));
  });
});

describe('diffCompactGraphAssets', () => {
  it('flags same-id kind changes as ambiguous without decoding relations', () => {
    const diff = diffCompactGraphAssets(
      compactAsset([
        { id: 'ja:surface:橋', kind: KIND_SURFACE },
        { id: 'ja:sense:1', kind: KIND_SENSE },
      ]),
      compactAsset([
        { id: 'ja:surface:橋', kind: KIND_LEXEME },
        { id: 'ja:sense:1', kind: KIND_SENSE },
      ]),
    );

    expect(diff.ambiguous).toEqual(['ja:surface:橋']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('treats kind-stable id sets as unambiguous even when labels change', () => {
    const diff = diffCompactGraphAssets(
      compactAsset([{ id: 'ja:surface:橋', kind: KIND_SURFACE }]),
      compactAsset([{ id: 'ja:surface:橋', kind: KIND_SURFACE, label: 'はし' }]),
    );

    expect(diff.ambiguous).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('throws on malformed identity tables so callers fail conservative', () => {
    const corrupt = { entities: { kindIds: [99] }, stringTable: ['x'] } as unknown as CompactAssetJSON;
    expect(() => diffCompactGraphAssets(compactAsset([]), corrupt)).toThrow(/invalid entity identity/);
    expect(() => diffCompactGraphAssets({ entities: {} } as unknown as CompactAssetJSON, compactAsset([]))).toThrow(/identity tables/);
  });
});
