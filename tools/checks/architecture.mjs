import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { checkSource } from './policy.mjs';

const failures = [];
async function scan(directory) {
  if (!existsSync(directory)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'generated', '.expo', 'assets', 'tests'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (/\.[jt]sx?$/.test(file) && !/\.(?:test|spec)\./.test(file)) failures.push(...checkSource(file, await readFile(file, 'utf8')));
  }
}
await scan('apps/client/src');
await scan('packages');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Architecture boundaries passed.');
