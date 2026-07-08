import { describe, expect, it } from 'vitest';
import { redactLine } from './redact';

describe('redactLine', () => {
  it('redacts sensitive key/value pairs', () => {
    expect(redactLine('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz')).toBe('OPENAI_API_KEY=[REDACTED]');
  });

  it('redacts secret-looking values inside freeform logs', () => {
    expect(redactLine('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456')).toBe('Authorization: [REDACTED]');
  });
});
