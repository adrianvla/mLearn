/**
 * Tests for FlashcardEditModal utility functions:
 * - valueToDraftValue: serializes flashcard field values for the advanced editor
 * - parseFieldValue: parses user-edited strings back into typed values
 */

import { describe, it, expect } from 'vitest';

// Re-implement the pure functions from FlashcardEditModal for testing
// (they are module-private, so we replicate the logic here)

type DraftValue = string | boolean;

function valueToDraftValue(val: unknown): DraftValue {
  if (val === undefined || val === null) return '';
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return JSON.stringify(val, null, 2);
}

function parseFieldValue(key: string, raw: DraftValue): unknown {
  if (typeof raw === 'boolean') return raw;

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

describe('valueToDraftValue', () => {
  it('returns empty string for undefined', () => {
    expect(valueToDraftValue(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(valueToDraftValue(null)).toBe('');
  });

  it('returns the string as-is', () => {
    expect(valueToDraftValue('hello world')).toBe('hello world');
  });

  it('converts numbers to string', () => {
    expect(valueToDraftValue(42)).toBe('42');
    expect(valueToDraftValue(2.5)).toBe('2.5');
    expect(valueToDraftValue(0)).toBe('0');
  });

  it('preserves booleans for toggle-backed fields', () => {
    expect(valueToDraftValue(true)).toBe(true);
    expect(valueToDraftValue(false)).toBe(false);
  });

  it('serializes objects as JSON', () => {
    const obj = { foo: 'bar' };
    expect(valueToDraftValue(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it('serializes arrays as JSON', () => {
    const arr = ['a', 'b'];
    expect(valueToDraftValue(arr)).toBe(JSON.stringify(arr, null, 2));
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

  it('returns boolean draft values unchanged', () => {
    expect(parseFieldValue('skipExampleTts', true)).toBe(true);
    expect(parseFieldValue('buried', false)).toBe(false);
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
