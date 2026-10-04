import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../../../shared/types';
import { homeGrammarResume } from './homeGrammarResume';
const data: LanguageData = { name: 'Future', grammar: [{ pattern: 'alien:construction', level: 9, meaning: 'Unknown language-owned meaning' }] };
const denominator = 'alien:construction';
const record = { id: 'session', identity: JSON.stringify({ language: 'future', level: 9, kind: 'self-assess', denominator }),
  queue: [{ id: denominator }], index: 0, visited: [], rated: 0, revealed: true,
  meta: { level: 9, kind: 'self-assess', denominator, presentedAt: 50, priorCueExposure: { index: 0, itemId: denominator } } };
const read = (value: unknown, language = 'future', loaded = data) => homeGrammarResume({ getItem: () => JSON.stringify(value) }, language, loaded);
describe('Home grammar continuity', () => {
  it('preserves the original package-resolved scope and never interprets or rewrites its exposure', () => {
    const before = structuredClone(record);
    expect(read(record)).toEqual({ label: denominator, at: 50, context: { activity: 'grammar', patterns: [denominator] } });
    expect(record).toEqual(before);
    expect(read({ ...record, meta: { ...record.meta, presentedAt: undefined } })?.at).toBe(0);
  });
  it('does not resume completion, another language, changed membership or malformed storage', () => {
    expect(read({ ...record, index: 1 })).toBeNull();
    expect(read(record, 'other')).toBeNull();
    expect(read(record, 'future', { name: 'Future', grammar: [] })).toBeNull();
    expect(read({ ...record, queue: [{ id: 'not-declared' }] })).toBeNull();
    expect(read({ ...record, meta: { ...record.meta, denominator: 'changed' } })).toBeNull();
    expect(read({ ...record, pending: { index: 0, itemId: 'other', attemptId: 'pending' } })).toBeNull();
    expect(homeGrammarResume({ getItem: () => '{' }, 'future', data)).toBeNull();
  });
});
