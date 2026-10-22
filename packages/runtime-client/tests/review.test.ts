import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, ReviewCommand, ReviewEncounter, ReviewSession } from '@mlearn/contracts';
import { createReviewClient, type ReviewAction } from '../src/reviewClient';
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
