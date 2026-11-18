import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentSearchQuery, GraphQuery, KnowledgeEvidenceQuery } from '@mlearn/contracts';
import { createRuntimeClient, RuntimeError, type BoundedReadTransport } from '../src/client.ts';
import { createBoundedReadTestClient } from './boundedReadFixture.ts';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const query: KnowledgeEvidenceQuery = {
  key: { packageId: 'package', targetId: 'target', capability: 'meaning' }, after: null,
};
const evidence = JSON.stringify({
  type: 'knowledge_evidence',
  page: {
    projection: { key: query.key, claim: null, assessed: null, prediction: null, status: 'untracked', revision: 0 },
    claimRevision: null, assessedAttempt: null, observations: [], next: null,
  },
});
function clientFor(boundedReads: BoundedReadTransport) {
  return createRuntimeClient({
    commandId: () => 'unused', boundedReads,
    execute: async () => JSON.stringify({ type: 'knowledge', projections: [] }),
    cancelSourceOpen: async () => { assert.fail('Individual cancellation must not cancel a source.'); },
  });
}

test('abort during queued registration cancels the unclaimed ticket without executing', { timeout: 5000 }, async () => {
  // Given: begin has entered the host but has not acknowledged its immutable ticket.
  const registration = deferred<string>();
  const cancelled = deferred<string>();
  const ack = deferred<void>();
  const controller = new AbortController();
  let executions = 0;
  let cancellations = 0;
  const client = clientFor({
    begin: () => registration.promise,
    execute: async () => { executions++; return evidence; },
    cancel: async id => { cancellations++; cancelled.resolve(id); await ack.promise; },
  });
  const rejected = assert.rejects(client.knowledgeEvidence(query, controller.signal), { code: 'cancelled' });
  // When: Stop arrives before registration delivery.
  controller.abort();
  registration.resolve('queued-ticket');
  assert.equal(await cancelled.promise, 'queued-ticket');
  // Then: the host ticket is retired once and never submitted.
  controller.abort();
  assert.equal(executions, 0);
  assert.equal(cancellations, 1);
  ack.resolve();
  await rejected;
});

for (const first of ['ack', 'execute'] as const) {
  test(`active cancellation retains both slots when ${first} settles first`, { timeout: 5000 }, async () => {
    // Given: two active bounded reads, with independent native completion and cancel receipts.
    const entered = [deferred<void>(), deferred<void>()];
    const executions = [deferred<string>(), deferred<string>()];
    const acks = [deferred<void>(), deferred<void>()];
    const cancelEntered = [deferred<void>(), deferred<void>()];
    const controllers = [new AbortController(), new AbortController()];
    let sequence = 0;
    let cancellations = 0;
    const client = clientFor({
      begin: async () => String(sequence++),
      execute: async id => {
        const index = Number(id);
        if (index >= 2) return evidence;
        entered[index]?.resolve();
        const execution = executions[index];
        assert.ok(execution);
        return execution.promise;
      },
      cancel: async id => {
        const index = Number(id);
        cancellations++;
        cancelEntered[index]?.resolve();
        await acks[index]?.promise;
      },
    });
    const pending = controllers.map(controller =>
      assert.rejects(client.knowledgeEvidence(query, controller.signal), { code: 'cancelled' }));
    await Promise.all(entered.map(gate => gate.promise));
    // When: both calls abort, but only one side of each native terminal handshake completes.
    controllers.forEach(controller => controller.abort());
    await Promise.all(cancelEntered.map(gate => gate.promise));
    if (first === 'ack') acks.forEach(gate => gate.resolve());
    else executions.forEach(gate => gate.resolve(evidence));
    // Drain the signalled gate's continuation, not a timer or a poll.
    await Promise.all(first === 'ack' ? acks.map(gate => gate.promise) : executions.map(gate => gate.promise));
    // Then: no late value publishes and no replacement steals either still-owned slot.
    assert.deepEqual(await client.knowledge([query.key]), []);
    await assert.rejects(client.knowledgeEvidence(query), { code: 'busy' });
    assert.equal(cancellations, 2);
    acks.forEach(gate => gate.resolve());
    executions.forEach(gate => gate.resolve(evidence));
    await Promise.all(pending);
    assert.equal((await client.knowledgeEvidence(query)).projection.revision, 0);
  });
}

test('bounded lanes progress while ordinary execute is held and ordinary reads progress beside bounded work', { timeout: 5000 }, async () => {
  // Given: a serialized ordinary request holds its transport receipt.
  const ordinaryEntered = deferred<void>();
  const ordinary = deferred<string>();
  const boundedEntered = deferred<void>();
  const bounded = deferred<string>();
  let reads = 0;
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => {
      if (++reads === 1) { ordinaryEntered.resolve(); return ordinary.promise; }
      return JSON.stringify({ type: 'knowledge', projections: [] });
    },
    boundedReads: {
      begin: async () => 'independent',
      execute: async () => { boundedEntered.resolve(); return bounded.promise; },
      cancel: async () => {},
    },
  });
  const held = client.knowledge([query.key]);
  await ordinaryEntered.promise;
  // When: a dedicated bounded execution begins behind that ordinary request.
  const reading = client.knowledgeEvidence(query);
  await boundedEntered.promise;
  ordinary.resolve(JSON.stringify({ type: 'knowledge', projections: [] }));
  await held;
  // Then: both lanes stay independent in both directions.
  assert.deepEqual(await client.knowledge([query.key]), []);
  bounded.resolve(evidence);
  assert.equal((await reading).projection.revision, 0);
});

test('all bounded methods require host support even without a signal', async () => {
  // Given: an older host with only ordinary execute.
  let calls = 0;
  const client = createRuntimeClient({ commandId: () => 'unused', execute: async () => { calls++; return evidence; } });
  const graph: GraphQuery = { packageId: 'package', targetId: 'target', expectedRevision: null, after: null };
  const document: DocumentSearchQuery = {
    sourceId: 'source', contentRevision: 'content', parserRevision: 'parser', scope: 'text', text: 'word', after: null,
  };
  // When: any bounded read is requested.
  await Promise.all([
    client.knowledgeEvidence(query), client.graphNeighborhood(graph), client.searchDocument(document),
  ].map(result => assert.rejects(result, { code: 'transport' })));
  // Then: the unavailable host never receives a noncancellable fallback.
  assert.equal(calls, 0);
});

test('graph and document signals reach bounded admission before registration', async () => {
  // Given: a host that must never receive a preaborted bounded operation.
  const controller = new AbortController();
  const client = clientFor({
    begin: async () => { assert.fail('Preaborted calls must not register.'); },
    execute: async () => { assert.fail('Preaborted calls must not execute.'); },
    cancel: async () => { assert.fail('No ticket was registered.'); },
  });
  controller.abort();
  // When: either typed facade receives an already-aborted signal.
  const graph: GraphQuery = { packageId: 'package', targetId: 'target', expectedRevision: null, after: null };
  const document: DocumentSearchQuery = {
    sourceId: 'source', contentRevision: 'content', parserRevision: 'parser', scope: 'text', text: 'word', after: null,
  };
  // Then: cancellation is preserved through each facade, not replaced by host execution.
  await assert.rejects(client.graphNeighborhood(graph, controller.signal), { code: 'cancelled' });
  await assert.rejects(client.searchDocument(document, controller.signal), { code: 'cancelled' });
});

test('malformed handles never execute or reflect an unvalidated token', async () => {
  // Given: independently connected hosts returning each invalid token shape.
  for (const id of ['', 'contains space', '\n', 'x'.repeat(257)]) {
    const client = clientFor({
      begin: async () => id,
      execute: async () => { assert.fail('Malformed registration must not execute.'); },
      cancel: async () => { assert.fail('Malformed handle must not be sent back.'); },
    });
    // Then: validation fails before any untrusted token reaches native control.
    await assert.rejects(client.knowledgeEvidence(query), { code: 'protocol' });
  }
});

test('wire and uncertain execution failures release slots without weakening typed errors', async () => {
  // Given: the same ticketed path used by successful evidence reads.
  let raw = evidence;
  let fail = false;
  const client = clientFor({
    begin: async () => 'ticket',
    execute: async () => { if (fail) throw new Error('Lost execute receipt'); return raw; },
    cancel: async () => {},
  });
  // When: execution returns malformed JSON, oversized data, wrong method data or native failure.
  for (const packet of ['{', 'x'.repeat(524289), '{"type":"knowledge","projections":[]}']) {
    raw = packet;
    await assert.rejects(client.knowledgeEvidence(query), { code: 'protocol' });
  }
  raw = JSON.stringify({ type: 'error', code: 'conflict', message: 'Changed revision' });
  await assert.rejects(client.knowledgeEvidence(query), { code: 'conflict' });
  fail = true;
  await assert.rejects(client.knowledgeEvidence(query), { code: 'transport' });
  // Then: a subsequent valid read is admitted without automatic retry.
  fail = false; raw = evidence;
  assert.equal((await client.knowledgeEvidence(query)).projection.revision, 0);
});

test('preaborted signals do not register and uncertain cancel receipts still await execution', { timeout: 5000 }, async () => {
  // Given: a preaborted caller, followed by an active call whose cancel acknowledgement rejects.
  const controller = new AbortController();
  const entered = deferred<void>();
  const execution = deferred<string>();
  const cancelEntered = deferred<void>();
  let registrations = 0;
  const client = clientFor({
    begin: async () => { registrations++; return 'ticket'; },
    execute: async () => { entered.resolve(); return execution.promise; },
    cancel: async () => { cancelEntered.resolve(); throw new Error('Lost cancel receipt'); },
  });
  controller.abort();
  await assert.rejects(client.knowledgeEvidence(query, controller.signal), { code: 'cancelled' });
  assert.equal(registrations, 0);
  const active = new AbortController();
  const pending = assert.rejects(client.knowledgeEvidence(query, active.signal), { code: 'transport' });
  await entered.promise;
  // When: abort cannot receive a confirmed terminal cancellation receipt.
  active.abort();
  await cancelEntered.promise;
  execution.resolve(evidence);
  // Then: transport uncertainty is explicit rather than a success or a fake Stop acknowledgement.
  await pending;
  assert.equal(registrations, 1);
});

test('wire fixture ticket owner retires an unclaimed cancelled registration', async () => {
  // Given: the fixture's real in-memory ticket owner, with registration delivered asynchronously.
  let executed = false;
  const client = createBoundedReadTestClient({
    commandId: () => 'unused', execute: async () => { executed = true; return evidence; },
  });
  const controller = new AbortController();
  const rejected = assert.rejects(client.knowledgeEvidence(query, controller.signal), { code: 'cancelled' });
  // When: cancellation arrives before begin's fulfilled promise is consumed.
  controller.abort();
  await rejected;
  // Then: the fixture cannot manufacture a successful execute after ticket cancellation.
  assert.equal(executed, false);
});

test('unconfirmed registrations cannot recycle native admission', async () => {
  for (const malformed of [false, true]) {
    let registrations = 0;
    const client = clientFor({
      begin: async () => {
        registrations++;
        if (malformed) return '';
        throw new Error('Lost registration receipt');
      },
      execute: async () => { assert.fail('No validated handle was received.'); },
      cancel: async () => { assert.fail('An unknown handle cannot be cancelled.'); },
    });
    for (let count = 0; count < 2; count++) {
      await assert.rejects(client.knowledgeEvidence(query), { code: malformed ? 'protocol' : 'transport' });
    }
    await assert.rejects(client.knowledgeEvidence(query), { code: 'transport' });
    assert.equal(registrations, 2);
  }
});

test('unconfirmed execute and cancel receipts retain both native slots', async () => {
  const active = new Set<string>();
  let registrations = 0;
  let loseReceipt = true;
  const client = clientFor({
    begin: async () => `ticket-${++registrations}`,
    execute: async id => {
      active.add(id);
      if (!loseReceipt) {
        active.delete(id);
        return evidence;
      }
      throw new Error('Execution continues but its receipt was lost');
    },
    cancel: async () => { throw new Error('No terminal cancellation receipt'); },
  });
  for (let count = 0; count < 2; count++) {
    await assert.rejects(client.knowledgeEvidence(query), { code: 'transport' });
    if (count === 0) {
      // One unknown lease must not consume the other independent native slot.
      loseReceipt = false;
      assert.equal((await client.knowledgeEvidence(query)).projection.revision, 0);
      loseReceipt = true;
    }
  }
  await assert.rejects(client.knowledgeEvidence(query), { code: 'transport' });
  assert.equal(registrations, 3);
  assert.equal(active.size, 2);
});

test('confirmed cancellation retires work after a lost execute receipt', async () => {
  const active = new Set<string>();
  let registrations = 0;
  let loseReceipt = true;
  const client = clientFor({
    begin: async () => `ticket-${++registrations}`,
    execute: async id => {
      active.add(id);
      if (loseReceipt) throw new Error('Lost execute receipt');
      active.delete(id);
      return evidence;
    },
    cancel: async id => { active.delete(id); },
  });
  await assert.rejects(client.knowledgeEvidence(query), { code: 'transport' });
  assert.equal(active.size, 0);
  loseReceipt = false;
  assert.equal((await client.knowledgeEvidence(query)).projection.revision, 0);
  assert.equal(active.size, 0);
});

test('native admission busy is typed and creates no uncertain lease', async () => {
  let occupied = true;
  const client = clientFor({
    begin: async () => {
      if (occupied) throw new RuntimeError('busy', 'Both native slots are occupied');
      return 'ticket';
    },
    execute: async () => evidence,
    cancel: async () => { assert.fail('Busy admission created no lease.'); },
  });
  for (let count = 0; count < 3; count++) {
    await assert.rejects(client.knowledgeEvidence(query), { code: 'busy' });
  }
  occupied = false;
  assert.equal((await client.knowledgeEvidence(query)).projection.revision, 0);
});

test('source transition acknowledgement precedes native read registration', { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const transition = deferred<void>();
  let nativeEpoch = 0;
  const registeredEpochs: number[] = [];
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => evidence,
    cancelSourceOpen: async () => { entered.resolve(); await transition.promise; nativeEpoch++; },
    boundedReads: {
      begin: async () => { registeredEpochs.push(nativeEpoch); return 'ticket'; },
      execute: async () => evidence,
      cancel: async () => {},
    },
  });
  const changing = client.cancelSourceOpen();
  await entered.promise;
  const reading = client.knowledgeEvidence(query);
  try {
    assert.deepEqual(registeredEpochs, []);
  } finally {
    transition.resolve();
    await Promise.allSettled([changing, reading]);
  }
  assert.deepEqual(registeredEpochs, [1]);
  assert.equal((await reading).projection.revision, 0);
});

test('abort during source transition never registers a later native lease', { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const transition = deferred<void>();
  let registrations = 0;
  const client = createRuntimeClient({
    commandId: () => 'unused',
    execute: async () => evidence,
    cancelSourceOpen: async () => { entered.resolve(); await transition.promise; },
    boundedReads: {
      begin: async () => { registrations++; return 'ticket'; },
      execute: async () => evidence,
      cancel: async () => {},
    },
  });
  const changing = client.cancelSourceOpen();
  await entered.promise;
  const controller = new AbortController();
  const reading = assert.rejects(client.knowledgeEvidence(query, controller.signal), { code: 'cancelled' });
  controller.abort();
  transition.resolve();
  await Promise.all([changing, reading]);
  assert.equal(registrations, 0);
});
