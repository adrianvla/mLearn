import { describe, it, expect } from 'vitest';
import {
  extractPitchPosition,
  extractReadingValue,
  extractFirstDefinition,
} from './translationCacheParsers';
import type { TranslationResponse } from '../../shared/types';

describe('extractPitchPosition', () => {
  it('returns null for null/undefined', () => {
    expect(extractPitchPosition(null)).toBeNull();
    expect(extractPitchPosition(undefined)).toBeNull();
  });

  it('extracts pitch position from nested pitch data', () => {
    expect(extractPitchPosition({ pitches: [{ position: 2 }] })).toBe(2);
  });

  it('extracts pitch position from array data', () => {
    expect(extractPitchPosition([{ pitches: [{ position: 0 }] }])).toBe(0);
  });
});

describe('extractReadingValue', () => {
  it('returns null for null/undefined', () => {
    expect(extractReadingValue(null)).toBeNull();
    expect(extractReadingValue(undefined)).toBeNull();
  });

  it('extracts reading from a record', () => {
    expect(extractReadingValue({ reading: 'あめ' })).toBe('あめ');
  });

  it('extracts reading from nested data', () => {
    expect(extractReadingValue([{ reading: 'あたま' }])).toBe('あたま');
  });
});

describe('extractFirstDefinition', () => {
  it('returns null for null/undefined', () => {
    expect(extractFirstDefinition(null)).toBeNull();
    expect(extractFirstDefinition(undefined)).toBeNull();
  });

  it('returns null for empty data', () => {
    expect(extractFirstDefinition({ data: [] })).toBeNull();
  });

  it('extracts first definition as a string', () => {
    const response: TranslationResponse = {
      data: [{ definitions: 'rain', reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('extracts first definition from array', () => {
    const response: TranslationResponse = {
      data: [{ definitions: ['rain', 'candy'], reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('falls back to second entry when first has no definitions', () => {
    const response: TranslationResponse = {
      data: [
        { definitions: [], reading: 'あめ' },
        { definitions: 'candy', reading: 'あめ' },
      ],
    };
    expect(extractFirstDefinition(response)).toBe('candy');
  });

  it('strips HTML tags from definitions', () => {
    const response: TranslationResponse = {
      data: [{ definitions: '<b>rain</b>', reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('ignores non-string entries in definitions array', () => {
    const response: TranslationResponse = {
      data: [{ definitions: [null, 'rain', 42] as unknown as string[], reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });

  it('trims whitespace from definitions', () => {
    const response: TranslationResponse = {
      data: [{ definitions: '  rain  ', reading: 'あめ' }],
    };
    expect(extractFirstDefinition(response)).toBe('rain');
  });
});
