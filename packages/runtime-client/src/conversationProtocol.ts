import type { Contact, Conversation, ConversationDraft, ConversationGeneration, ConversationMessage, ConversationResult, Response } from '@mlearn/contracts';
import { isSourceAnchor } from './sourceProtocol';
import { isAnalyzedToken, isKnowledgeProjection } from './watchProtocol';

const encoder = new TextEncoder();
const encodedBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 8192): v is string =>
  typeof v === 'string' && !v.includes('\0') && encoder.encode(v).length <= max;
const id = (v: unknown): v is string => text(v, 128) && v.length > 0;
const uint = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4294967295;
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const nullable = (v: unknown, guard: (v: unknown) => boolean) => v === null || guard(v);
const list = (v: unknown, max: number, guard: (v: unknown) => boolean): v is unknown[] =>
  Array.isArray(v) && v.length <= max && v.every(guard);
const member = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v);
const reference = (v: unknown) => object(v) && id(v.id) && uint(v.revision) && v.revision > 0;
const unique = (items: unknown[], key: string) =>
  new Set(items.map(item => object(item) ? item[key] : item)).size === items.length;

export function isContact(v: unknown): v is Contact {
  return object(v) && id(v.id) && uint(v.revision) && text(v.name, 256) && v.name.trim().length > 0
    && text(v.description) && typeof v.archived === 'boolean';
}
export function isConversation(v: unknown): v is Conversation {
  return object(v) && id(v.id) && uint(v.revision) && member(v.kind, ['direct', 'thread'])
    && text(v.title, 256) && text(v.purpose, 4096) && id(v.packageId)
    && list(v.participants, 8, id) && v.participants.length > 0
    && new Set(v.participants).size === v.participants.length
    && (v.kind !== 'direct' || v.participants.length === 1) && typeof v.discarded === 'boolean';
}
export function isConversationDraft(v: unknown): v is ConversationDraft {
  return object(v) && id(v.conversationId) && uint(v.revision) && text(v.text)
    && nullable(v.replyTo, reference);
}
export function isConversationMessage(v: unknown): v is ConversationMessage {
  return object(v) && id(v.id) && id(v.conversationId) && uint(v.sequence) && v.sequence > 0
    && uint(v.revision) && v.revision > 0 && member(v.role, ['user', 'assistant'])
    && nullable(v.participantId, id) && nullable(v.replyTo, reference) && text(v.text)
    && member(v.status, ['pending', 'partial', 'complete', 'failed', 'cancelled', 'interrupted', 'invalidated', 'deleted'])
    && nullable(v.generationId, id) && list(v.sources, 8, isSourceAnchor)
    && time(v.createdAtMs) && typeof v.contentRevision === 'string' && /^[a-f0-9]{64}$/.test(v.contentRevision);
}
export function isConversationGeneration(v: unknown): v is ConversationGeneration {
  return object(v) && id(v.id) && id(v.conversationId) && uint(v.conversationRevision)
    && id(v.userMessageId) && id(v.assistantMessageId) && v.userMessageId !== v.assistantMessageId
    && nullable(v.retryOf, id) && member(v.status, ['pending', 'streaming', 'complete', 'failed', 'cancelled', 'interrupted', 'invalidated'])
    && nullable(v.startedAtMs, time) && nullable(v.finishedAtMs, time)
    && nullable(v.error, value => text(value, 4096))
    && !(typeof v.startedAtMs === 'number' && typeof v.finishedAtMs === 'number' && v.finishedAtMs < v.startedAtMs);
}

function page(v: unknown, guard: (v: unknown) => boolean, limit: number, numeric = false) {
  if (!object(v) || !list(v.items, limit, guard) || !unique(v.items, 'id')) return false;
  return nullable(v.next, numeric ? uint : id);
}

export function isConversationResult(v: unknown): v is ConversationResult {
  if (!object(v) || encodedBytes(v) > 500000) return false;
  switch (v.kind) {
    case 'contacts': return page(v.page, isContact, 30);
    case 'contact': return isContact(v.contact);
    case 'conversations': {
      const p = v.page;
      if (!page(p, isConversation, 30) || !object(p) || !Array.isArray(p.items)
        || !list(p.previews, 30, row => object(row) && id(row.conversationId) && id(row.messageId)
          && text(row.text, 640) && time(row.createdAtMs)
          && member(row.status, ['pending', 'partial', 'complete', 'failed', 'cancelled', 'interrupted', 'invalidated', 'deleted']))
        || !unique(p.previews, 'conversationId')) return false;
      const items = p.items;
      return p.previews.every(row => object(row) && items.some(item => isConversation(item) && item.id === row.conversationId));
    }
    case 'conversation': return isConversation(v.conversation);
    case 'messages': return page(v.page, isConversationMessage, 40, true);
    case 'message': return isConversationMessage(v.message);
    case 'draft': return isConversationDraft(v.draft);
    case 'prepared': return isConversation(v.conversation) && list(v.participants, 8, isContact)
      && unique(v.participants, 'id') && list(v.messages, 40, isConversationMessage)
      && unique(v.messages, 'id') && typeof v.truncated === 'boolean';
    case 'generation': return isConversationGeneration(v.generation);
    case 'trace': {
      const p = v.page;
      if (!object(p) || !isConversationGeneration(p.generation) || !list(p.inputs, 40, reference)
        || !unique(p.inputs, 'id') || !nullable(p.next, uint)
        || !list(p.items, 40, row => object(row) && uint(row.sequence)
          && member(row.kind, ['prompt', 'request', 'delta', 'response', 'tool_call', 'tool_result', 'error'])
          && text(row.content, 4096) && time(row.atMs))) return false;
      let sequence = -1;
      for (const row of p.items) {
        if (!object(row) || !uint(row.sequence) || row.sequence <= sequence) return false;
        sequence = row.sequence;
      }
      return p.next === null || p.next === sequence;
    }
    case 'provider_settings': return object(v.settings) && uint(v.settings.revision)
      && text(v.settings.endpoint, 2048) && text(v.settings.model, 256)
      && typeof v.settings.sessionCredentialReady === 'boolean';
    case 'credential_ready': return typeof v.ready === 'boolean';
    case 'analysis': {
      const batch = v.batch;
      if (!object(batch) || !id(batch.conversationId) || !id(batch.packageId) || !text(batch.packageVersion, 128)
        || typeof batch.packageRevision !== 'string' || !/^[a-f0-9]{64}$/.test(batch.packageRevision)
        || !list(batch.knowledge, 256, isKnowledgeProjection)
        || !list(batch.messages, 8, message => object(message) && id(message.messageId)
          && uint(message.messageRevision) && message.messageRevision > 0
          && typeof message.contentRevision === 'string' && /^[a-f0-9]{64}$/.test(message.contentRevision)
          && text(message.text) && list(message.tokens, 4096, isAnalyzedToken))
        || !unique(batch.messages, 'messageId')
        || !list(batch.annotations, 8192, annotation => object(annotation) && id(annotation.messageId)
          && uint(annotation.tokenStart) && text(annotation.status, 128))) return false;
      let total = 0;
      for (const message of batch.messages) {
        if (!object(message) || typeof message.text !== 'string' || !Array.isArray(message.tokens)) return false;
        const bytes = encoder.encode(message.text);
        total += bytes.length;
        let cursor = 0;
        for (const token of message.tokens) {
          if (!isAnalyzedToken(token) || token.start !== cursor || token.end > bytes.length
            || encoder.encode(token.text).length !== token.end - token.start
            || new TextDecoder().decode(bytes.subarray(token.start, token.end)) !== token.text) return false;
          cursor = token.end;
        }
        if (cursor !== bytes.length) return false;
      }
      const messages = batch.messages;
      return total <= 8192 && batch.annotations.every(annotation => object(annotation)
        && messages.some(message => object(message) && message.messageId === annotation.messageId
          && Array.isArray(message.tokens) && message.tokens.some(token =>
            isAnalyzedToken(token) && token.start === annotation.tokenStart)));
    }
    default: return false;
  }
}
export function isConversationResponse(v: unknown): v is Extract<Response, { type: 'conversation' }> {
  return object(v) && v.type === 'conversation' && isConversationResult(v.result);
}
