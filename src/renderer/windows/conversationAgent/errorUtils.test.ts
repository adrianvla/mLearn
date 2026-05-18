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

  it('extracts human-readable reason from embedded JSON in error strings', () => {
    expect(
      getConversationErrorMessage('Cloud LLM error: 403 {"error":"CONSENT REQUIRED"}'),
    ).toBe('Cloud LLM error: 403 Reason: CONSENT REQUIRED');

    expect(
      getConversationErrorMessage('Error: timeout {"message":"Rate limited","retry_after":60}'),
    ).toBe('Error: timeout Reason: Rate limited');
  });

  it('strips JSON arrays and objects with no readable fields', () => {
    expect(
      getConversationErrorMessage({ message: 'Failed [1,2,3]' }),
    ).toBe('Failed');

    expect(
      getConversationErrorMessage('Error: unknown {"foo":"bar"}'),
    ).toBe('Error: unknown');
  });

  it('detects cloud session failures from status, code, and message content', () => {
    expect(isCloudSessionError({ status: 401 })).toBe(true);
    expect(isCloudSessionError({ code: 'INVALID_SESSION' })).toBe(true);
    expect(isCloudSessionError('401 unauthorized')).toBe(true);
    expect(isCloudSessionError(new Error('Something else failed'))).toBe(false);
  });
});