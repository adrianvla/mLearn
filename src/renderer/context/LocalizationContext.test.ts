// Tests for pure algorithms from LocalizationContext.tsx (getNestedValue, interpolate)
// These functions are not exported, so the algorithms are recreated here for direct testing.

import { describe, it, expect } from 'vitest';

function getNestedValue(obj: Record<string, unknown>, path: string): string | null {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : null;
}

function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key] !== undefined ? String(params[key]) : match;
  });
}

describe('getNestedValue', () => {
  it('returns string value at a simple top-level key', () => {
    expect(getNestedValue({ hello: 'world' }, 'hello')).toBe('world');
  });

  it('returns string value at a dot-separated nested path', () => {
    const obj = { mlearn: { Home: { UI: { Title: 'My App' } } } };
    expect(getNestedValue(obj, 'mlearn.Home.UI.Title')).toBe('My App');
  });

  it('returns null for a missing top-level key', () => {
    expect(getNestedValue({}, 'missing')).toBeNull();
  });

  it('returns null for a missing intermediate key', () => {
    const obj = { a: { b: 'value' } };
    expect(getNestedValue(obj, 'a.x.c')).toBeNull();
  });

  it('returns null for a missing leaf key', () => {
    const obj = { a: { b: 'value' } };
    expect(getNestedValue(obj, 'a.c')).toBeNull();
  });

  it('returns null when intermediate value is null', () => {
    const obj = { a: null } as Record<string, unknown>;
    expect(getNestedValue(obj, 'a.b')).toBeNull();
  });

  it('returns null when intermediate value is undefined', () => {
    const obj = { a: undefined } as Record<string, unknown>;
    expect(getNestedValue(obj, 'a.b')).toBeNull();
  });

  it('returns null when the value is a number (non-string)', () => {
    const obj = { a: { b: 42 } } as Record<string, unknown>;
    expect(getNestedValue(obj, 'a.b')).toBeNull();
  });

  it('returns null when the value is an object (non-string)', () => {
    const obj = { a: { b: { c: 'deep' } } };
    expect(getNestedValue(obj, 'a.b')).toBeNull();
  });

  it('returns null when the value is a boolean (non-string)', () => {
    const obj = { a: true } as Record<string, unknown>;
    expect(getNestedValue(obj, 'a')).toBeNull();
  });

  it('returns an empty string value correctly', () => {
    const obj = { a: '' };
    expect(getNestedValue(obj, 'a')).toBe('');
  });
});

describe('interpolate', () => {
  it('returns the original string when no params are provided', () => {
    expect(interpolate('Hello World')).toBe('Hello World');
  });

  it('replaces a single placeholder with its string value', () => {
    expect(interpolate('Hello {name}', { name: 'World' })).toBe('Hello World');
  });

  it('replaces multiple placeholders', () => {
    expect(interpolate('{greeting}, {name}!', { greeting: 'Hi', name: 'Ada' })).toBe('Hi, Ada!');
  });

  it('converts a number param to a string', () => {
    expect(interpolate('You have {count} messages', { count: 5 })).toBe('You have 5 messages');
  });

  it('leaves unmatched placeholders as-is', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
  });

  it('leaves a placeholder untouched when param key is absent', () => {
    expect(interpolate('Hello {name} and {other}', { name: 'Ada' })).toBe('Hello Ada and {other}');
  });

  it('returns the string unchanged when params is undefined', () => {
    expect(interpolate('{key}', undefined)).toBe('{key}');
  });

  it('handles a string with no placeholders and params provided', () => {
    expect(interpolate('No placeholders here', { extra: 'value' })).toBe('No placeholders here');
  });

  it('replaces duplicate placeholders each time', () => {
    expect(interpolate('{x} plus {x}', { x: '2' })).toBe('2 plus 2');
  });

  it('handles zero as a number param', () => {
    expect(interpolate('Count: {n}', { n: 0 })).toBe('Count: 0');
  });
});
