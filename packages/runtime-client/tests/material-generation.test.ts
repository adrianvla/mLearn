import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationGeneration, MaterialGenerationReport } from '@mlearn/contracts';
import { createRuntimeClient } from '../src/client.ts';

const generation: ConversationGeneration = {
  id: 'generation-one', conversationId: 'thread-one', conversationRevision: 2,
  userMessageId: 'user-one', assistantMessageId: 'answer-one', retryOf: null,
  status: 'pending', startedAtMs: null, finishedAtMs: null, error: null,
};
const report: MaterialGenerationReport = {
  commandId: 'generate-one', generation, label: 'cat', maximum: 1,
  collected: false, proposalIds: [], errors: [],
};
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('generation control and recovery bypass a held admission receipt and retry the same immutable intent', { timeout: 5000 }, async () => {
  // Given native admission committed while only its transport receipt is held.
  const admitted = gate();
  const delivery = gate();
  const submissions: string[] = [];
  let current = report;
  const client = createRuntimeClient({
    commandId: () => 'generate-one',
    execute: async raw => {
      const value: unknown = JSON.parse(raw);
      if (!object(value)) throw new Error('Unexpected fixture request');
      if (value.type === 'conversation' && object(value.command)) {
        switch (value.command.action) {
          case 'generate_material':
            submissions.push(raw);
            admitted.release();
            if (submissions.length === 1) {
              await delivery.promise;
              throw new Error('Fixture lost admission receipt');
            }
            return JSON.stringify({ type: 'conversation', result: { kind: 'generation', generation: current.generation } });
          case 'cancel_generation':
            current = { ...report, generation: { ...generation, status: 'cancelled' } };
            return JSON.stringify({ type: 'conversation', result: { kind: 'generation', generation: current.generation } });
          default: throw new Error('Unexpected conversation action');
        }
      }
      if (value.type === 'material_generations')
        return JSON.stringify({ type: 'material_generations', page: { items: [current], next: null } });
      if (value.type === 'material_generation')
        return JSON.stringify({ type: 'material_generation', report: current });
      throw new Error('Unexpected fixture request');
    },
  });
  const basis = { kind: 'material', material: { id: 'material-one', revision: 1 } } as const;
  const command = client.prepareMaterialGeneration(basis, 'Suggest an example.', 1);
  const pending = client.generateMaterial(command);
  const lost = assert.rejects(pending, /Fixture lost admission receipt/);
  await admitted.promise;
  try {
    // When another surface reads recovery and uses the existing generation cancellation owner.
    assert.equal((await client.materialGenerations()).items[0].generation.id, generation.id);
    await client.stopConversationGeneration(client.prepareConversationStop(generation.id));
    assert.equal((await client.materialGeneration(generation.id)).generation.status, 'cancelled');
  } finally {
    delivery.release();
  }
  await lost;
  // Then replay preserves the admitted command and reports cancellation rather than new work.
  assert.equal((await client.generateMaterial(command)).generation.status, 'cancelled');
  assert.equal(submissions[0], submissions[1]);
});

test('generation reports reject foreign start receipts, fabricated collection state and unbounded recovery pages', async () => {
  // Given unknown native packets behind the typed generation boundary.
  let packet: unknown = { type: 'material_generation', report };
  const client = createRuntimeClient({
    commandId: () => 'generate-one',
    execute: async raw => {
      const value: unknown = JSON.parse(raw);
      if (object(value) && value.type === 'conversation')
        return JSON.stringify({ type: 'conversation', result: { kind: 'generation', generation } });
      return JSON.stringify(packet);
    },
  });
  const command = client.prepareMaterialGeneration({ kind: 'material', material: { id: 'material-one', revision: 1 } }, '', 1);
  assert.deepEqual(await client.generateMaterial(command), report);
  // When progress or identity cannot describe the requested native operation.
  for (const invalid of [
    { ...report, commandId: 'foreign' },
    { ...report, generation: { ...generation, id: 'foreign' } },
    { ...report, maximum: 2 },
    { ...report, proposalIds: ['not-collected'] },
    { ...report, collected: true, proposalIds: ['a', 'a'] },
    { ...report, collected: true, errors: ['x'.repeat(1201)] },
  ]) {
    packet = { type: 'material_generation', report: invalid };
    await assert.rejects(client.generateMaterial(command), { code: 'protocol' });
  }
  packet = { type: 'material_generation', report };
  await assert.rejects(client.collectMaterialGeneration(generation.id), { code: 'protocol' });
  for (const items of [[report, report], Array.from({ length: 13 }, () => report)]) {
    packet = { type: 'material_generations', page: { items, next: null } };
    await assert.rejects(client.materialGenerations(), { code: 'protocol' });
  }
  // Then only a bounded, explicitly collected report can expose proposal identities.
  const collected = { ...report, collected: true, proposalIds: ['proposal-one'] };
  packet = { type: 'material_generation', report: collected };
  assert.deepEqual(await client.collectMaterialGeneration(generation.id), collected);
});
