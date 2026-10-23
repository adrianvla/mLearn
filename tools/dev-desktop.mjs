import { spawn } from 'node:child_process';
import { startCatalog } from './catalog-server.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prep = spawn(process.execPath, ['tools/prepare-plugins.mjs'], { cwd: root, stdio: 'inherit' });
await new Promise((resolve, reject) => { prep.once('error', reject); prep.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Plugin preparation failed'))); });
const documents = spawn(process.execPath, ['tools/prepare-documents.mjs'], { cwd: root, stdio: 'inherit' });
await new Promise((resolve, reject) => { documents.once('error', reject); documents.once('exit', code => code === 0 ? resolve() : reject(new Error('Document parser preparation failed'))); });
const directory = path.join(root, 'target/plugin-cdn');
// Native OCR archives are much larger than language modules. Use the same
// streaming fixture owner as native-resource verification, not a whole-file buffer.
const server = await startCatalog(directory);
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
