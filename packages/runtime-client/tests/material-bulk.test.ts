import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MaterialBulkPatch, MaterialBulkStart, MaterialBulkStatus } from '@mlearn/contracts';
import { createRuntimeClient } from '../src/client.ts';

const command: MaterialBulkStart = {
  commandId: 'bulk-one', selectionId: 'selection-one', action: { kind: 'exclude', excluded: true },
};
const progress: MaterialBulkStatus = {
  command, phase: 'running', total: 2, processed: 1, succeeded: 1, duplicates: 0, failed: 0,
  resultsAvailable: true, message: null,
};
const entry = {
  item: { kind: 'material', id: 'material-one' }, packageId: 'example.language',
  packageRevision: null, materialRevision: 4,
};
const result = { entry, label: 'Selected word', outcome: { state: 'saved', materialId: 'material-one', committedRevision: 5, reused: false } };
function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

test('bulk controls bypass admission and lost receipts preserve durable intent across navigation', { timeout: 5000 }, async () => {
  // Given an admitted native call held behind an exact transport signal.
  const admitted = gate();
  const started = gate();
  const lostReceipt = new Error('Fixture transport interruption');
  const submissions: string[] = [];
  const completed = { ...progress, phase: 'completed', processed: 2, succeeded: 2 };
  const client = createRuntimeClient({
    commandId: () => command.commandId,
    execute: async raw => {
      const request: unknown = JSON.parse(raw);
      if (!object(request) || request.type !== 'material_bulk' || !object(request.command))
        throw new Error('Unexpected fixture request');
      switch (request.command.kind) {
        case 'start':
          submissions.push(raw);
          started.release();
          await admitted.promise;
          if (submissions.length === 1) throw lostReceipt;
          return JSON.stringify({ type: 'material_bulk_status', status: completed });
        case 'status': return JSON.stringify({ type: 'material_bulk_status', status: progress });
        case 'jobs': return JSON.stringify({ type: 'material_bulk_jobs', jobs: [progress] });
        case 'results': return JSON.stringify({
          type: 'material_bulk_page', commandId: command.commandId, page: { items: [result], next: null },
        });
        case 'cancel': return JSON.stringify({ type: 'material_bulk_status', status: { ...progress, phase: 'cancelled' } });
        default: throw new Error('Unexpected fixture bulk control');
      }
    },
  });
  const prepared = client.prepareMaterialBulk(command.selectionId, command.action);
  const pending = client.startMaterialBulk(prepared);
  const lost = assert.rejects(pending, (error: unknown) => error === lostReceipt);
  await started.promise;
  try {
    // When another surface navigates, inspects progress or cancels.
    await client.cancelSourceOpen();
    assert.deepEqual(await client.materialBulkStatus(command.commandId), progress);
    assert.deepEqual(await client.materialBulkJobs(), [progress]);
    assert.deepEqual(await client.materialBulkResults(command.commandId), { items: [result], next: null });
    assert.equal((await client.cancelMaterialBulk(command.commandId)).phase, 'cancelled');
  } finally {
    admitted.release();
  }
  await lost;

  // Then status never queued behind its own admission, and retry is the same intent.
  assert.deepEqual(await client.startMaterialBulk(prepared), completed);
  assert.equal(submissions[0], submissions[1]);
});

test('bulk receipts reject inconsistent progress, foreign identities and unbounded result data', async () => {
  // Given the typed boundary consuming unknown native packets.
  let response: unknown = { type: 'material_bulk_status', status: progress };
  const client = createRuntimeClient({ commandId: () => 'unused', execute: async () => JSON.stringify(response) });
  assert.deepEqual(await client.materialBulkStatus(command.commandId), progress);
  await assert.rejects(client.cancelMaterialBulk(command.commandId), { code: 'protocol' });

  // When a structurally plausible packet violates a native progress or identity contract.
  for (const invalid of [
    { ...progress, processed: 3 },
    { ...progress, succeeded: 2 },
    { ...progress, phase: 'completed' },
    { ...progress, resultsAvailable: false },
    { ...progress, total: 1000001 },
    { ...progress, command: { ...command, commandId: 'foreign' } },
    { ...progress, command: { ...command, action: { kind: 'edit', patch: {} } } },
    { ...progress, message: 'é'.repeat(1025) },
  ]) {
    response = { type: 'material_bulk_status', status: invalid };
    await assert.rejects(client.materialBulkStatus(command.commandId), { code: 'protocol' });
  }

  // Then recovery lists and per-item receipts are bounded and tied to their frozen keys.
  for (const jobs of [
    Array.from({ length: 9 }, () => progress),
    [progress, progress],
    [{ ...progress, resultsAvailable: false }],
    [0, 1].map(index => ({
      ...progress, total: 500001, command: { ...command, commandId: `large-${index}` },
    })),
  ]) {
    response = { type: 'material_bulk_jobs', jobs };
    await assert.rejects(client.materialBulkJobs(), { code: 'protocol' });
  }
  for (const page of [
    { items: Array.from({ length: 25 }, () => result), next: null },
    { items: [result, result], next: null },
    { items: [result], next: 'not-the-last-key' },
    { items: [{ ...result, outcome: { ...result.outcome, committedRevision: 6 } }], next: null },
    { items: [{ ...result, outcome: { state: 'removed', materialId: 'foreign', committedRevision: 5 } }], next: null },
    { items: [{ ...result, entry: { ...entry, materialRevision: 4294967295 }, outcome: {
      state: 'removed', materialId: entry.item.id, committedRevision: 4294967296,
    } }], next: null },
    { items: [{ ...result, entry: { ...entry, materialRevision: null }, outcome: null }], next: null },
    { items: [{ ...result, label: '' }], next: null },
    { items: [{ ...result, outcome: { state: 'invented-success' } }], next: null },
  ]) {
    response = { type: 'material_bulk_page', commandId: command.commandId, page };
    await assert.rejects(client.materialBulkResults(command.commandId), { code: 'protocol' });
  }
  response = { type: 'material_bulk_page', commandId: 'foreign', page: { items: [result], next: null } };
  await assert.rejects(client.materialBulkResults(command.commandId), { code: 'protocol' });
});

test('prepared bulk edits freeze input and compare receipt semantics rather than property order', async () => {
  // Given unsubmitted editor input and an independently serialized native receipt.
  const patch: MaterialBulkPatch = {
    phrase: null, reading: null, meaning: null, context: null, notes: 'original', examples: null,
  };
  let response: unknown;
  const client = createRuntimeClient({
    commandId: () => command.commandId, execute: async () => JSON.stringify(response),
  });
  const prepared = client.prepareMaterialBulk(command.selectionId, { kind: 'edit', patch });
  patch.notes = 'changed editor input';
  const completed = {
    ...progress, phase: 'completed', total: 1,
    command: { ...prepared, action: { kind: 'edit', patch: {
      examples: null, notes: 'original', context: null, meaning: null, reading: null, phrase: null,
    } } },
  };
  response = { type: 'material_bulk_status', status: completed };

  // When the exact prepared edit is sent after the input draft changes.
  assert.deepEqual(await client.startMaterialBulk(prepared), completed);

  // Then key order is irrelevant but action, revision scope and release identity are not.
  response = { type: 'material_bulk_status', status: { ...completed, command: { ...prepared, action: { kind: 'remove' } } } };
  await assert.rejects(client.startMaterialBulk(prepared), { code: 'protocol' });
  response = { type: 'material_bulk_status', status: completed };
  await assert.rejects(client.releaseMaterialBulk(command.commandId), { code: 'protocol' });
  response = { type: 'material_bulk_released', commandId: 'foreign' };
  await assert.rejects(client.releaseMaterialBulk(command.commandId), { code: 'protocol' });
  response = { type: 'material_bulk_released', commandId: command.commandId };
  await client.releaseMaterialBulk(command.commandId);
  assert.throws(() => client.prepareMaterialBulk(command.selectionId, { kind: 'edit', patch: {
    phrase: null, reading: null, meaning: null, context: null, notes: null, examples: null,
  } }), { code: 'invalid_request' });
});
