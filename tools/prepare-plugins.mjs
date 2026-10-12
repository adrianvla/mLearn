import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('cargo', ['build', '-p', 'mlearn-example-hello', '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) throw result.error ?? new Error('Plugin build failed');
const destination = path.join(root, 'target/plugin-cdn');
await mkdir(path.join(destination, 'modules'), { recursive: true });
await mkdir(path.join(destination, 'data'), { recursive: true });
const code = await readFile(path.join(root, 'target/wasm32-unknown-unknown/release/mlearn_example_hello.wasm'));
const data = await readFile(path.join(root, 'language-plugins/hello/assets/greeting.json'));
async function artifact(bytes, directory, extension) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const relative = `${directory}/${sha256}.${extension}`;
  await writeFile(path.join(destination, relative), bytes);
  return { path: relative, sha256, byteLength: bytes.length };
}
const base = JSON.parse(await readFile(path.join(root, 'language-plugins/hello/plugin.json'), 'utf8'));
const { fixture: _fixture, ...identity } = base;
const manifest = { ...identity, code: await artifact(code, 'modules', 'wasm'), assets: { 'greeting.json': await artifact(data, 'data', 'json') } };
const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 172800, plugins: [manifest] }));
const privatePath = path.join(root, '.mlearn/dev-publisher.pem');
await mkdir(path.dirname(privatePath), { recursive: true });
if (!existsSync(privatePath)) {
  const { privateKey } = generateKeyPairSync('ed25519');
  await writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const privateKey = createPrivateKey(await readFile(privatePath));
const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const publicKey = spki.subarray(spki.length - 32).toString('base64');
await writeFile(path.join(destination, 'catalog.json'), JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') }));
await writeFile(path.join(destination, 'bundle.json'), JSON.stringify([manifest]));
await writeFile(path.join(root, '.mlearn/dev-trust.json'), JSON.stringify({ url: 'http://127.0.0.1:7780/catalog.json', publicKey }));
console.log('Built the SDK fixture. Desktop serves/downloads it; only mobile build tooling embeds it.');
