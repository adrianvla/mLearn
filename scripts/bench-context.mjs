#!/usr/bin/env node
/**
 * Context-budget benchmark runner — thin wrapper (no execa) around:
 *   npx vitest run src/shared/__bench__ --project node
 * Output is tee'd: passed through to stdout/stderr and, when a destination
 * path is given as the first argument, appended to that file.
 *
 * Usage: node scripts/bench-context.mjs [tee-file]
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const teePath = process.argv[2];
const tee = teePath ? createWriteStream(resolve(process.cwd(), teePath), { flags: 'a' }) : null;

const child = spawn('npx', ['vitest', 'run', 'src/shared/__bench__', '--project', 'node'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  tee?.write(chunk);
});
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  tee?.write(chunk);
});
child.on('error', (err) => {
  process.stderr.write(`bench-context: failed to spawn vitest: ${err.message}\n`);
  tee?.end();
  process.exit(1);
});
child.on('close', (code) => {
  if (tee) {
    tee.end(() => process.exit(code ?? 1));
  } else {
    process.exit(code ?? 1);
  }
});
