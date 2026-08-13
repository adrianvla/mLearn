// Throwaway reproduction of the Level Study BulkAddModal count logic for
// the "Add 3960 flashcards" bug report - NOT a real test, delete after use.
import { describe, expect, it } from 'vitest';
import { validateTokens, parseTokens, evaluateAst, buildLevelStudyBulkAddFields, buildUntrackedStatusPreset, LEVEL_VALUE_NO_LEVEL } from '../src/renderer/components/common';
import { LEVEL_VALUE_BEYOND_EXAM } from '../src/shared/constants';

// Minimal t() that returns the label (resolvers don't need translations).
const t = (key: string) => key;

function makeFields() {
  return buildLevelStudyBulkAddFields({ '1': 'L1', '2': 'L2', '3': 'L3', '4': 'L4', '5': 'L5' }, t, {
    // minimal LanguageData - levels 1..5
    levels: { '1': { name: 'L1' }, '2': { name: 'L2' }, '3': { name: 'L3' }, '4': { name: 'L4' }, '5': { name: 'L5' } },
  } as never);
}

// Synthetic freq map: 3960 words, all untracked, levels 1-5 (displayable).
const freq: Record<string, { raw_level: unknown }> = {};
for (let i = 0; i < 3960; i++) freq[`w${i}`] = { raw_level: (i % 5) + 1 };

// Synthetic dict universe: 172k words with NO level.
const dict: [string, string][] = [];
for (let i = 0; i < 172000; i++) dict.push([`d${i}`, `reading${i}`]);

// The modal's own memo logic, verbatim from BulkAddModal.tsx L93-130.
function countFor(tokens: Parameters<typeof validateTokens>[0], searchQuery = '', freqs = freq, dictWords: [string, string][] | undefined = dict) {
  const filterSetup = makeFields();
  const resolvers = Object.fromEntries(filterSetup.fields.map((f) => [f.field, f.resolver]));
  const ast = tokens.length === 0 ? null : (validateTokens(tokens).ok ? parseTokens(tokens) : null);
  if (tokens.length > 0 && !ast) return { count: 0, reason: 'guard: invalid tokens -> []' };

  const query = searchQuery.trim().toLowerCase();
  const matchesSearch = (word: string, reading?: string) => query.length === 0 || word.toLowerCase().includes(query) || (reading?.toLowerCase().includes(query) ?? false);

  const words: string[] = [];
  const inFrequency = new Set<string>();
  for (const [word, entry] of Object.entries(freqs)) {
    inFrequency.add(word);
    if (!matchesSearch(word)) continue;
    if (!ast) { words.push(word); continue; }
    const record = { status: 'untracked', level: entry.raw_level };
    if (evaluateAst(ast, record, resolvers)) words.push(word);
  }
  for (const [word, reading] of dictWords ?? []) {
    if (inFrequency.has(word)) continue;
    if (!matchesSearch(word, reading)) continue;
    if (!ast) { words.push(word); continue; }
    const record = { status: 'untracked', level: LEVEL_VALUE_NO_LEVEL };
    if (evaluateAst(ast, record, resolvers)) words.push(word);
  }
  return { count: words.length, ast, valid: validateTokens(tokens) };
}

function operand(field: string, op: string, value: string) {
  return { instanceId: `id-${field}-${value}`, kind: 'operand' as const, field, op, value };
}
const UNTRACKED = buildUntrackedStatusPreset();

describe('repro', () => {
  it('prints counts for all user scenarios', () => {
    const defaultT = UNTRACKED;
    const noLevel = [...UNTRACKED, operand('level', 'eq', LEVEL_VALUE_NO_LEVEL)];
    const beyond = [operand('level', 'eq', LEVEL_VALUE_BEYOND_EXAM)];
    const empty: typeof UNTRACKED = [];

    for (const [name, toks] of [['default', defaultT], ['+NoLevel', noLevel], ['+Beyond', beyond], ['empty', empty]] as const) {
      const r = countFor(toks);
      console.log(`\n=== ${name} ===`);
      console.log('valid:', r.valid);
      console.log('ast:', r.ast ? 'non-null' : 'null');
      console.log('count:', r.count);
    }

    // With empty dict (route failure) the numbers shift - print those too.
    console.log('\n--- with dict=[] (resource failure) ---');
    for (const [name, toks] of [['default', defaultT], ['+NoLevel', noLevel], ['+Beyond', beyond], ['empty', empty]] as const) {
      const r = countFor(toks, '', freq, []);
      console.log(`${name}: valid=${r.valid.ok} ast=${r.ast ? 'y' : 'n'} count=${r.count}${!r.valid.ok ? ' reason=' + JSON.stringify(r.valid) : ''}`);
    }
    expect(true).toBe(true);
  });
});