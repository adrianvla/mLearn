import { describe, expect, it } from 'vitest';
import { parseGuardVerdict, parseProductReview } from './conversationReview';
import { inferenceEvents } from './inferenceBoundary';
import type { JournalEvent } from './world';

const event = (id: string, type: JournalEvent['type'], payload: unknown): JournalEvent => ({
  id, type, payload, roomId: 'room', scope: { kind: 'sea' }, seq: 1, actorId: 'user', witnesses: ['user'], createdAt: 1,
});

describe('conversation review contracts', () => {
  it('requires exact evidence for a nonordinary review and rejects invented citations', () => {
    expect(parseProductReview('{"decision":"allow","reason":"sexual-interaction","subject":"user","evidence":"be my partner"}',
      'Please be my partner', 'I would rather talk about books.').reason).toBe('sexual-interaction');
    expect(() => parseProductReview('{"decision":"redirect","reason":"sexual-interaction","subject":"assistant","evidence":"missing"}',
      'hello', 'I would rather talk about books.')).toThrow(/exact current-text/);
    expect(() => parseProductReview('{"decision":"support","reason":"self-harm","subject":"assistant","evidence":"books"}',
      'hello', 'books')).toThrow(/support/);
  });

  it('does not reject an ordinary allow because the model supplied incidental evidence', () => {
    expect(parseProductReview('{"decision":"allow","reason":"none","subject":"assistant","evidence":"ordinary exchange"}',
      'Hello', 'Good evening')).toEqual({ decision: 'allow', reason: 'none', subject: 'assistant', evidence: '' });
    expect(parseProductReview('{"decision":"allow","reason":"none","subject":"none","evidence":""}',
      'Hello', 'Good evening')).toEqual({ decision: 'allow', reason: 'none', subject: 'user', evidence: '' });
    expect(() => parseProductReview('{"decision":"redirect","reason":"sexual-interaction","subject":"none","evidence":"Hello"}',
      'Hello', 'Good evening')).toThrow(/invalid judgment/);
  });

  it('normalizes role aliases without relaxing evidence for restrictive decisions', () => {
    expect(parseProductReview('{"decision":"allow","reason":"reference","subject":"learner","evidence":"hello"}',
      'Hello', 'Good evening')).toEqual({ decision: 'allow', reason: 'reference', subject: 'user', evidence: '' });
    expect(() => parseProductReview('{"decision":"redirect","reason":"sexual-interaction","subject":"candidate","evidence":"invented"}',
      'Hello', 'Good evening')).toThrow(/exact current-text/);
  });

  it('accepts a fenced JSON verdict but not prose around it', () => {
    expect(parseProductReview('```json\n{"decision":"allow","reason":"none","subject":"assistant","evidence":""}\n```',
      'Hello', 'Good evening').decision).toBe('allow');
    expect(() => parseProductReview('Sure: {"decision":"allow","reason":"none","subject":"assistant","evidence":""}',
      'Hello', 'Good evening')).toThrow(/invalid JSON/);
  });

  it('parses the official guard labels without treating malformed output as safe', () => {
    expect(parseGuardVerdict('Safety: Unsafe\nCategories: Sexual Content or Sexual Acts\nRefusal: No')).toEqual({
      safety: 'Unsafe', categories: ['Sexual Content or Sexual Acts'], refusal: 'No',
    });
    expect(() => parseGuardVerdict('No problem here')).toThrow(/invalid verdict/);
  });

  it('keeps raw journal messages but removes reviewed-out text from inference', () => {
    const raw = [event('u1', 'message.user', { text: 'Do not infer this' }),
      event('u2', 'message.user', { text: 'A normal message' }),
      event('review1', 'review.boundary', { sourceEventId: 'u1' }),
      event('review2', 'review.admitted', { sourceEventId: 'u2' })];
    expect(raw).toHaveLength(4);
    expect(inferenceEvents(raw).map(item => item.id)).toEqual(['u2']);
  });
});
