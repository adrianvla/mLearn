import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectGrammarOccurrences } from './occurrences';
import { grammarEvidenceKey, grammarRecognitionEvidence } from './evidence';
import type { GrammarPoint, Token } from '../types';

/**
 * §13 live grammar-recognition proof, full real runtime chain:
 *
 *   real sentence
 *     → GenericLanguageModule('ja').LANGUAGE_TOKENIZE  (Sudachi, live process)
 *     → real installed package grammar list (~/Library/Application Support/
 *       mlearn/language-data/languages/ja.json — 230 patterns)
 *     → detectGrammarOccurrences
 *     → persistent GrammarPattern identities (targetRef.id) with spans
 *     → the capability-scoped evidence target a review would write
 *
 * Skips when the Python env or the installed package is absent (CI).
 */

const REPO = path.resolve(__dirname, '../../..');
const PYTHON = path.join(REPO, 'dist-electron/env/bin/python');
const PACKAGE = path.join(
  os.homedir(),
  'Library/Application Support/mlearn/language-data/languages/ja.json',
);
const SENTENCE = '食べてしまったら、連絡してください。';

function prerequisites(): boolean {
  return fs.existsSync(PYTHON) && fs.existsSync(PACKAGE);
}

/** Live Sudachi tokenization through the production Python module. */
function realTokens(): Token[] {
  const script = [
    'import sys, json, os',
    "sys.path.insert(0, 'src/root-of-app')",
    'from generic_language import GenericLanguageModule',
    "mod = GenericLanguageModule('ja')",
    "mod.LOAD_MODULE('src/root-of-app', os.path.expanduser('~/Library/Application Support/mlearn/language-data'))",
    `print(json.dumps(mod.LANGUAGE_TOKENIZE(${JSON.stringify(SENTENCE)}), ensure_ascii=False))`,
  ].join('\n');
  const stdout = execFileSync(PYTHON, ['-c', script], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return JSON.parse(stdout) as Token[];
}

describe('grammar recognition: live tokenizer + installed package', () => {
  it.skipIf(!prerequisites())('real sentence → real tokens → persistent pattern identities with spans', () => {
    const tokens = realTokens();
    // The live tokenizer resolved real lemmas (proof the chain is real).
    expect(tokens.some((t) => t.actual_word === '食べる')).toBe(true);
    expect(tokens.some((t) => t.actual_word === 'しまう')).toBe(true);

    // The real installed package IS the runtime LanguageData (grammar list +
    // tokenization config — the same object the subtitle pipeline receives).
    const languageData = JSON.parse(fs.readFileSync(PACKAGE, 'utf8')) as import('../types').LanguageData;
    const grammar = languageData.grammar ?? [];
    expect(grammar.length).toBeGreaterThan(100);

    const occurrences = detectGrammarOccurrences({
      language: 'ja',
      grammar,
      tokens,
      languageData,
    });
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      // Persistent identity: the graph's grammar-pattern entity id.
      expect(occurrence.targetRef.kind).toBe('grammar-pattern');
      expect(occurrence.targetRef.id).toMatch(/^ja:grammar:/);
      expect(occurrence.targetRef.capability).toBe('grammar-recognition');
      expect(occurrence.sentenceSpan.start).toBeLessThan(occurrence.sentenceSpan.end);
      // The installed package ships no match rules yet → literal detector.
      expect(occurrence.provenance).toBe('literal');
      expect(occurrence.confidence).toBe(0.65);
      // Realized form is the exact token surfaces in the span.
      const surfaces = tokens
        .slice(occurrence.sentenceSpan.start, occurrence.sentenceSpan.end)
        .map((t) => t.surface ?? t.word)
        .join('');
      expect(occurrence.realizedForm).toBe(surfaces);
    }
    // Deduped per patternId:span:provenance.
    const keys = occurrences.map((o) => `${o.patternId}:${o.sentenceSpan.start}:${o.sentenceSpan.end}:${o.provenance}`);
    expect(new Set(keys).size).toBe(keys.length);
    // てください is present literally in the tokenized text (tokens 7-8:
    // て + ください) and ships in the installed package → must be detected.
    const request = occurrences.find((o) => o.patternId === 'てください');
    expect(request).toBeDefined();
    expect(request!.realizedForm).toBe('てください');
    expect(request!.sentenceSpan).toEqual({ start: 7, end: 9 });
    // たら (token 3) likewise.
    const tara = occurrences.find((o) => o.patternId === 'たら');
    expect(tara).toBeDefined();
    expect(tara!.realizedForm).toBe('たら');

    // Detection is analysis only — it writes nothing. The capability-scoped
    // evidence target a review WOULD write resolves to the same persistent
    // identity the occurrence points at (key asserted as computed — its
    // format embeds the entity id and the capability scope).
    const evidenceKey = grammarEvidenceKey('ja', 'てください', 'grammar-recognition');
    const event = grammarRecognitionEvidence('ja', 'てください', { t: 1234, kind: 'rating', quality: 'fluent' });
    expect(evidenceKey).toContain('てください');
    expect(evidenceKey.endsWith(':grammar-recognition')).toBe(true);
    expect(event.targetRef?.id).toBe(request!.targetRef.id);
    expect(event.source).toBe('grammar');
  });
});
