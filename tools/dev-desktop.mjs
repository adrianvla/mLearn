import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prep = spawn(process.execPath, ['tools/prepare-plugins.mjs'], { cwd: root, stdio: 'inherit' });
await new Promise((resolve, reject) => { prep.once('error', reject); prep.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Plugin preparation failed'))); });
const documents = spawn(process.execPath, ['tools/prepare-documents.mjs'], { cwd: root, stdio: 'inherit' });
await new Promise((resolve, reject) => { documents.once('error', reject); documents.once('exit', code => code === 0 ? resolve() : reject(new Error('Document parser preparation failed'))); });
const directory = path.join(root, 'target/plugin-cdn');
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const relative = pathname.replace(/^\/+/, '');
    if (relative.split('/').some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '..' || part === '.')) throw new Error('Invalid path');
    const data = await readFile(path.join(directory, relative));
    response.writeHead(200, { 'Content-Type': relative.endsWith('.json') ? 'application/json' : 'application/wasm', 'Content-Length': data.length });
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(7780, '127.0.0.1', resolve); });
console.log('Local development plugin catalog: http://127.0.0.1:7780/catalog.json');
// Tauri accepts CI=true, but Metro disables file watching in CI. A local
// development launch must consume edits rather than repeatedly serve an old graph.
const expoEnv = { ...process.env, BROWSER: 'none' };
delete expoEnv.CI;
const expo = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'web', '-w', '@mlearn/client', '--', '--port', '8081'], { cwd: root, stdio: 'inherit', env: expoEnv });
let stopping = false;
function stop() { if (stopping) return; stopping = true; expo.kill('SIGTERM'); server.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
expo.once('error', (error) => { console.error(error); stop(); process.exitCode = 1; });
expo.once('exit', (code) => { stop(); process.exitCode = code ?? 0; });
