// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { homePracticeResume } from './homePracticeResume';
const scope = { language: 'future', packageVersion: '1' };
const record = (at: number, source?: unknown) => ({ id: 's', identity: JSON.stringify({ ...scope, tokens: [] }),
  queue: [{ id: 'word' }], visited: [], index: 0, rated: 0, revealed: true,
  meta: { encounter: { decision: { at } }, ...(source ? { source } : {}) } });
afterEach(() => localStorage.clear());
describe('Home continuity', () => {
  it('resumes the latest intentional material without rebuilding its original scope', () => {
    localStorage.setItem('mlearn-study-word-sync-reinforce:future', JSON.stringify(record(1)));
    localStorage.setItem('mlearn-study-word-sync-material-hash:future', JSON.stringify(record(2, { words: ['word', 'other'], label: 'My book' })));
    expect(homePracticeResume(localStorage, scope)).toEqual({ at: 2, context: { activity: 'practice', material: { language: 'future', label: 'My book', words: ['word', 'other'] } } });
  });
  it('resumes scoped maintenance with its original intention and material', () => {
    localStorage.setItem('mlearn-study-word-sync-material-hash-reinforce:future', JSON.stringify(record(2, { words: ['word'], label: 'Scope' })));
    expect(homePracticeResume(localStorage, scope)?.context).toEqual({ activity: 'reinforce',
      material: { language: 'future', label: 'Scope', words: ['word'] } });
  });
  it('ignores a finished, malformed, mismatched, or assessment session', () => {
    localStorage.setItem('mlearn-study-word-sync:future', JSON.stringify({ ...record(1), index: 1 }));
    localStorage.setItem('mlearn-study-word-sync-material-hash:future', JSON.stringify(record(2)));
    localStorage.setItem('mlearn-study-word-sync-assessment:future', JSON.stringify({ ...record(3), meta: { assessment: {} } }));
    expect(homePracticeResume(localStorage, scope)).toBeNull();
  });
});
