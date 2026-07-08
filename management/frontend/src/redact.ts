const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  'KEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASS',
  'JWT',
  'DATABASE_URL',
  'DB_URL',
  'PRIVATE',
  'COOKIE',
  'SESSION',
  'AUTH',
  'OPENAI',
  'ANTHROPIC',
  'DEEPSEEK',
  'SUPABASE',
  'MODAL',
  'CLOUDFLARE',
  'R2',
];

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /Bearer\s+[a-zA-Z0-9._~+/=-]{20,}/,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
  /postgres(?:ql)?:\/\/[^\s:@]+:[^\s:@]+@/,
  /\b[a-fA-F0-9]{32,}\b/,
  /\b[a-zA-Z0-9+/]{40,}={0,2}\b/,
];

const KEY_VALUE_PATTERN = /^([\w.-]+)(\s*[=:]\s*)(.*)$/;

export function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalizedKey.includes(pattern));
}

export function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export function redactValue(key: string, value: string): string {
  if (isSensitiveKey(key) || looksLikeSecret(value)) {
    return REDACTED;
  }

  return value;
}

export function redactLine(line: string): string {
  const match = KEY_VALUE_PATTERN.exec(line);

  if (match) {
    const [, key, separator, value] = match;
    return `${key}${separator}${redactValue(key, value)}`;
  }

  return SECRET_VALUE_PATTERNS.reduce((redactedLine, pattern) => redactedLine.replace(pattern, REDACTED), line);
}

export function redactObject<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactValue(key, value) : value,
    ]),
  ) as T;
}
