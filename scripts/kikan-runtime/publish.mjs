#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sign } from 'node:crypto';
import { transformSync } from 'esbuild';

const [input, keyPath, outputDir] = process.argv.slice(2);
if (!input || !keyPath || !outputDir) {
  process.stderr.write('Usage: node scripts/kikan-runtime/publish.mjs DOCUMENT.json PRIVATE_KEY.pem OUTPUT_DIR\n');
  process.exit(2);
}

const source = fs.readFileSync(new URL('../../src/electron/kikanRuntime/protocol.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
const { canonicalJson, validateRuntimeDocument, PROTOCOL } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const document = validateRuntimeDocument(JSON.parse(fs.readFileSync(input, 'utf8')));
fs.mkdirSync(outputDir, { recursive: true });
const configPath = path.join(outputDir, 'configuration.json');
if (fs.existsSync(configPath)) {
  const previous = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (document.sequence <= previous.document.sequence) throw new Error('Publishing requires a strictly higher sequence');
}
const privateKey = fs.readFileSync(keyPath);
const envelope = { document, signature: sign(null, Buffer.from(canonicalJson(document)), privateKey).toString('base64') };
const discovery = { protocol: PROTOCOL, capabilities: [
  { rel: 'urn:kikan:runtime:configuration', href: './configuration.json' },
  { rel: 'urn:kikan:runtime:telemetry', href: './telemetry' },
] };
const atomic = (file, value) => {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
};
atomic(path.join(outputDir, 'discovery.json'), discovery);
atomic(configPath, envelope);
process.stdout.write(`Published signed KikanRuntime sequence ${document.sequence} to ${outputDir}\n`);
