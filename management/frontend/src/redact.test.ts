import { isSensitiveKey, looksLikeSecret, redactLine, redactObject, redactValue } from './redact';

describe('isSensitiveKey', () => {
  it.each([
    'API_KEY',
    'authToken',
    'client_secret',
    'db_password',
    'DATABASE_URL',
    'privateKey',
    'session_cookie',
    'OPENAI_API_KEY',
    'anthropicToken',
    'deepseekSecret',
    'supabaseJwt',
    'modalTokenId',
    'cloudflareR2Secret',
  ])('detects %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(['name', 'deployment_mode', 'public_url', 'host_port'])('does not flag %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('looksLikeSecret', () => {
  it.each([
    'sk-abcdefghijklmnopqrstuvwxyz123456',
    'AKIAABCDEFGHIJKLMNOP',
    'Bearer abcdefghijklmnopqrstuvwxyz123456',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
    'postgres://user:password@localhost:5432/mlearn',
    '0123456789abcdef0123456789abcdef',
    'QWxhZGRpbjpvcGVuIHNlc2FtZSBhbmQgdGhlbiBzb21lIG1vcmU=',
  ])('detects secret-looking value %s', (value) => {
    expect(looksLikeSecret(value)).toBe(true);
  });

  it.each(['enabled', 'mlearn', 'http://localhost:7753', 'abc123'])('does not flag %s', (value) => {
    expect(looksLikeSecret(value)).toBe(false);
  });
});

describe('redactValue', () => {
  it('redacts sensitive keys', () => {
    expect(redactValue('OPENAI_API_KEY', 'not-secret-looking')).toBe('[REDACTED]');
  });

  it('redacts secret-looking values', () => {
    expect(redactValue('provider', 'sk-abcdefghijklmnopqrstuvwxyz123456')).toBe('[REDACTED]');
  });

  it('keeps safe values', () => {
    expect(redactValue('provider', 'local')).toBe('local');
  });
});

describe('redactLine', () => {
  it('redacts key-value secrets', () => {
    expect(redactLine('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456')).toBe('OPENAI_API_KEY=[REDACTED]');
  });

  it('redacts colon-separated secrets', () => {
    expect(redactLine('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456')).toBe('Authorization: [REDACTED]');
  });

  it('redacts standalone secret patterns', () => {
    expect(redactLine('token sk-abcdefghijklmnopqrstuvwxyz123456 leaked')).toBe('token [REDACTED] leaked');
  });
});

describe('redactObject', () => {
  it('redacts shallow string properties without mutating the original object', () => {
    const input = {
      OPENAI_API_KEY: 'not-secret-looking',
      provider: 'local',
      modelToken: 'safe-looking-value',
      nested: { secret: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
    };

    const redacted = redactObject(input);

    expect(redacted).toEqual({
      OPENAI_API_KEY: '[REDACTED]',
      provider: 'local',
      modelToken: '[REDACTED]',
      nested: { secret: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
    });
    expect(redacted).not.toBe(input);
    expect(input.OPENAI_API_KEY).toBe('not-secret-looking');
  });
});
