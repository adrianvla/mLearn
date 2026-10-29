import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GraphPage, GraphQuery, LinguisticEntity } from '@mlearn/contracts';
import { createRuntimeClient } from '../src/client.ts';

function fixture(): { query: GraphQuery; page: GraphPage } {
  const packageId = 'org.example';
  const capability = { id: `${packageId}:meaning`, label: 'Meaning' };
  const entity: LinguisticEntity = {
    id: 'entity:root', kind: { id: `${packageId}:unknown-kind`, label: 'Package entity', color: null, attribution: 'Lexicon' },
    label: 'Root', targetId: 'target:root', capabilities: [capability],
    properties: [{ id: `${packageId}:unknown-feature`, label: 'Package feature',
      value: { nested: [{ label: 'retained', weight: 0.25 }] }, attribution: 'Lexicon' }],
    attribution: 'Lexicon',
  };
  const related = { ...entity, id: 'entity:other', targetId: 'target:other', label: 'Other' };
  const revision = 'a'.repeat(64);
  return {
    query: { packageId, targetId: 'target:root', expectedRevision: revision, after: null },
    page: {
      packageId, packageVersion: '1', packageRevision: revision, entity,
      connections: ['edge:a', 'edge:b'].map(id => ({
        entity: related, relation: {
          id, category: 'support', predicate: { id: `${packageId}:unknown-relation`,
            label: 'Package support', color: null, attribution: 'Lexicon' },
          from: entity.id, to: related.id, qualifiers: [], attribution: 'Lexicon',
        },
      })),
      knowledge: ['target:root', 'target:other'].map((targetId, index) => ({
        key: { packageId, targetId, capability: capability.id },
        claim: index === 0 ? true : null, assessed: null, prediction: null,
        revision: 1, status: index === 0 ? 'claimed_known' : 'untracked',
      })),
      next: { identity: 'b'.repeat(64), after: '16' },
    },
  };
}

test('graph transport preserves unknown package data and parallel edges while rejecting foreign or incomplete target projections', async () => {
  const { query, page } = fixture();
  let packet: unknown = page;
  const client = createRuntimeClient({
    commandId: () => 'unused', execute: async () => JSON.stringify({ type: 'graph_neighborhood', page: packet }),
  });
  assert.deepEqual(await client.graphNeighborhood(query), page);
  packet = { ...page, connections: page.connections.map((connection, index) => index === 0 ? connection : {
    ...connection, entity: { ...connection.entity, properties: [{
      ...connection.entity.properties[0],
      value: { nested: [{ weight: 0.25, label: 'retained' }] },
    }] },
  }) };
  assert.deepEqual(await client.graphNeighborhood(query), packet);
  const connection = page.connections[0];
  for (const invalid of [
    { ...page, packageId: 'foreign' },
    { ...page, packageRevision: 'c'.repeat(64) },
    { ...page, entity: { ...page.entity, targetId: 'foreign-target' } },
    { ...page, entity: { ...page.entity, targetId: null } },
    { ...page, connections: [{ ...connection, relation: { ...connection.relation, from: 'foreign-entity' } }] },
    { ...page, connections: [connection, connection] },
    { ...page, connections: [connection, { ...page.connections[1],
      entity: { ...connection.entity, targetId: page.entity.targetId } }] },
    { ...page, connections: [connection, { ...page.connections[1],
      entity: { ...connection.entity, label: 'Conflicting label' } }] },
    { ...page, connections: Array.from({ length: 17 }, (_, index) => ({
      ...connection, relation: { ...connection.relation, id: `edge:${index}` },
    })) },
    { ...page, connections: [{ ...connection, entity: { ...connection.entity, targetId: null } }] },
    { ...page, connections: [{ ...connection, relation: { ...connection.relation, category: 'inherited-knowledge' } }] },
    { ...page, entity: { ...page.entity, kind: { ...page.entity.kind, color: 'url(javascript:bad)' } } },
    { ...page, entity: { ...page.entity, properties: [{ ...page.entity.properties[0], value: 'x'.repeat(2049) }] } },
    { ...page, knowledge: [page.knowledge[0]] },
    { ...page, knowledge: [page.knowledge[0], page.knowledge[0]] },
    { ...page, next: { identity: 'invalid', after: '16' } },
  ]) {
    packet = invalid;
    await assert.rejects(client.graphNeighborhood(query), { code: 'protocol' });
  }
  packet = page;
  await assert.rejects(client.graphNeighborhood({ ...query, after: page.next }), { code: 'protocol' });
});

test('graph admission snapshots its original package target and revision before a held receipt', { timeout: 5000 }, async () => {
  const { query, page } = fixture();
  let enter = () => {};
  let release = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let submitted = '';
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async raw => { submitted = raw; enter(); await gate; return JSON.stringify({ type: 'graph_neighborhood', page }); },
  });
  const original = structuredClone(query);
  const pending = client.graphNeighborhood(query);
  await entered;
  query.targetId = 'changed-target'; query.expectedRevision = 'changed-revision';
  release();
  assert.deepEqual(await pending, page);
  assert.deepEqual(JSON.parse(submitted), { type: 'graph_neighborhood', query: original });
});

test('two held graph pages leave ordinary Knowledge usable and cannot publish after source replacement', { timeout: 5000 }, async () => {
  const { query, page } = fixture();
  let enter = () => {};
  let release = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async raw => {
      if (JSON.parse(raw).type === 'knowledge')
        return JSON.stringify({ type: 'knowledge', projections: page.knowledge });
      reads++;
      if (reads === 2) enter();
      await gate;
      return JSON.stringify({ type: 'graph_neighborhood', page });
    },
  });
  const first = assert.rejects(client.graphNeighborhood(query), { code: 'cancelled' });
  const second = assert.rejects(client.graphNeighborhood(query), { code: 'cancelled' });
  try {
    await entered;
    await assert.rejects(client.graphNeighborhood(query), { code: 'busy' });
    assert.deepEqual(await client.knowledge(page.knowledge.map(item => item.key)), page.knowledge);
    await client.cancelSourceOpen();
  } finally { release(); }
  await Promise.all([first, second]);
});
