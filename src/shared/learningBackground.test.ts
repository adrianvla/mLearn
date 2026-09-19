import { describe, expect, it } from 'vitest';
import {
  parseHistoricalBackgroundRecord,
  parseHistoricalBackgroundRecords,
} from './learningBackground';

describe('parseHistoricalBackgroundRecord', () => {
  it('parses a complete dated exam record with its own scale name', () => {
    const record = parseHistoricalBackgroundRecord({
      id: 'bg-1',
      language: 'de',
      kind: 'exam',
      label: 'Goethe-Zertifikat B2',
      level: 'B2',
      completedAt: '2025-06-30',
      skillScope: ['reading', 'listening'],
      note: 'school course final',
      recordedAt: 1_750_000_000_000,
    });

    expect(record).toMatchObject({
      id: 'bg-1',
      language: 'de',
      kind: 'exam',
      label: 'Goethe-Zertifikat B2',
      level: 'B2',
      completedAt: '2025-06-30',
      skillScope: ['reading', 'listening'],
      recordedAt: 1_750_000_000_000,
    });
  });

  it('preserves unknown extra fields instead of dropping learner-owned data', () => {
    const record = parseHistoricalBackgroundRecord({
      id: 'bg-2',
      language: 'ja',
      kind: 'self-assessment',
      label: 'self',
      recordedAt: 1,
      'x-custom-score': { total: 90 },
    });

    expect(record).not.toBeNull();
    expect((record as Record<string, unknown>)['x-custom-score']).toEqual({ total: 90 });
  });

  it('accepts the minimal contract without optional fields', () => {
    const record = parseHistoricalBackgroundRecord({ id: 'bg-3', language: 'ru', kind: 'school', label: 'Year 9', recordedAt: 5 });
    expect(record).toMatchObject({ id: 'bg-3', kind: 'school', label: 'Year 9' });
    expect(record?.level).toBeUndefined();
  });

  it('rejects malformed rows on every core contract violation', () => {
    const valid = { id: 'bg-4', language: 'de', kind: 'exam', label: 'B1', recordedAt: 1 };
    expect(parseHistoricalBackgroundRecord(null)).toBeNull();
    expect(parseHistoricalBackgroundRecord('exam')).toBeNull();
    expect(parseHistoricalBackgroundRecord([])).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, id: '' })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, language: 7 })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, kind: 'diploma-mill' })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, label: '' })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, recordedAt: 'yesterday' })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, level: 42 })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, skillScope: ['reading', 3] })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, completedAt: null })).toBeNull();
  });

  it('round-trips supplied scores verbatim, including package/learner-owned score fields (R09/G03)', () => {
    const record = parseHistoricalBackgroundRecord({
      id: 'bg-5',
      language: 'de',
      kind: 'exam',
      label: 'Goethe-Zertifikat B2',
      recordedAt: 1,
      score: {
        overall: '72/100',
        skills: { reading: '24/30', listening: '21/25' },
        'x-percentile': '92nd',
      },
    });
    expect(record?.score).toEqual({
      overall: '72/100',
      skills: { reading: '24/30', listening: '21/25' },
      'x-percentile': '92nd',
    });
  });

  it('accepts overall-only and skills-only scores and rejects malformed score shapes', () => {
    const valid = { id: 'bg-6', language: 'de', kind: 'exam', label: 'B1', recordedAt: 1 };
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { overall: '4.0' } })?.score).toEqual({ overall: '4.0' });
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { skills: { speaking: 'gut' } } })?.score).toEqual({ skills: { speaking: 'gut' } });
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { overall: '80', skills: {} } })?.score).toEqual({ overall: '80', skills: {} });
    // Malformed: no content, wrong types, empty entries, non-string values.
    expect(parseHistoricalBackgroundRecord({ ...valid, score: {} })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, score: '80/100' })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { overall: 87 } })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { overall: '' } })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { skills: [] } })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { skills: { reading: '' } } })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { skills: { '': '80' } } })).toBeNull();
    expect(parseHistoricalBackgroundRecord({ ...valid, score: { overall: '80', skills: { reading: 3 } } })).toBeNull();
  });
});

describe('parseHistoricalBackgroundRecords', () => {
  it('keeps valid rows and drops malformed ones without failing the whole list', () => {
    const records = parseHistoricalBackgroundRecords([
      { id: 'a', language: 'de', kind: 'exam', label: 'B2', recordedAt: 1 },
      'garbage',
      { id: '', language: 'de', kind: 'exam', label: 'B2', recordedAt: 1 },
      { id: 'b', language: 'ja', kind: 'school', label: '高2', level: 'N3', recordedAt: 2 },
    ]);

    expect(records.map((record) => record.id)).toEqual(['a', 'b']);
  });

  it('returns an empty list for non-array input', () => {
    expect(parseHistoricalBackgroundRecords(undefined)).toEqual([]);
    expect(parseHistoricalBackgroundRecords({ records: [] })).toEqual([]);
  });
});
