import { describe, expect, it } from 'vitest';
import { getConversationErrorMessage, isCloudSessionError } from './errorUtils';

describe('conversationAgent errorUtils', () => {
  it('extracts the message from native Error instances', () => {
    expect(getConversationErrorMessage(new Error('Network failed'))).toBe('Network failed');
  });

  it('extracts string messages from plain error payloads', () => {
    expect(getConversationErrorMessage({ message: 'Unauthorized', status: 401 })).toBe('Unauthorized');
    expect(getConversationErrorMessage({ error: 'Model crashed' })).toBe('Model crashed');
  });

  it('falls back to JSON for unknown objects', () => {
    expect(getConversationErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('detects cloud session failures from status, code, and message content', () => {
    expect(isCloudSessionError({ status: 401 })).toBe(true);
    expect(isCloudSessionError({ code: 'INVALID_SESSION' })).toBe(true);
    expect(isCloudSessionError('401 unauthorized')).toBe(true);
    expect(isCloudSessionError(new Error('Something else failed'))).toBe(false);
  });
});