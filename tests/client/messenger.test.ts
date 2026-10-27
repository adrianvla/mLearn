import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationMessage } from '@mlearn/contracts';
import { mergeMessagePage, messageAnchor, shouldSendComposer, visibleMessageBatch } from '../../apps/client/src/features/messenger/messageFlow.ts';

function message(sequence: number, text = '猫🌱'): ConversationMessage {
  return { id: `message-${sequence}`, conversationId: 'chat', sequence, revision: 1, text,
    contentRevision: 'a'.repeat(64), createdAtMs: 123, role: 'user', participantId: null, replyTo: null,
    generationId: null, status: 'complete', sources: [] };
}
test('message anchors retain the actual context and original UTF-8 selection', () => {
  const original = message(1);
  const anchor = messageAnchor(original, 'language', '1', { start: 3, end: 7 });
  assert.equal(anchor.text, original.text);
  assert.equal(anchor.contentRevision, original.contentRevision);
  assert.deepEqual(anchor.locator, { kind: 'message', conversationId: 'chat', messageId: original.id,
    messageRevision: 1, contextStart: 0, selectionStart: 3, selectionEnd: 7 });
  assert.throws(() => messageAnchor(original, 'language', '1', { start: 1, end: 3 }));
});
test('visible analysis excludes provisional messages and respects the native aggregate byte budget', () => {
  const rows = [message(1, 'あ'.repeat(2000)), message(2, 'い'.repeat(2000)),
    { ...message(3), status: 'partial' as const }, message(4, 'complete')];
  const batch = visibleMessageBatch(rows, rows.map(row => row.id));
  assert.deepEqual(batch.map(row => row.id), [rows[0].id, rows[3].id]);
  assert.equal(visibleMessageBatch(Array.from({ length: 12 }, (_, index) => message(index + 1)),
    Array.from({ length: 12 }, (_, index) => `message-${index + 1}`)).length, 8);
});
test('history prepend deduplicates messages and never replaces a newer native revision', () => {
  const current = [{ ...message(2), revision: 3 }, message(3)];
  const result = mergeMessagePage(current, [message(1), message(2)], true);
  assert.deepEqual(result.map(row => [row.sequence, row.revision]), [[1, 1], [2, 3], [3, 1]]);
});
test('history windows remain bounded while preserving the requested older page', () => {
  const current = Array.from({ length: 120 }, (_, index) => message(index + 41));
  const older = Array.from({ length: 40 }, (_, index) => message(index + 1));
  const result = mergeMessagePage(current, older, true);
  assert.equal(result.length, 120);
  assert.equal(result[0].sequence, 1);
  assert.equal(result.at(-1)?.sequence, 120);
});
test('composer sends only a plain non-composing Enter', () => {
  assert.equal(shouldSendComposer('Enter', false, false), true);
  assert.equal(shouldSendComposer('Enter', true, false), false);
  assert.equal(shouldSendComposer('Enter', false, true), false);
  assert.equal(shouldSendComposer('Enter', false, false, 229), false);
  assert.equal(shouldSendComposer('a', false, false), false);
});
