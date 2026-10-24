import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewSession } from '@mlearn/contracts';
import { createRuntimeClient, RuntimeError } from '../src/client';

const session: ReviewSession = {
  id: 'session', revision: 1, mode: { kind: 'continuous' }, state: 'active',
  completed: 0, total: null, encounter: null, canUndo: false, message: null,
};

function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('the runtime client composes prepared Review commands and bounded session reads', async () => {
  // Given the public runtime client, not a separately constructed Review client.
  let identity = 0;
  const requests: unknown[] = [];
  const client = createRuntimeClient({
    commandId: () => `identity-${identity++}`,
    execute: async raw => {
      const request: unknown = JSON.parse(raw);
      requests.push(request);
      assert.ok(request && typeof request === 'object' && 'type' in request);
      switch (request.type) {
        case 'review_sessions': return JSON.stringify({ type: 'review_sessions', sessions: [session] });
        case 'review_session': return JSON.stringify({ type: 'review_session', session });
        case 'review': return JSON.stringify({ type: 'review', commit: {
          commandId: 'identity-0', committedRevision: 1, session: { ...session, id: 'identity-1' },
        } });
        default: throw new Error('Unexpected runtime operation');
      }
    },
  });
  // When a scheduler-led session is prepared, started and subsequently read.
  const command = client.prepareReviewStart({ kind: 'continuous' });
  const commit = await client.review(command);
  const current = await client.reviewSession(session.id);
  const recent = await client.reviewSessions();
  // Then the shared transport receives typed native operations and identities.
  assert.equal(commit.session.id, 'identity-1');
  assert.deepEqual(current, session);
  assert.deepEqual(recent, [session]);
  assert.deepEqual(requests, [
    { type: 'review', command: { kind: 'start', start: {
      commandId: 'identity-0', sessionId: 'identity-1', mode: { kind: 'continuous' },
    } } },
    { type: 'review_session', sessionId: session.id },
    { type: 'review_sessions' },
  ]);
});

test('source replacement fences queued Review Return but preserves durable Review writes', { timeout: 5000 }, async () => {
  // Given Return and a session mutation queued behind an admitted checkpoint.
  const entered = gate();
  const release = gate();
  const admitted: string[] = [];
  const client = createRuntimeClient({
    commandId: () => 'pause-once',
    execute: async raw => {
      const request: unknown = JSON.parse(raw);
      assert.ok(request && typeof request === 'object' && 'type' in request && typeof request.type === 'string');
      admitted.push(request.type);
      switch (request.type) {
        case 'save_position':
          entered.release();
          await release.promise;
          return JSON.stringify({ type: 'position_saved' });
        case 'review': return JSON.stringify({ type: 'review', commit: {
          commandId: 'pause-once', committedRevision: 2,
          session: { ...session, revision: 2, state: 'paused' },
        } });
        default: throw new Error('An obsolete source Return reached the native transport');
      }
    },
  });
  const checkpoint = client.savePosition('source', 1000, 30000);
  await entered.promise;
  const obsolete = assert.rejects(client.returnReviewSource(session.id, 'encounter'),
    (error: unknown) => error instanceof RuntimeError && error.code === 'cancelled');
  const pause = client.review(client.prepareReviewMutation(session, { kind: 'pause' }));
  // When a new source session supersedes the old source-bound action.
  try { await client.beginSourceSession().ready; } finally { release.release(); }
  const [, , commit] = await Promise.all([checkpoint, obsolete, pause]);
  // Then Return is discarded without cancelling the durable session mutation.
  assert.equal(commit.session.state, 'paused');
  assert.equal(commit.committedRevision, 2);
  assert.deepEqual(admitted, ['save_position', 'review']);
});
