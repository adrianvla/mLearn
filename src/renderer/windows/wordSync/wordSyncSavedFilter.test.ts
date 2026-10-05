import { hashWordSync } from '../../../shared/utils/wordHash';
import { describe, expect, it } from 'vitest';
import { wordSyncSavedFilter, wordSyncSavedTasks, wordSyncSavedTaskById, wordSyncSavedTaskInventory } from './wordSyncSavedFilter';

const scope = { language: 'synthetic-package', provider: 'package-frequency', packageVersion: 'release-1' };
const tokens = [
  { kind: 'operand', field: 'third-party:unknown-category', op: 'eq', value: '{"scope":["speaker","listener"],"opaque":true}', extension: { arbitrary: ['new-value'] } },
  { kind: 'operator', op: 'AND' },
  { kind: 'not' },
  { kind: 'paren', dir: 'open' },
  { kind: 'operand', field: 'other:feature', op: 'in', value: '["unfamiliar"]' },
  { kind: 'paren', dir: 'close' },
];
const record = () => ({
  id: 'saved-session', identity: JSON.stringify({ ...scope, tokens }),
  queue: [{ id: 'surface-1' }, { id: 'surface-2' }], index: 1, visited: [0], rated: 1,
  revealed: false, meta: { samplingLevel: 1, lastRating: 'struggled' },
});

describe('wordSyncSavedFilter', () => {
  it('discovers current and suspended tasks with different expressions without mutating either', () => {
    const current = record();
    const saved = { ...record(), id: 'saved-other-expression', identity: JSON.stringify({ ...scope, tokens: [] }) };
    const store = new Map([['task', JSON.stringify(current)], ['task:sessions', JSON.stringify([saved.id, current.id, 'absent'])],
      [`task:session:${saved.id}`, JSON.stringify(saved)], [`task:session:${current.id}`, JSON.stringify(current)]]);
    const before = [...store];
    const tasks = wordSyncSavedTasks({ getItem: key => store.get(key) ?? null }, 'task', scope);
    expect(tasks.map(task => task.id)).toEqual([current.id, saved.id]);
    expect(tasks[0].tokens.map(({ instanceId: _id, ...token }) => token)).toEqual(tokens);
    expect(tasks[1].tokens).toEqual([]);
    expect([...store]).toEqual(before);
    expect(wordSyncSavedTasks({ getItem: key => store.get(key) ?? null }, 'task', { ...scope, language: 'other' })).toEqual([]);
  });
  it('preserves unknown package fields, structured value strings and extensions with fresh UI identities', () => {
    const restored = wordSyncSavedFilter(JSON.stringify(record()), scope)!;
    expect(restored.map(({ instanceId: _id, ...token }) => token)).toEqual(tokens);
    expect(new Set(restored.map(token => token.instanceId)).size).toBe(tokens.length);
    const second = wordSyncSavedFilter(JSON.stringify(record()), scope)!;
    expect(restored.map(token => token.instanceId)).not.toEqual(second.map(token => token.instanceId));
  });

  it.each(['language', 'provider', 'packageVersion'] as const)('rejects another %s scope', key => {
    expect(wordSyncSavedFilter(JSON.stringify(record()), { ...scope, [key]: 'other' })).toBeNull();
  });

  it('accepts an empty expression and an absent provider or package version', () => {
    const saved = record();
    saved.identity = JSON.stringify({ language: scope.language, tokens: [] });
    expect(wordSyncSavedFilter(JSON.stringify(saved), { language: scope.language })).toEqual([]);
  });

  it.each([
    null, '', '{', 'null', '[]',
    JSON.stringify({ ...record(), queue: [null] }),
    JSON.stringify({ ...record(), index: -1 }),
    JSON.stringify({ ...record(), visited: [2] }),
    JSON.stringify({ ...record(), rated: -1 }),
    JSON.stringify({ ...record(), meta: { assessment: {} } }),
    JSON.stringify({ ...record(), identity: '{' }),
    ...[null, [{ kind: 'operand', field: 'x', op: 'unsupported', value: 'x' }],
      [{ kind: 'operand', field: 'x', op: ['eq'], value: 'x' }],
      [{ kind: 'operand', field: 'x', op: 'eq', value: { arbitrary: true } }],
      [{ kind: 'operator', op: 'AND' }], [{ kind: 'paren', dir: 'other' }], [null],
    ].map(invalidTokens => JSON.stringify({ ...record(), identity: JSON.stringify({ ...scope, tokens: invalidTokens }) })),
  ])('rejects malformed or assessment records without throwing (%#)', raw => {
    expect(wordSyncSavedFilter(raw, scope)).toBeNull();
  });
});


describe('named word task discovery', () => {
  const key = `mlearn-study-word-sync:${scope.language}`;
  const storage = (items: Array<[string, string]>) => {
    const map = new Map(items);
    return { get length() { return map.size; }, key: (index: number) => [...map.keys()][index] ?? null, getItem: (key: string) => map.get(key) ?? null };
  };
  it('discovers compatible material and ordinary tasks without exposing cues or mutating storage', () => {
    const source = { words: ['surface-1', 'surface-2'], label: 'Original chapter' };
    const materialKey = `mlearn-study-word-sync-material-${hashWordSync(source.words.join('\u0000'))}:${scope.language}`;
    const material = { ...record(), id: 'material-task', meta: { ...record().meta, source } };
    const raw = JSON.stringify(material);
    const store = storage([[key, JSON.stringify(record())], [materialKey, raw],
      [`${materialKey}:sessions`, JSON.stringify(['material-task', 'missing'])], [`${materialKey}:session:material-task`, raw],
      [`mlearn-study-word-sync:other`, JSON.stringify({ ...record(), identity: JSON.stringify({ ...scope, language: 'other', tokens }) })]]);
    const before = Array.from({ length: store.length }, (_, index) => [store.key(index), store.getItem(store.key(index)!)]);
    const tasks = wordSyncSavedTaskInventory(store, scope);
    expect(tasks.map(task => ({ id: task.id, key: task.key, source: task.source }))).toEqual([
      { id: 'saved-session', key, source: undefined }, { id: 'material-task', key: materialKey, source },
    ]);
    expect(Array.from({ length: store.length }, (_, index) => [store.key(index), store.getItem(store.key(index)!)])).toEqual(before);
  });
  it('reads the exact archived identity without changing storage or admitting another task', () => {
    const raw = JSON.stringify(record());
    const store = storage([[key, JSON.stringify({ ...record(), id: 'other' })], [`${key}:session:saved-session`, raw]]);
    expect(wordSyncSavedTaskById(store, 'saved-session', scope)).toEqual({ key, source: undefined });
    expect(store.getItem(`${key}:session:saved-session`)).toBe(raw);
    expect(wordSyncSavedTaskById(store, 'missing', scope)).toBeUndefined();
  });
  it('preserves malformed active data while still discovering a valid archive and another namespace', () => {
    const source = { words: ['surface-1', 'surface-2'], label: 'Saved chapter' };
    const materialKey = `mlearn-study-word-sync-material-${hashWordSync(source.words.join('\u0000'))}:${scope.language}`;
    const material = { ...record(), id: 'material-task', meta: { ...record().meta, source } };
    const store = storage([[materialKey, '{broken'], [`${materialKey}:sessions`, JSON.stringify([material.id])],
      [`${materialKey}:session:${material.id}`, JSON.stringify(material)], [key, JSON.stringify(record())]]);
    expect(wordSyncSavedTaskInventory(store, scope).map(task => task.id)).toEqual(['material-task', 'saved-session']);
    expect(wordSyncSavedTaskById(store, 'saved-session', scope)).toEqual({ key, source: undefined });
    expect(store.getItem(materialKey)).toBe('{broken');
  });
  it.each(['language', 'provider', 'packageVersion'] as const)('rejects a mismatched %s owner', field => {
    const store = storage([[key, JSON.stringify(record())]]);
    expect(wordSyncSavedTaskById(store, 'saved-session', { ...scope, [field]: 'other' })).toBeUndefined();
  });
  it('locates multiword material using the same NUL separator as the task owner', () => {
    const source = { words: ['surface-1', 'surface-2'], label: 'Selected material' };
    const materialKey = `mlearn-study-word-sync-material-${hashWordSync(source.words.join('\u0000'))}:${scope.language}`;
    const raw = JSON.stringify({ ...record(), meta: { ...record().meta, source } });
    const store = storage([[`${materialKey}:session:saved-session`, raw]]);
    expect(wordSyncSavedTaskById(store, 'saved-session', scope)).toEqual({ key: materialKey, source });
    expect(store.getItem(`${materialKey}:session:saved-session`)).toBe(raw);
  });
  it('rejects source metadata stored under an unrelated task namespace', () => {
    const store = storage([[key, JSON.stringify({ ...record(), meta: { source: { words: ['surface-1'], label: 'Selected material' } } })]]);
    expect(wordSyncSavedTaskById(store, 'saved-session', scope)).toBeUndefined();
  });
});
