import { describe, expect, it } from 'vitest';
import type { JournalEvent } from '../../shared/world';
import { currentFeedbackAgreement, parseFeedbackAgreement, renderFeedbackAgreement } from './feedbackAgreement';

function event(id: string, seq: number, type: JournalEvent['type'], payload: unknown): JournalEvent {
  return { id, seq, roomId: 'room', scope: { kind: 'thread', threadId: 'thread' }, type,
    actorId: type === 'message.user' ? 'user' : 'harness', witnesses: ['user'], payload, createdAt: seq };
}

describe('feedback agreements', () => {
  it('retains the latest user agreement through serialization, reopening, and later conversation', () => {
    const events = [event('start', 1, 'message.user', { text: 'Correct my messages until I stop.' }),
      event('stop', 2, 'message.user', { text: 'Stop correcting. Let us talk about ice cream.' }),
      event('closed', 3, 'feedback.agreement', { sourceEventId: 'stop', active: false, scope: 'Social conversation', evidence: 'Stop correcting.' }),
      ...Array.from({ length: 20 }, (_, index) => event(`later-${index}`, index + 4, 'message.user', { text: 'Another social message' })),
      event('late-check', 24, 'feedback.agreement', { sourceEventId: 'start', active: true, scope: 'Ongoing correction', evidence: 'Correct my messages' })];
    const agreement = currentFeedbackAgreement(JSON.parse(JSON.stringify(events)));
    expect(agreement).toEqual({ active: false, scope: 'Social conversation', evidence: 'Stop correcting.' });
    expect(currentFeedbackAgreement(events, 'start')).toEqual({ active: true, scope: 'Ongoing correction', evidence: 'Correct my messages' });
    expect(renderFeedbackAgreement(agreement)).toContain('Practice activity label does not override an exit');
  });

  it('ignores invented evidence and agreements from other scopes', () => {
    const source = event('user', 1, 'message.user', { text: 'No correction now.' });
    const agreement = event('scope', 2, 'feedback.agreement', { sourceEventId: 'user', active: true, scope: 'All messages', evidence: 'Please correct me' });
    expect(currentFeedbackAgreement([source, agreement])).toBeUndefined();
    agreement.payload = { sourceEventId: 'user', active: false, scope: 'Social', evidence: 'No correction now.' };
    agreement.scope = { kind: 'thread', threadId: 'other-thread' };
    expect(currentFeedbackAgreement([source, agreement])).toBeUndefined();
    expect(parseFeedbackAgreement({ active: 'false', scope: 'Social', evidence: 'No correction now.' }, 'No correction now.')).toBeUndefined();
  });
});
