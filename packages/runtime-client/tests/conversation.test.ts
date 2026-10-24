import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Contact, Conversation, ConversationAnalysisBatch, ConversationGeneration, ConversationMessage } from '@mlearn/contracts';
import { createConversationClient } from '../src/conversationClient.ts';
import { isConversationResponse } from '../src/conversationProtocol.ts';
import { RuntimeError } from '../src/errors.ts';
import { createRuntimeClient } from '../src/client.ts';

const revision = 'a'.repeat(64);
const contact: Contact = { id: 'person', revision: 1, name: 'Person', description: '', archived: false };
const conversation: Conversation = { id: 'chat', revision: 4, kind: 'direct', title: 'Person',
  purpose: '', packageId: 'language', participants: [contact.id], discarded: false };
const message: ConversationMessage = { id: 'message', conversationId: conversation.id, sequence: 1, revision: 1,
  text: '猫🌱', contentRevision: revision, createdAtMs: 123, role: 'user', participantId: null,
  replyTo: null, generationId: null, status: 'complete', sources: [] };
const batch: ConversationAnalysisBatch = { conversationId: conversation.id, packageId: 'language', packageVersion: '1',
  packageRevision: revision, messages: [{ messageId: message.id, messageRevision: 1, contentRevision: revision,
    text: message.text, tokens: [{ start: 0, end: 3, text: '猫', targets: ['cat'] }, { start: 3, end: 7, text: '🌱', targets: [] }] }],
  knowledge: [], annotations: [{ messageId: message.id, tokenStart: 0, status: 'untracked' }] };
const protocolError = (cause: unknown) => cause instanceof RuntimeError && cause.code === 'protocol';

test('contact retry preserves the admitted command and rejects another identity', async () => {
  // Given an uncertain transport outcome, not an uncommitted UI-generated person.
  let sequence = 0;
  let fail = true;
  const commands: unknown[] = [];
  const client = createConversationClient(async request => {
    commands.push(structuredClone(request));
    if (fail) { fail = false; throw new Error('transport lost'); }
    return { type: 'conversation', result: { kind: 'contact', contact: { ...contact, revision: 2 } } };
  }, () => `id-${++sequence}`);
  const command = client.prepareConversationContact(contact);
  // When the same prepared action is retried.
  await assert.rejects(client.saveConversationContact(command));
  const saved = await client.saveConversationContact(command);
  // Then both attempts have identical IDs, CAS values and payloads.
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(saved.revision, 2);
  const wrong = createConversationClient(async () => ({
    type: 'conversation', result: { kind: 'contact', contact: { ...saved, id: 'other-person' } },
  }), () => 'unused');
  await assert.rejects(wrong.saveConversationContact(command), protocolError);
});

test('direct creation accepts native contact and package reuse without cloning its identity', async () => {
  const client = createConversationClient(async () => ({
    type: 'conversation', result: { kind: 'conversation', conversation },
  }), () => 'new-id');
  const command = client.prepareConversation({ kind: 'direct', title: 'Person', purpose: '',
    packageId: conversation.packageId, participants: [contact.id] });
  const result = await client.createConversation(command);
  assert.equal(result.id, conversation.id);
  assert.notEqual(result.id, command.conversation.id);
});

test('message pages reject foreign conversation rows and unordered pagination', async () => {
  let items = [message];
  const client = createConversationClient(async () => ({
    type: 'conversation', result: { kind: 'messages', page: { items, next: null } },
  }), () => 'unused');
  assert.deepEqual((await client.conversationMessages(conversation.id)).items, [message]);
  items = [{ ...message, conversationId: 'other-chat' }];
  await assert.rejects(client.conversationMessages(conversation.id), protocolError);
  items = [{ ...message, id: 'first', sequence: 1 }, { ...message, id: 'second', sequence: 2 }];
  await assert.rejects(client.conversationMessages(conversation.id), protocolError);
});

test('native message analysis validates UTF-8 coverage and exact requested revisions', async () => {
  let value = structuredClone(batch);
  const client = createConversationClient(async () => ({
    type: 'conversation', result: { kind: 'analysis', batch: value },
  }), () => 'unused');
  assert.deepEqual(await client.analyzeVisibleMessages(conversation.id, [{ id: message.id, revision: 1 }]), batch);
  value.messages[0].messageRevision = 2;
  await assert.rejects(client.analyzeVisibleMessages(conversation.id, [{ id: message.id, revision: 1 }]), protocolError);
  value = structuredClone(batch);
  value.messages[0].tokens[0].end = 4;
  assert.equal(isConversationResponse({ type: 'conversation', result: { kind: 'analysis', batch: value } }), false);
});

test('response guards bound list sizes and reject unknown publication states', () => {
  assert.equal(isConversationResponse({ type: 'conversation', result: {
    kind: 'contacts', page: { items: Array.from({ length: 31 }, (_, index) => ({ ...contact, id: String(index) })), next: null },
  } }), false);
  assert.equal(isConversationResponse({ type: 'conversation', result: {
    kind: 'message', message: { ...message, status: 'invented' },
  } }), false);
});

test('conversation previews are bounded native rows belonging to the returned page', async () => {
  const preview = { conversationId: conversation.id, messageId: message.id, text: message.text,
    createdAtMs: message.createdAtMs, status: message.status };
  let previews = [preview];
  const client = createConversationClient(async () => ({
    type: 'conversation', result: { kind: 'conversations', page: { items: [conversation], previews, next: null } },
  }), () => 'unused');
  assert.deepEqual((await client.conversations()).previews, previews);
  previews = [{ ...preview, conversationId: 'foreign' }];
  await assert.rejects(client.conversations(), protocolError);
  previews = [preview, preview];
  await assert.rejects(client.conversations(), protocolError);
  previews = [{ ...preview, text: '🌱'.repeat(161) }];
  await assert.rejects(client.conversations(), protocolError);
});

test('prepared turns snapshot original source context and verify generation publication IDs', async () => {
  let sequence = 0;
  const seen: unknown[] = [];
  let returnedUser = 'wrong';
  const client = createConversationClient(async request => {
    seen.push(request);
    if (request.type !== 'conversation' || request.command.action !== 'send_turn') throw new Error('unexpected test request');
    const turn = request.command.turn;
    const generation: ConversationGeneration = {
      id: turn.generationId, conversationId: turn.conversationId, conversationRevision: turn.expectedRevision + 1,
      userMessageId: returnedUser === 'wrong' ? 'wrong' : turn.userMessageId, assistantMessageId: turn.assistantMessageId,
      retryOf: null, status: 'pending', startedAtMs: null, finishedAtMs: null, error: null,
    };
    return { type: 'conversation', result: { kind: 'generation', generation } };
  }, () => `id-${++sequence}`);
  const sources = [{
    sourceId: conversation.id, contentRevision: revision, packageId: conversation.packageId, packageVersion: '1',
    text: message.text, locator: { kind: 'message' as const, conversationId: conversation.id,
      messageId: message.id, messageRevision: message.revision, contextStart: 0, selectionStart: 0, selectionEnd: 3 },
  }];
  const turn = client.prepareConversationTurn(conversation, contact.id, message.text, null, sources);
  sources[0].text = 'different';
  assert.equal(turn.sources[0].text, message.text);
  await assert.rejects(client.sendConversationTurn(turn), protocolError);
  returnedUser = 'correct';
  const generation = await client.sendConversationTurn(turn);
  assert.equal(generation.userMessageId, turn.userMessageId);
  assert.deepEqual(seen[0], seen[1]);
});

test('draft and message mutations reject mismatched CAS revisions', async () => {
  const client = createConversationClient(async request => {
    if (request.type !== 'conversation') throw new Error('unexpected test request');
    switch (request.command.action) {
      case 'save_draft': return { type: 'conversation', result: { kind: 'draft', draft: request.command.draft } };
      case 'edit_message': return { type: 'conversation', result: { kind: 'message', message } };
      default: throw new Error('unexpected test action');
    }
  }, () => 'command');
  const draft = client.prepareConversationDraft({ conversationId: conversation.id, revision: 2, text: 'draft', replyTo: null });
  await assert.rejects(client.saveConversationDraft(draft), protocolError);
  await assert.rejects(client.changeConversationMessage(client.prepareConversationMessageEdit(message, message.text)), protocolError);
});

test('saved history remains readable while explanation admission is in flight', { timeout: 5000 }, async () => {
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const source = {
    sourceId: conversation.id, contentRevision: revision, packageId: conversation.packageId, packageVersion: '1',
    text: message.text, locator: { kind: 'message' as const, conversationId: conversation.id,
      messageId: message.id, messageRevision: message.revision, contextStart: 0, selectionStart: 0, selectionEnd: 3 },
  };
  const admitted: ConversationGeneration = {
    id: 'explanation-generation', conversationId: 'explanation-chat', conversationRevision: 2,
    userMessageId: 'explanation-user', assistantMessageId: 'explanation-response', retryOf: null,
    status: 'pending', startedAtMs: null, finishedAtMs: null, error: null,
  };
  const explanationMessages: ConversationMessage[] = [
    { ...message, id: admitted.assistantMessageId, conversationId: admitted.conversationId, sequence: 2,
      role: 'assistant', generationId: admitted.id, text: '', status: 'pending' },
    { ...message, id: admitted.userMessageId, conversationId: admitted.conversationId, text: 'context', sources: [source] },
  ];
  const client = createRuntimeClient({
    commandId: () => 'explanation-command',
    execute: async raw => {
      const request: unknown = JSON.parse(raw);
      if (request === null || typeof request !== 'object' || !('command' in request)
        || request.command === null || typeof request.command !== 'object' || !('action' in request.command))
        throw new Error('unexpected test request');
      if (request.command.action === 'explain') {
        entered(); await gate;
        return JSON.stringify({ type: 'conversation', result: { kind: 'generation', generation: admitted } });
      }
      if (request.command.action === 'get_conversation') return JSON.stringify({
        type: 'conversation', result: { kind: 'conversation', conversation: {
          ...conversation, id: admitted.conversationId, kind: 'thread', revision: 2,
        } },
      });
      return JSON.stringify({ type: 'conversation', result: { kind: 'messages', page: {
        items: 'conversationId' in request.command && request.command.conversationId === admitted.conversationId
          ? explanationMessages : [message], next: null,
      } } });
    },
  });
  const prepared = client.prepareConversationExplanation(source, 'context');
  const explanation = client.explainConversationSource(prepared);
  await ready;
  try {
    const history = await client.conversationMessages(conversation.id);
    assert.equal(history.items[0].id, message.id);
    assert.equal(prepared.commandId, 'explanation-command');
  } finally { release(); }
  assert.equal((await explanation).id, admitted.id);
});

test('retrying a failed response rejects publication under a different user message', async () => {
  const previous: ConversationGeneration = {
    id: 'previous', conversationId: conversation.id, conversationRevision: conversation.revision,
    userMessageId: message.id, assistantMessageId: 'previous-response', retryOf: null, status: 'failed',
    startedAtMs: 1, finishedAtMs: 2, error: 'failure',
  };
  let sequence = 0;
  const client = createConversationClient(async request => {
    if (request.type !== 'conversation' || request.command.action !== 'retry_generation') throw new Error('unexpected test request');
    const retry = request.command.retry;
    return { type: 'conversation', result: { kind: 'generation', generation: {
      ...previous, id: retry.generationId, conversationRevision: retry.expectedRevision + 1,
      assistantMessageId: retry.assistantMessageId, userMessageId: 'duplicate-user', retryOf: previous.id, status: 'pending',
      startedAtMs: null, finishedAtMs: null, error: null,
    } } };
  }, () => `retry-${++sequence}`);
  const retry = client.prepareConversationRetry(previous, conversation);
  await assert.rejects(client.retryConversationGeneration(retry, previous), protocolError);
});

test('explanation admission rejects the obsolete synchronous text result', async () => {
  const source = {
    sourceId: conversation.id, contentRevision: revision, packageId: conversation.packageId, packageVersion: '1',
    text: message.text, locator: { kind: 'message' as const, conversationId: conversation.id,
      messageId: message.id, messageRevision: 1, contextStart: 0, selectionStart: 0, selectionEnd: 3 },
  };
  const client = createConversationClient(async () => ({
    type: 'conversation', result: { kind: 'explanation', source, text: 'not an admitted generation' },
  }), () => 'explanation-command');
  await assert.rejects(client.explainConversationSource(client.prepareConversationExplanation(source, 'context')), protocolError);
});

test('explanation generation must retain the requested frozen source origin', async () => {
  const source = {
    sourceId: conversation.id, contentRevision: revision, packageId: conversation.packageId, packageVersion: '1',
    text: message.text, locator: { kind: 'message' as const, conversationId: conversation.id,
      messageId: message.id, messageRevision: 1, contextStart: 0, selectionStart: 0, selectionEnd: 3 },
  };
  const g: ConversationGeneration = { id: 'generation', conversationId: 'explanation', conversationRevision: 2,
    userMessageId: 'user', assistantMessageId: 'response', retryOf: null, status: 'pending',
    startedAtMs: null, finishedAtMs: null, error: null };
  const client = createConversationClient(async request => {
    if (request.type !== 'conversation') throw new Error('unexpected test request');
    switch (request.command.action) {
      case 'explain': return { type: 'conversation', result: { kind: 'generation', generation: g } };
      case 'get_conversation': return { type: 'conversation', result: { kind: 'conversation',
        conversation: { ...conversation, id: g.conversationId, kind: 'thread', revision: 2 } } };
      case 'read_messages': return { type: 'conversation', result: { kind: 'messages', page: { next: null, items: [
        { ...message, id: g.assistantMessageId, conversationId: g.conversationId, role: 'assistant', sequence: 2, generationId: g.id },
        { ...message, id: g.userMessageId, conversationId: g.conversationId, text: 'context', sources: [{
          ...source, sourceId: 'other-chat', locator: { ...source.locator, conversationId: 'other-chat' },
        }] },
      ] } } };
      default: throw new Error('unexpected test action');
    }
  }, () => 'command');
  await assert.rejects(client.explainConversationSource(client.prepareConversationExplanation(source, 'context')), protocolError);
});
