import { describe, expect, it } from 'vitest';
import { wordSyncSavedFilter } from './wordSyncSavedFilter';

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
