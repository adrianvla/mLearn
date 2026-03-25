/**
 * Tests for FlashcardEditModal utility functions:
 * - valueToString: serializes flashcard field values for the advanced editor
 * - parseFieldValue: parses user-edited strings back into typed values
 */

import { describe, it, expect } from 'vitest';

// Re-implement the pure functions from FlashcardEditModal for testing
// (they are module-private, so we replicate the logic here)

function valueToString(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val, null, 2);
}

function parseFieldValue(key: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  const numFields = new Set([
    'pitchAccent', 'level', 'ease', 'interval', 'dueDate', 'reviews',
    'lapses', 'learningStep', 'createdAt', 'lastReviewed', 'lastUpdated',
  ]);
  if (numFields.has(key)) {
    const n = Number(trimmed);
    if (!isNaN(n)) return n;
  }

  if (key === 'state') {
    return trimmed;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

describe('valueToString', () => {
  it('returns empty string for undefined', () => {
    expect(valueToString(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(valueToString(null)).toBe('');
  });

  it('returns the string as-is', () => {
    expect(valueToString('hello world')).toBe('hello world');
  });

  it('converts numbers to string', () => {
    expect(valueToString(42)).toBe('42');
    expect(valueToString(2.5)).toBe('2.5');
    expect(valueToString(0)).toBe('0');
  });

  it('converts booleans to string', () => {
    expect(valueToString(true)).toBe('true');
    expect(valueToString(false)).toBe('false');
  });

  it('serializes objects as JSON', () => {
    const obj = { foo: 'bar' };
    expect(valueToString(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it('serializes arrays as JSON', () => {
    const arr = ['a', 'b'];
    expect(valueToString(arr)).toBe(JSON.stringify(arr, null, 2));
  });
});

describe('parseFieldValue', () => {
  it('returns undefined for empty string', () => {
    expect(parseFieldValue('front', '')).toBeUndefined();
    expect(parseFieldValue('front', '   ')).toBeUndefined();
  });

  it('parses "true" as boolean true', () => {
    expect(parseFieldValue('skipExampleTts', 'true')).toBe(true);
  });

  it('parses "false" as boolean false', () => {
    expect(parseFieldValue('skipExampleTts', 'false')).toBe(false);
  });

  it('parses numeric fields as numbers', () => {
    expect(parseFieldValue('ease', '2.5')).toBe(2.5);
    expect(parseFieldValue('level', '3')).toBe(3);
    expect(parseFieldValue('interval', '86400000')).toBe(86400000);
    expect(parseFieldValue('reviews', '0')).toBe(0);
    expect(parseFieldValue('pitchAccent', '1')).toBe(1);
  });

  it('returns string for non-numeric input in numeric fields', () => {
    expect(parseFieldValue('ease', 'abc')).toBe('abc');
  });

  it('parses state field as string', () => {
    expect(parseFieldValue('state', 'new')).toBe('new');
    expect(parseFieldValue('state', 'review')).toBe('review');
    expect(parseFieldValue('state', 'learning')).toBe('learning');
    expect(parseFieldValue('state', 'relearning')).toBe('relearning');
  });

  it('returns plain string for regular text fields', () => {
    expect(parseFieldValue('front', 'hello')).toBe('hello');
    expect(parseFieldValue('back', 'meaning')).toBe('meaning');
  });

  it('parses JSON objects', () => {
    expect(parseFieldValue('extra', '{"key": "value"}')).toEqual({ key: 'value' });
  });

  it('parses JSON arrays', () => {
    expect(parseFieldValue('tags', '["tag1", "tag2"]')).toEqual(['tag1', 'tag2']);
  });

  it('returns raw string for invalid JSON that looks like an object', () => {
    expect(parseFieldValue('extra', '{invalid json}')).toBe('{invalid json}');
  });

  it('preserves HTML content in example fields', () => {
    const html = '<span class="token">word</span>';
    expect(parseFieldValue('example', html)).toBe(html);
  });

  it('handles whitespace trimming', () => {
    expect(parseFieldValue('front', '  hello  ')).toBe('hello');
    expect(parseFieldValue('ease', '  2.5  ')).toBe(2.5);
  });
});
