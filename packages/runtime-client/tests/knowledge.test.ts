import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KnowledgeEvidencePage, KnowledgeEvidenceQuery } from '@mlearn/contracts';
import { createBoundedReadTestClient as createRuntimeClient } from './boundedReadFixture.ts';

function fixture(): { query: KnowledgeEvidenceQuery; page: KnowledgeEvidencePage } {
  const key = { packageId: 'package', targetId: 'target', capability: 'meaning' };
  return {
    query: { key, after: null },
    page: {
      projection: { key: { ...key }, claim: true, assessed: false, prediction: null, status: 'claimed_known', revision: 9 },
      claimRevision: 8, assessedAttempt: 'attempt-2', next: null,
      observations: [{
        sequence: 2, attemptId: 'attempt-2', sessionId: 'session', encounterId: 'encounter',
        active: true, createdAt: 100, materialId: 'material', materialRevision: 1,
        packageVersion: '1', packageRevision: 'revision', probeId: 'written', probeContractVersion: 1,
        direction: 'written', conditions: { revealed: true, exposureCount: 1, assistance: [], delivery: 'not_required' },
        grade: { targetId: 'meaning-row', quality: 'missed', method: 'remembered', easy: false },
        assessed: false, practice: false, source: null,
      }],
    },
  };
}

test('Knowledge evidence rejects foreign scope, fabricated provenance and unbounded or inconsistent pages', async () => {
  const { query, page } = fixture();
  let packet: unknown = page;
  const client = createRuntimeClient({
    commandId: () => 'unused', execute: async () => JSON.stringify({ type: 'knowledge_evidence', page: packet }),
  });
  assert.deepEqual(await client.knowledgeEvidence(query), page);
  const observation = page.observations[0];
  for (const malformed of [
    { ...page, projection: { ...page.projection, key: { ...query.key, capability: 'reading' } } },
    { ...page, claimRevision: -1 },
    { ...page, assessedAttempt: null },
    { ...page, observations: Array(17).fill(observation) },
    { ...page, observations: [observation, observation] },
    { ...page, observations: [{ ...observation, active: false }] },
    { ...page, observations: [{ ...observation, assessed: true }] },
    { ...page, observations: [{ ...observation, sequence: 0 }] },
    { ...page, observations: [{ ...observation, source: { sourceId: 'invented' } }] },
    { ...page, observations: [{ ...observation, grade: { ...observation.grade, quality: null } }] },
    { ...page, observations: [{ ...observation, grade: { ...observation.grade, method: 'validated' } }] },
    { ...page, observations: [{ ...observation, conditions: { ...observation.conditions, assistance: ['invented'] } }] },
    { ...page, next: { identity: 'a'.repeat(64), before: 1, revision: 9 } },
    { ...page, next: { identity: 'a'.repeat(64), before: 2, revision: 8 } },
  ]) {
    packet = malformed;
    await assert.rejects(client.knowledgeEvidence(query), { code: 'protocol' });
  }
  const after = { identity: 'a'.repeat(64), before: 2, revision: 9 };
  packet = page;
  await assert.rejects(client.knowledgeEvidence({ ...query, after }), { code: 'protocol' });
});

test('Knowledge evidence admission snapshots its capability before awaiting a held native receipt', { timeout: 5000 }, async () => {
  const { query, page } = fixture();
  let entered = () => {};
  let release = () => {};
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let submitted = '';
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async raw => { submitted = raw; entered(); await gate; return JSON.stringify({ type: 'knowledge_evidence', page }); },
  });
  const expected = structuredClone(query);
  const pending = client.knowledgeEvidence(query);
  await admitted;
  query.key.capability = 'another-capability';
  release();
  assert.deepEqual(await pending, page);
  assert.deepEqual(JSON.parse(submitted), { type: 'knowledge_evidence', query: expected });
});

test('a late Knowledge evidence page cannot publish into a replaced source session', { timeout: 5000 }, async () => {
  const { query, page } = fixture();
  let entered = () => {};
  let release = () => {};
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => { entered(); await gate; return JSON.stringify({ type: 'knowledge_evidence', page }); },
  });
  const pending = client.knowledgeEvidence(query);
  const cancelled = assert.rejects(pending, { code: 'cancelled' });
  await admitted;
  await client.cancelSourceOpen();
  release();
  await cancelled;
});

test('held evidence permits one bounded replacement and does not block ordinary Knowledge reads', { timeout: 5000 }, async () => {
  const { query, page } = fixture();
  let release = () => {};
  let entered = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  let evidenceReads = 0;
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async raw => {
      const request = JSON.parse(raw);
      if (request.type === 'knowledge')
        return JSON.stringify({ type: 'knowledge', projections: [page.projection] });
      evidenceReads++;
      if (evidenceReads === 2) entered();
      await held;
      return JSON.stringify({ type: 'knowledge_evidence', page });
    },
  });
  const first = client.knowledgeEvidence(query);
  const second = client.knowledgeEvidence(query);
  try {
    await admitted;
    await assert.rejects(client.knowledgeEvidence(query), { code: 'busy' });
    assert.deepEqual(await client.knowledge([query.key]), [page.projection]);
  } finally {
    release();
    await Promise.all([first, second]);
  }
});
