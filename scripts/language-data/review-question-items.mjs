#!/usr/bin/env node
/** Local-only export/import. The human/operator owns reviewer provenance; no provider is called here. */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const mode = args.shift();
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--language', '--metadata', '--payload', '--review', '--output'].includes(args[index]) || !args[index + 1]) throw new Error('Unknown or incomplete argument');
  if (options[args[index]]) throw new Error('Duplicate argument');
  options[args[index]] = args[index + 1];
}
if (!['export', 'import'].includes(mode) || !options['--language'] || !options['--metadata'] || !options['--output']
  || (mode === 'import' && (!options['--payload'] || !options['--review']))) {
  throw new Error('Usage: review-question-items.mjs export|import --language CODE --metadata FILE --output NEW_FILE [--payload FROZEN_FILE --review ACTUAL_REVIEW_FILE]');
}
if (existsSync(options['--output'])) throw new Error('Output exists; choose a new output to retain the previous review/source');
const temporary = mkdtempSync(path.join(tmpdir(), 'mlearn-question-review-'));
try {
  const entry = fileURLToPath(new URL('../../src/renderer/learning/questionReview.ts', import.meta.url));
  const outfile = path.join(temporary, 'review.cjs');
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  const { exportQuestionReview, importQuestionReview } = createRequire(import.meta.url)(outfile);
  const data = JSON.parse(readFileSync(options['--metadata'], 'utf8'));
  const output = mode === 'export' ? exportQuestionReview(options['--language'], data)
    : importQuestionReview(options['--language'], data, JSON.parse(readFileSync(options['--payload'], 'utf8')), JSON.parse(readFileSync(options['--review'], 'utf8')));
  writeFileSync(options['--output'], JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  console.log(`${mode}: ${options['--output']}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
