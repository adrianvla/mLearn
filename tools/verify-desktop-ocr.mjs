// Explicit one-shot native QA. Its local catalog closes on success or failure;
// there is no persistent launcher, device startup, or resume hook.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { startCatalog } from './catalog-server.mjs';

const [directory, mode] = process.argv.slice(2);
if (!directory || (mode && mode !== 'generic')) {
  throw new Error('Usage: node tools/verify-desktop-ocr.mjs QA_ROOT [generic]');
}
const root = path.resolve(directory);
await mkdir(root, { recursive: true });
const server = await startCatalog(path.resolve('target/plugin-cdn'), 0);
try {
  const trust = JSON.parse(await readFile('.mlearn/dev-trust.json', 'utf8'));
  trust.url = `http://127.0.0.1:${server.address().port}/catalog.json`;
  const trustPath = path.join(root, 'trust.json');
  await writeFile(trustPath, JSON.stringify(trust));
  const executable = process.platform === 'win32' ? 'ocr_probe.exe' : 'ocr_probe';
  const child = spawn(path.resolve('target/debug/examples', executable), [
    root, path.resolve('tests/fixtures/ocr/vision'), trustPath, ...(mode ? [mode] : []),
  ], { stdio: 'inherit', signal: AbortSignal.timeout(10 * 60 * 1000) });
  const [code, signal] = await once(child, 'close');
  if (code !== 0) throw new Error(`Native OCR probe failed: ${code ?? signal}`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
