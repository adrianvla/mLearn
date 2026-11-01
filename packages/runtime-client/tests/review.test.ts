/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, ReviewCommand, ReviewEncounter, ReviewSession, TaskResponse } from '@mlearn/contracts';
import { createReviewClient, type ReviewAction } from '../src/reviewClient';
import { createRuntimeClient } from '../src/client';
import { RuntimeError } from '../src/errors';
import { isReviewCommand, isReviewResponse } from '../src/reviewProtocol';

const encounter: ReviewEncounter = {
  id: 'encounter', workId: 'work', materialId: 'material', materialRevision: 1,
  packageId: 'package', packageVersion: '1', packageRevision: 'revision', probeId: 'written',
  probeContractVersion: 1, direction: 'written', cue: 'cue', answer: null,
  targets: [{ id: 'row', label: 'Meaning', mnemonic: null,
    key: { packageId: 'package', targetId: 'target', capability: 'package:meaning' } }],
  supplied: [], requiredMedia: null, source: null,
  conditions: { revealed: false, exposureCount: 1, assistance: [], delivery: 'not_required' }, correction: false,
};
const session: ReviewSession = {
  id: 'session', revision: 1, mode: { kind: 'continuous' }, state: 'active', completed: 0,
  total: null, encounter, canUndo: false, message: null,
};
const revealed: ReviewSession = { ...session, revision: 2, encounter: {
  ...encounter, answer: 'answer', conditions: { ...encounter.conditions, revealed: true },
} };
function gate<T>() {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}
const protocol = (error: unknown) => error instanceof RuntimeError && error.code === 'protocol';

const typedEncounter: ReviewEncounter = {
  ...encounter,
  task: { revision: 1, responseSpec: { kind: 'typed_text', maxBytes: 2048 },
    attribution: 'Original package content', limitations: 'Finite matching only' },
};
const typedSession: ReviewSession = {
  ...session, mode: { kind: 'practice', items: [{ materialId: 'material', source: null }] },
  total: 1, encounter: typedEncounter,
};
const capturedEncounter: ReviewEncounter = {
  ...typedEncounter,
  capture: { id: 'native-capture', response: { kind: 'typed_text', text: '  RAW  ' },
    conditions: { ...encounter.conditions }, feedback: null },
};

const captureReceipt = JSON.stringify({ type: 'review', commit: {
  commandId: 'capture', committedRevision: 2,
  session: { ...typedSession, revision: 2, encounter: capturedEncounter },
} });

test('validation preserves its frozen request outside ordinary and source cancellation queues', { timeout: 5000 }, async () => {
  // Given ordinary transport and source cancellation whose receipts remain pending.
  const ordinaryEntered = gate<void>(), ordinary = gate<string>();
  const sourceEntered = gate<void>(), source = gate<void>();
  const begun = gate<string>(), registration = gate<string>();
  const sent: string[] = [];
  const client = createRuntimeClient({
    commandId: () => 'capture',
    execute: async () => { ordinaryEntered.release(); return ordinary.promise; },
    cancelSourceOpen: async () => { sourceEntered.release(); await source.promise; },
    reviewValidation: {
      begin: async raw => { begun.release(raw); return registration.promise; },
      execute: async (id, raw) => { assert.equal(id, 'validation-1'); sent.push(raw); return captureReceipt; },
      cancel: async () => { assert.fail('Source cancellation must not cancel this response.'); },
    },
  });
  const knowledge = client.knowledge([{ packageId: 'package', targetId: 'target', capability: 'package:meaning' }]);
  await ordinaryEntered.promise;
  const cancellingSource = client.cancelSourceOpen();
  await sourceEntered.promise;
  const command = client.prepareReviewMutation(typedSession, {
    kind: 'capture_response', encounterId: 'encounter', response: { kind: 'typed_text', text: '  RAW  ' },
  });
  // When the durable response registers and executes while both other lanes wait.
  const saving = client.review(command);
  const registered = await begun.promise;
  if (command.kind !== 'capture_response' || command.response.kind !== 'typed_text')
    throw new Error('Expected the typed response fixture');
  command.response.text = 'edited while registration was pending';
  registration.release('validation-1');
  const result = await saving;
  // Then native registration and execution receive the same original raw intent.
  assert.equal(sent[0], registered);
  assert.equal(JSON.parse(registered).command.response.text, '  RAW  ');
  assert.equal(result.session.revision, 2);
  ordinary.release(JSON.stringify({ type: 'knowledge', projections: [] }));
  source.release();
  await Promise.all([knowledge, cancellingSource]);
});

test('registration abort retains its shared operation slot until native acknowledgment', { timeout: 5000 }, async () => {
  // Given a delayed validation registration and an independent source read.
  const begun = gate<void>(), registration = gate<string>();
  const cancelEntered = gate<string>(), acknowledgement = gate<void>();
  const readEntered = gate<void>(), read = gate<string>();
  const key = { packageId: 'package', targetId: 'target', capability: 'package:meaning' };
  let registrations = 0, executions = 0, cancellations = 0;
  const client = createRuntimeClient({
    commandId: () => 'capture',
    execute: async () => { assert.fail('Scoped work must not use ordinary transport.'); },
    reviewValidation: {
      begin: async () => {
        if (++registrations === 1) { begun.release(); return registration.promise; }
        return 'validation-2';
      },
      execute: async id => { executions++; assert.equal(id, 'validation-2'); return captureReceipt; },
      cancel: async id => { cancellations++; cancelEntered.release(id); await acknowledgement.promise; },
    },
    boundedReads: {
      begin: async () => 'source-read',
      execute: async () => { readEntered.release(); return read.promise; },
      cancel: async () => { assert.fail('Stopping a response must not stop the source read.'); },
    },
  });
  const command = client.prepareReviewMutation(typedSession, {
    kind: 'capture_response', encounterId: 'encounter', response: { kind: 'typed_text', text: '  RAW  ' },
  });
  const controller = new AbortController();
  const stopped = assert.rejects(client.review(command, controller.signal), { code: 'cancelled' });
  await begun.promise;
  // When Stop precedes ticket delivery, native cancellation still owns that slot.
  controller.abort();
  registration.release('validation-1');
  assert.equal(await cancelEntered.promise, 'validation-1');
  controller.abort();
  const reading = client.knowledgeEvidence({ key, after: null });
  await readEntered.promise;
  await assert.rejects(client.review(command), { code: 'busy' });
  assert.equal(registrations, 1);
  assert.equal(executions, 0);
  assert.equal(cancellations, 1);
  // Then acknowledgment releases only this operation; the source completes separately.
  acknowledgement.release();
  await stopped;
  read.release(JSON.stringify({ type: 'knowledge_evidence', page: {
    projection: { key, claim: null, assessed: null, prediction: null, status: 'untracked', revision: 0 },
    claimRevision: null, assessedAttempt: null, observations: [], next: null,
  } }));
  await reading;
  assert.equal((await client.review(command)).session.revision, 2);
});

test('active validation discards late success until execution and cancellation both terminate', { timeout: 5000 }, async () => {
  // Given a native response whose work is complete but transport delivery is held.
  const entered = gate<void>(), execution = gate<string>();
  const cancelEntered = gate<void>(), acknowledgement = gate<void>();
  const client = createRuntimeClient({
    commandId: () => 'capture',
    execute: async () => { assert.fail('Validation must use its dedicated transport.'); },
    reviewValidation: {
      begin: async () => 'validation-1',
      execute: async () => { entered.release(); return execution.promise; },
      cancel: async () => { cancelEntered.release(); await acknowledgement.promise; },
    },
  });
  const command = client.prepareReviewMutation(typedSession, {
    kind: 'capture_response', encounterId: 'encounter', response: { kind: 'typed_text', text: '  RAW  ' },
  });
  const controller = new AbortController();
  const stopped = assert.rejects(client.review(command, controller.signal), { code: 'cancelled' });
  await entered.promise;
  // When Stop races an already-committed result whose delivery arrives late.
  controller.abort();
  await cancelEntered.promise;
  execution.release(captureReceipt);
  await execution.promise;
  acknowledgement.release();
  // Then no late success is published as a new Review state.
  await stopped;
});

test('stopped validation preserves uncertain registration failures instead of acknowledging drainage', { timeout: 5000 }, async () => {
  // Given registration whose native ticket receipt will be lost.
  const entered = gate<void>(), release = gate<void>();
  let registrations = 0;
  const client = createRuntimeClient({
    commandId: () => 'capture',
    execute: async () => { assert.fail('Validation must use its dedicated transport.'); },
    reviewValidation: {
      begin: async () => {
        registrations++;
        entered.release();
        await release.promise;
        throw new Error('Registration receipt lost');
      },
      execute: async () => { assert.fail('No usable ticket was delivered.'); },
      cancel: async () => { assert.fail('An unknown native ticket cannot be cancelled.'); },
    },
  });
  const command = client.prepareReviewMutation(typedSession, {
    kind: 'capture_response', encounterId: 'encounter', response: { kind: 'typed_text', text: '  RAW  ' },
  });
  const controller = new AbortController();
  const stopped = assert.rejects(client.review(command, controller.signal), { code: 'transport' });
  await entered.promise;
  // When Stop races loss of registration identity, no drainage receipt exists.
  controller.abort();
  release.release();
  await stopped;
  // Then both uncertain slots remain charged and no third registration starts.
  await assert.rejects(client.review(command), { code: 'transport' });
  await assert.rejects(client.review(command), { code: 'transport' });
  assert.equal(registrations, 2);
});

test('captured responses require the cancellable host capability without ordinary fallback', async () => {
  // Given a host that has no scoped validation API.
  let ordinary = 0;
  const client = createRuntimeClient({
    commandId: () => 'capture',
    execute: async () => { ordinary++; return captureReceipt; },
  });
  const command = client.prepareReviewMutation(typedSession, {
    kind: 'capture_response', encounterId: 'encounter', response: { kind: 'typed_text', text: '  RAW  ' },
  });
  // When a response is submitted without an AbortSignal.
  await assert.rejects(client.review(command), { code: 'transport' });
  // Then an uncancellable path cannot masquerade as the supported operation.
  assert.equal(ordinary, 0);
});

test('captured questions reject feedback leaks and foreign validator rows', () => {
  // Given valid hidden and Revealed projections of one immutable capture.
  const feedback = { contractVersion: 1, taskId: 'written', taskRevision: 1,
    validatorId: 'package:validator',
    outcomes: [{ targetId: 'row', result: 'accepted', reason: 'finite_match' }],
  };
  const revealedCapture = { ...capturedEncounter, answer: 'answer',
    conditions: { ...encounter.conditions, revealed: true },
    capture: { ...capturedEncounter.capture, feedback },
  };
  assert.equal(isReviewResponse({ type: 'review_session', session: typedSession }), true);
  for (const value of [capturedEncounter, revealedCapture])
    assert.equal(isReviewResponse({ type: 'review_session', session: { ...typedSession, encounter: value } }), true);
  // When feedback appears early, claims another task/row or violates the admitted input.
  const invalid = [
    { ...capturedEncounter, capture: { ...capturedEncounter.capture, feedback } },
    { ...capturedEncounter, capture: { ...capturedEncounter.capture,
      conditions: { ...encounter.conditions, revealed: true } } },
    { ...capturedEncounter, capture: { ...capturedEncounter.capture,
      response: { kind: 'choice_id', id: 'choice' } } },
    { ...capturedEncounter, capture: { ...capturedEncounter.capture,
      response: { kind: 'typed_text', text: 'é'.repeat(1025) } } },
    { ...typedEncounter, task: { ...typedEncounter.task, responseSpec: { kind: 'typed_text', maxBytes: 0 } } },
    { ...typedEncounter, task: { ...typedEncounter.task, hiddenAnswer: 'leaked' } },
    { ...revealedCapture, capture: { ...revealedCapture.capture, feedback: { ...feedback, taskId: 'another-task' } } },
    { ...revealedCapture, capture: { ...revealedCapture.capture, feedback: { ...feedback, taskRevision: 2 } } },
    { ...revealedCapture, capture: { ...revealedCapture.capture, feedback: { ...feedback,
      outcomes: [...feedback.outcomes, ...feedback.outcomes] } } },
    { ...revealedCapture, capture: { ...revealedCapture.capture, feedback: { ...feedback,
      outcomes: [{ ...feedback.outcomes[0], targetId: 'another-row' }] } } },
  ];
  // Then none acquires the trusted question projection.
  for (const value of invalid)
    assert.equal(isReviewResponse({ type: 'review_session', session: { ...typedSession, encounter: value } }), false);
  assert.equal(isReviewResponse({ type: 'review_session', session: { ...session, encounter: typedEncounter } }), false);
});

test('choice captures retain only a declared option identity', () => {
  // Given a question with two actual stable choice IDs.
  const choice = { ...capturedEncounter, task: {
    revision: 1, responseSpec: { kind: 'choice_id', options: [
      { id: 'a', label: 'First sentence' }, { id: 'b', label: 'Second sentence' },
    ] }, attribution: 'Original package content', limitations: 'Choice contrast only',
  }, capture: { ...capturedEncounter.capture, response: { kind: 'choice_id', id: 'a' } } };
  // When the host projects a declared option and an invented replacement.
  const accepted = isReviewResponse({ type: 'review_session', session: { ...typedSession, encounter: choice } });
  const foreign = isReviewResponse({ type: 'review_session', session: { ...typedSession, encounter: {
    ...choice, capture: { ...choice.capture, response: { kind: 'choice_id', id: 'outside' } },
  } } });
  // Then only the declared choice belongs to the admitted response.
  assert.equal(accepted, true);
  assert.equal(foreign, false);
});

test('prepared capture retries preserve raw bytes and reject renderer-supplied grading', async () => {
  // Given an uncertain save and a mutable local response.
  const wire: Request[] = [];
  const client = createReviewClient(async request => {
    wire.push(structuredClone(request));
    if (wire.length === 1) throw new RuntimeError('transport', 'Receipt lost');
    return { type: 'review', commit: { commandId: 'capture', committedRevision: 2,
      session: { ...typedSession, revision: 2, encounter: capturedEncounter } } };
  }, () => 'capture');
  const raw = { kind: 'typed_text', text: '  RAW  ' } satisfies TaskResponse;
  const command = client.prepareReviewMutation(typedSession, {
    kind: 'capture_response', encounterId: 'encounter', response: raw,
  });
  raw.text = 'edited after admission';
  // When the same frozen command retries after uncertain transport.
  await assert.rejects(client.review(command), { code: 'transport' });
  await client.review(command);
  // Then original input survives without a client-authored success or oversized payload.
  assert.deepEqual(wire[0], wire[1]);
  assert.equal(command.kind, 'capture_response');
  if (command.kind !== 'capture_response') throw new Error('Expected prepared capture');
  assert.deepEqual(command.response, { kind: 'typed_text', text: '  RAW  ' });
  for (const response of [
    { kind: 'typed_text', text: 'answer', accepted: true },
    { kind: 'typed_text', text: 'é'.repeat(1025) },
    { kind: 'choice_id', id: '' },
  ]) assert.equal(isReviewCommand({ ...command, response }), false);
  assert.equal(isReviewCommand({ ...command, response: { kind: 'typed_text', text: 'é'.repeat(1024) } }), true);
});

test('Word Practice validates explicit membership and preserves a prepared selection across retry', async () => {
  // Given an exact selected native membership and an uncertain transport result.
  const items = [{ materialId: 'material', source: null }];
  const requests: Request[] = [];
  const practice: ReviewSession = { ...session, mode: { kind: 'practice', items: structuredClone(items) }, total: 2 };
  const client = createReviewClient(async request => {
    requests.push(structuredClone(request));
    if (requests.length === 1) throw new RuntimeError('transport', 'Receipt lost');
    return { type: 'review', commit: { commandId: 'once', committedRevision: 1, session: { ...practice, id: 'once' } } };
  }, () => 'once');
  const command = client.prepareReviewStart({ kind: 'practice', items });
  items[0].materialId = 'different';
  // When the same prepared intent is retried after the selection changes in its caller.
  await assert.rejects(client.review(command), { code: 'transport' });
  const result = await client.review(command);
  // Then exact selected scope survives and malformed/broadened projections are rejected.
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(result.session.mode, practice.mode);
  assert.equal(isReviewResponse({ type: 'review_session', session: practice }), true);
  assert.equal(isReviewResponse({ type: 'review_session', session: { ...practice, encounter: { ...encounter, materialId: 'outside' } } }), false);
  for (const invalid of [[], [{ materialId: 'material', source: null }, { materialId: 'material', source: null }],
    [{ materialId: '', source: null }], [{ materialId: 'material', source: { invented: true } }],
    Array.from({ length: 129 }, (_, index) => ({ materialId: `m${index}`, source: null }))]) {
    assert.equal(isReviewCommand({ kind: 'start', start: {
      commandId: 'start', sessionId: 's', mode: { kind: 'practice', items: invalid },
    } }), false);
  }
});

test('canonical Practice confines target identity revision and tested capabilities', () => {
  // Given one explicit canonical scope, with no authored identity.
  const item = { packageId: 'package', packageRevision: 'revision', targetId: 'target',
    capabilities: ['package:meaning'], source: null };
  const canonical = Object.fromEntries(Object.entries(encounter)
    .filter(([name]) => name !== 'materialId' && name !== 'materialRevision'));
  const current = { ...canonical, targetId: 'target', task: {
    revision: 1, responseSpec: { kind: 'self_report' },
    attribution: 'Package content', limitations: 'Recall only',
  } };
  const practice = { ...session, mode: { kind: 'target_practice', items: [item] },
    total: 1, encounter: current };
  // When the native projection crosses its ordinary response boundary.
  assert.equal(isReviewResponse({ type: 'review_session', session: practice }), true);
  const assisted = { ...practice, mode: { ...practice.mode, assistance: ['inspector'] } };
  assert.equal(isReviewResponse({ type: 'review_session', session: assisted }), false);
  assert.equal(isReviewResponse({ type: 'review_session', session: {
    ...assisted, encounter: { ...current,
      conditions: { ...encounter.conditions, assistance: ['inspector'] } },
  } }), true);
  for (const assistance of [['inspector', 'inspector'], ['prior_disclosure'], ['replay']]) {
    assert.equal(isReviewCommand({ kind: 'start', start: {
      commandId: 'start', sessionId: 's', mode: { ...practice.mode, assistance },
    } }), false);
  }
  // Then a different subject, revision, key or authored identity cannot broaden it.
  for (const invalid of [
    { ...current, targetId: 'other-target' },
    { ...current, packageRevision: 'other-revision' },
    { ...current, materialId: 'invented', materialRevision: 1 },
    { ...current, targets: [{ ...encounter.targets[0],
      key: { packageId: 'package', targetId: 'target', capability: 'package:reading' } }] },
  ]) assert.equal(isReviewResponse({
    type: 'review_session', session: { ...practice, encounter: invalid },
  }), false);
});

test('collection Practice keeps a frozen native scope distinct from due work and cold evidence', () => {
  // Given a frozen selection and one source-assisted canonical encounter.
  const canonical = Object.fromEntries(Object.entries(encounter)
    .filter(([name]) => name !== 'materialId' && name !== 'materialRevision'));
  const current = { ...canonical, targetId: 'target', task: {
    revision: 1, responseSpec: { kind: 'self_report' },
    attribution: 'Package content', limitations: 'Recall only',
  }, conditions: { ...encounter.conditions, assistance: ['source'] } };
  const practice = { ...session, total: null, mode: {
    kind: 'collection_practice', selectionId: 'frozen', capabilities: ['package:meaning'],
  }, encounter: current };
  // When the bounded wire projection is admitted without enumerating the selection.
  assert.equal(isReviewResponse({ type: 'review_session', session: practice }), true);
  assert.equal(isReviewCommand({ kind: 'start', start: {
    commandId: 'once', sessionId: 'scope', mode: practice.mode,
  } }), true);
  const captured = { ...current, task: typedEncounter.task, capture: {
    id: 'capture', response: { kind: 'typed_text', text: 'raw' },
    conditions: current.conditions, feedback: null,
  } };
  assert.equal(isReviewResponse({ type: 'review_session',
    session: { ...practice, encounter: captured } }), true);
  assert.equal(isReviewResponse({ type: 'review_session',
    session: { ...practice, encounter: { ...captured, capture: {
      ...captured.capture, conditions: encounter.conditions,
    } } } }), false);
  // Then stripped assistance, broadened keys and false terminal states fail closed.
  for (const invalid of [
    { ...practice, encounter: { ...current, conditions: encounter.conditions } },
    { ...practice, mode: { ...practice.mode, capabilities: ['package:reading'] } },
    { ...practice, state: 'stopped' },
    { ...practice, state: 'complete' },
  ]) assert.equal(isReviewResponse({ type: 'review_session', session: invalid }), false);
  assert.equal(isReviewResponse({ type: 'review_session', session: {
    ...practice, state: 'stopped', encounter: null, canUndo: false,
  } }), true);
  assert.equal(isReviewCommand({ kind: 'stop', mutation: {
    commandId: 'stop-once', sessionId: 'scope', expectedRevision: 1,
  } }), true);
});

test('Review rejects leaked answers malformed rows and incompatible delivery at the wire boundary', () => {
  // Given an admitted hidden-answer encounter.
  assert.equal(isReviewResponse({ type: 'review_session', session }), true);
  // When native nested content violates the exposure or bounded probe contract.
  const invalidEncounters = [
    { ...encounter, answer: 'leaked' },
    { ...encounter, answer: null, conditions: { ...encounter.conditions, revealed: true } },
    { ...encounter, hiddenAnswer: 'leaked' },
    { ...encounter, cue: 'é'.repeat(8193) },
    { ...encounter, targets: [...encounter.targets, ...encounter.targets] },
    { ...encounter, supplied: [encounter.targets[0].key] },
    { ...encounter, targets: [{ ...encounter.targets[0], key: { packageId: 'other', targetId: 'target', capability: 'meaning' } }] },
    { ...encounter, direction: 'audio' },
    { ...encounter, requiredMedia: 'audio' },
    { ...encounter, conditions: { ...encounter.conditions, delivery: 'completed' } },
    { ...encounter, conditions: { ...encounter.conditions, assistance: ['source', 'source'] } },
    { ...encounter, correction: true },
    { ...encounter, materialRevision: 0 },
  ];
  // Then malformed content never acquires the generated Review type.
  for (const value of invalidEncounters)
    assert.equal(isReviewResponse({ type: 'review_session', session: { ...session, encounter: value } }), false);
  assert.equal(isReviewResponse({ type: 'review_session', session: { ...session, encounter: {
    ...encounter, targets: [{ ...encounter.targets[0], key: null }], direction: 'audio',
    requiredMedia: 'audio', conditions: { ...encounter.conditions, delivery: 'failed' },
  } } }), true);
});

test('Review session lists and receipts enforce bounds and revision consistency', () => {
  // Given valid continuous, finite and replay projections.
  assert.equal(isReviewResponse({ type: 'review', commit: {
    commandId: 'id', committedRevision: 1, session: revealed,
  } }), true);
  assert.equal(isReviewResponse({ type: 'review_session', session: {
    ...session, mode: { kind: 'finite', limit: 10 }, total: 2,
  } }), true);
  // When a response has ambiguous sessions or impossible progress/receipt values.
  const values = [
    { type: 'review_sessions', sessions: [session, session] },
    { type: 'review_sessions', sessions: Array.from({ length: 33 }, (_, n) => ({ ...session, id: `s${n}` })) },
    { type: 'review_session', session: { ...session, total: 1 } },
    { type: 'review_session', session: { ...session, mode: { kind: 'finite', limit: 1 }, total: 2 } },
    { type: 'review_session', session: { ...session, mode: { kind: 'finite', limit: 2 }, total: 1, completed: 2 } },
    { type: 'review_session', session: { ...session, revision: NaN } },
    { type: 'review', commit: { commandId: 'id', committedRevision: 3, session: revealed } },
  ];
  // Then no invalid projection is published.
  for (const value of values) assert.equal(isReviewResponse(value), false);
});

test('Review commands preserve granular untested outcomes and reject duplicate or impossible grades', () => {
  // Given a response with a deliberately untested row.
  const command: ReviewCommand = { kind: 'submit',
    mutation: { commandId: 'id', sessionId: 'session', expectedRevision: 2 },
    response: { encounterId: 'encounter', grades: [{ targetId: 'row', quality: null, method: 'worked_out', easy: false }] },
  };
  assert.equal(isReviewCommand(command), true);
  // When grades duplicate an observation or label a non-fluent result Easy.
  const invalid = [
    { ...command, response: { ...command.response, grades: [...command.response.grades, ...command.response.grades] } },
    { ...command, response: { ...command.response, grades: [{ ...command.response.grades[0], easy: true }] } },
    { ...command, mutation: { ...command.mutation, expectedRevision: -1 } },
    { ...command, response: { ...command.response, grades: [] } },
    { kind: 'start', start: { commandId: 'id', sessionId: 's', mode: { kind: 'finite', limit: 0 } } },
  ];
  // Then malformed commands are rejected before native admission.
  for (const value of invalid) assert.equal(isReviewCommand(value), false);
});

test('prepared Review retries retain their complete identity and detached grade choices', async () => {
  // Given an uncertain native commit and an editor that subsequently changes.
  const wire: Request[] = [];
  let attempts = 0;
  const client = createReviewClient(async request => {
    wire.push(structuredClone(request));
    if (attempts++ === 0) throw new RuntimeError('transport', 'Receipt lost');
    return { type: 'review', commit: { commandId: 'once', committedRevision: 3,
      session: { ...revealed, revision: 7, encounter: null, completed: 1, canUndo: true } } };
  }, () => 'once');
  const action: ReviewAction = { kind: 'submit', response: {
    encounterId: 'encounter', grades: [{ targetId: 'row', quality: 'fluent', method: 'remembered', easy: true }],
  } };
  const command = client.prepareReviewMutation(revealed, action);
  action.response.grades[0].quality = 'missed';
  // When the same prepared intent is retried after a lost receipt.
  await assert.rejects(client.review(command), { code: 'transport' });
  const result = await client.review(command);
  // Then the exact payload replays and the original receipt is distinct from current state.
  assert.deepEqual(wire[0], wire[1]);
  assert.equal(result.committedRevision, 3);
  assert.equal(result.session.revision, 7);
  assert.ok(command.kind === 'submit');
  if (command.kind !== 'submit') throw new Error('Expected prepared Submit');
  assert.equal(command.response.grades[0].quality, 'fluent');
});

test('Review prepares and dispatches every supported action through the typed request seam', async () => {
  // Given a fresh session and every native mutation variant.
  let id = 0;
  const requests: Request[] = [];
  const client = createReviewClient(async request => {
    requests.push(request);
    assert.equal(request.type, 'review');
    if (request.type !== 'review') throw new Error('Unexpected request');
    const identity = request.command.kind === 'start' ? request.command.start : request.command.mutation;
    return { type: 'review', commit: { commandId: identity.commandId,
      committedRevision: request.command.kind === 'start' ? 1 : 2,
      session: { ...session, id: identity.sessionId, revision: request.command.kind === 'start' ? 1 : 2 } } };
  }, () => `id-${id++}`);
  const actions: ReviewAction[] = [
    { kind: 'next' }, { kind: 'reveal', encounterId: 'encounter' },
    { kind: 'delivery', encounterId: 'encounter', delivery: 'interrupted' },
    { kind: 'assistance', encounterId: 'encounter', assistance: 'inspector' },
    { kind: 'submit', response: { encounterId: 'encounter', grades: [
      { targetId: 'row', quality: 'struggled', method: 'worked_out', easy: false },
    ] } },
    { kind: 'undo' }, { kind: 'correct', response: { encounterId: 'encounter', grades: [
      { targetId: 'row', quality: 'missed', method: 'remembered', easy: false },
    ] } }, { kind: 'pause' }, { kind: 'resume' },
  ];
  // When prepared commands are dispatched.
  const start = client.prepareReviewStart({ kind: 'continuous' });
  await client.review(start);
  for (const action of actions) await client.review(client.prepareReviewMutation(session, action));
  // Then each action and the generated Start session identity reach native unchanged.
  assert.equal(requests.length, 10);
  assert.ok(start.kind === 'start');
  if (start.kind !== 'start') throw new Error('Expected prepared Start');
  assert.notEqual(start.start.commandId, start.start.sessionId);
  assert.deepEqual(requests.slice(1).map(value => value.type === 'review' ? value.command.kind : null),
    actions.map(action => action.kind));
});

test('Review rejects mismatched session command and committed revision identities', async () => {
  // Given valid native structures belonging to another request.
  const command: ReviewCommand = { kind: 'pause',
    mutation: { commandId: 'expected', sessionId: 'session', expectedRevision: 1 } };
  const commit = { commandId: 'expected', committedRevision: 2, session: revealed };
  const responses = [
    { type: 'review', commit: { ...commit, commandId: 'other' } },
    { type: 'review', commit: { ...commit, session: { ...revealed, id: 'other' } } },
    { type: 'review', commit: { ...commit, committedRevision: 1 } },
    { type: 'review_session', session: { ...session, id: 'other' } },
    { type: 'review_sessions', sessions: [] },
  ];
  const client = createReviewClient(async () => responses.shift(), () => 'id');
  // When reads/writes receive unrelated records or response kinds.
  // Then correlation failures are protocol errors, not successful writes.
  for (let n = 0; n < 3; n++) await assert.rejects(client.review(command), protocol);
  await assert.rejects(client.reviewSession('session'), protocol);
  await assert.rejects(client.reviewSession('session'), protocol);
});

test('Review fences delayed reads after a newer committed session becomes visible', { timeout: 5000 }, async () => {
  // Given a session read already in flight.
  const delayed = gate<unknown>();
  const client = createReviewClient(async request => request.type === 'review_session'
    ? delayed.promise : { type: 'review', commit: { commandId: 'reveal', committedRevision: 2, session: revealed } },
  () => 'reveal');
  const old = client.reviewSession('session');
  const rejected = assert.rejects(old, { code: 'stale_result' });
  // When Reveal commits before the older hidden-answer read resolves.
  await client.review(client.prepareReviewMutation(session, { kind: 'reveal', encounterId: 'encounter' }));
  delayed.release({ type: 'review_session', session });
  // Then the stale read cannot overwrite the revealed state.
  await rejected;
});

test('Review fences whole stale lists without poisoning unrelated session revision fences', async () => {
  // Given one current session and a stale list containing another session.
  const responses = [
    { type: 'review_session', session: revealed },
    { type: 'review_sessions', sessions: [{ ...session, id: 'other', revision: 9 }, session] },
    { type: 'review_session', session: { ...session, id: 'other' } },
  ];
  const client = createReviewClient(async () => responses.shift(), () => 'id');
  await client.reviewSession('session');
  // When one list item is stale.
  await assert.rejects(client.reviewSessions(), { code: 'stale_result' });
  // Then the rejected list has not partially advanced another session's fence.
  assert.equal((await client.reviewSession('other')).revision, 1);
});
