// Explicit offline processing of native ORT traces, not an application logger.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node tools/summarize-ocr-profile.mjs PROFILE_JSON...');
for (const file of process.argv.slice(2)) {
  if ((await stat(file)).size > 64 * 1024 * 1024) throw new Error('Verification trace exceeds 64 MiB');
  const events = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(events)) throw new Error('Invalid ORT trace');
  const providers = {};
  for (const event of events) {
    if (event.cat !== 'Node' || typeof event.args?.provider !== 'string') continue;
    const provider = providers[event.args.provider] ??= { calls: 0, microseconds: 0, nodes: new Set() };
    if (!Number.isFinite(event.dur) || event.dur < 0) throw new Error('Invalid native node duration');
    provider.calls++; provider.microseconds += event.dur; provider.nodes.add(event.name);
  }
  console.log(JSON.stringify({ file: path.basename(file), providers: Object.fromEntries(
    Object.entries(providers).map(([name, value]) => [name, {
      calls: value.calls, distinctNodes: value.nodes.size, milliseconds: value.microseconds / 1000,
    }]),
  ) }));
}
