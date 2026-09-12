import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCompact, decodeCompact } from '../../../src/shared/graph/compact';
import { collectEntryContent, repairJitendexGraph } from './repair-jitendex-graph';

function fixture() {
  return encodeCompact({ schemaVersion: 1, language: 'ja', generatedAt: '2026-08-31', sourceVersions: { dictionary: 'jitendex-test' },
    entities: [
      { id: 'ja:entry:1', kind: 'dictionary-entry', label: 'word' },
      { id: 'ja:sense:1:1', kind: 'sense', label: 'arbitrary package property' },
      { id: 'ja:sense:1:2', kind: 'sense', label: 'actual meaning' },
      { id: 'ja:pos:custom-code', kind: 'grammar-pattern', label: 'custom-code' },
      { id: 'ja:surface:other', kind: 'surface', label: 'other spelling' },
    ],
    relations: [
      { from: 'ja:entry:1', to: 'ja:sense:1:1', type: 'has-sense', provenance: 'jitendex', order: 1 },
      { from: 'ja:entry:1', to: 'ja:sense:1:2', type: 'has-sense', provenance: 'jitendex', order: 2 },
      { from: 'ja:entry:1', to: 'ja:pos:custom-code', type: 'has-pos', provenance: 'jitendex' },
      { from: 'ja:surface:other', to: 'ja:entry:1', type: 'realizes', provenance: 'jitendex' },
    ],
  });
}

const row = (gloss = 'actual meaning', code = 'custom-code') => ['word', 'reading', '', '', 0, [
  { data: { code }, content: 'arbitrary package property' },
  { data: { content: 'glossary' }, content: gloss },
], 1];

test('repair removes only proven misclassified links in both directions, retaining every target', () => {
  const asset = fixture();
  const snapshot = structuredClone(asset);
  const { repaired, audit, removedEdges } = repairJitendexGraph(asset, collectEntryContent([[row()]]));
  assert.equal(audit.length, 1);
  assert.equal(removedEdges, 2);
  assert.deepEqual(audit[0].grammarTargetIds, ['ja:pos:custom-code']);
  assert.deepEqual(asset, snapshot);
  assert.deepEqual(repaired.entities, asset.entities);
  assert.deepEqual(repaired.stringTable, asset.stringTable);
  assert.deepEqual(repaired.meta, asset.meta);
  const graph = decodeCompact(repaired);
  assert.ok(graph.has('ja:sense:1:1'));
  assert.equal(graph.relationOffsets[graph.denseOf.get('ja:sense:1:1')! + 1] - graph.relationOffsets[graph.denseOf.get('ja:sense:1:1')!], 0);
  assert.ok(graph.has('ja:surface:other'));
  assert.equal(repaired.relations.orders?.filter((order) => order === 2).length, 2);
  const second = repairJitendexGraph(repaired, collectEntryContent([[row()]]));
  assert.equal(second.removedEdges, 0);
  assert.deepEqual(second.repaired, repaired);
});

test('a real glossary match in another reading row is preserved', () => {
  const result = repairJitendexGraph(fixture(), collectEntryContent([[row()], [row('arbitrary package property')]]));
  assert.equal(result.removedEdges, 0);
});

test('a badge without its existing grammar relation is not enough evidence to repair', () => {
  const result = repairJitendexGraph(fixture(), collectEntryContent([[row('actual meaning', 'different-code')]]));
  assert.equal(result.removedEdges, 0);
});

test('ordinary text outside a structured badge is not classified by its label', () => {
  const plain = ['word', 'reading', '', '', 0, ['arbitrary package property'], 1];
  assert.equal(repairJitendexGraph(fixture(), collectEntryContent([[plain]])).removedEdges, 0);
});
