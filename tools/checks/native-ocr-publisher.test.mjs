import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../sign-desktop-ocr.mjs', import.meta.url));

test('an existing built plugin bundle can be signed without Python or Cargo', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn-built-publisher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tools'));
  await mkdir(path.join(root, 'target/plugin-cdn'), { recursive: true });
  const prepare = path.join(root, 'tools/prepare-plugins.mjs');
  await copyFile(fileURLToPath(new URL('../prepare-plugins.mjs', import.meta.url)), prepare);
  const bundle = [{ id: 'fixture.built', version: '1', code: { path: 'modules/built.wasm' } }];
  await writeFile(path.join(root, 'target/plugin-cdn/bundle.json'), JSON.stringify(bundle));
  await exec(process.execPath, [prepare, '--sign-bundle'],
    { cwd: root, timeout: 10000, env: { ...process.env, PATH: '' } });
  const envelope = JSON.parse(await readFile(path.join(root, 'target/plugin-cdn/catalog.json'), 'utf8'));
  const payload = Buffer.from(envelope.payload, 'base64');
  const key = createPublicKey(await readFile(path.join(root, '.mlearn/dev-publisher.pem')));
  assert.equal(verify(null, payload, key, Buffer.from(envelope.signature, 'base64')), true);
  assert.deepEqual(JSON.parse(payload).plugins, bundle);
  const trust = JSON.parse(await readFile(path.join(root, '.mlearn/dev-trust.json'), 'utf8'));
  assert.equal(trust.publicKey, key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'));
});

test('publishing generic OCR preserves the signed Manga profile and rejects catalog tampering', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn-native-publisher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.mlearn'));
  await mkdir(path.join(root, 'artifacts'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await writeFile(path.join(root, '.mlearn/dev-publisher.pem'),
    privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const artifact = { sha256: 'a'.repeat(64), byteLength: 7, indexSha256: 'b'.repeat(64) };
  await writeFile(path.join(root, 'artifacts/artifacts.json'),
    JSON.stringify({ runtime: artifact, models: { ...artifact, sha256: 'c'.repeat(64) } }));
  for (const name of ['runtime', 'models']) {
    await writeFile(path.join(root, `artifacts/${name}.zip`), 'fixture');
  }
  async function publish(id, executor) {
    const descriptor = path.join(root, 'profile.json');
    await writeFile(descriptor, JSON.stringify({ id, executor, label: id }));
    return exec(process.execPath, [script, path.join(root, 'artifacts'), descriptor],
      { cwd: root, timeout: 10000 });
  }
  const catalogPath = path.join(root, 'target/plugin-cdn/ocr-catalog.json');
  await publish('fixture.manga', 'paddle-manga-onnx-v1');
  await publish('fixture.ctc', 'paddle-ctc-onnx-v1');
  const envelope = JSON.parse(await readFile(catalogPath, 'utf8'));
  const payload = Buffer.from(envelope.payload, 'base64');
  assert.equal(verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64')), true);
  assert.deepEqual(JSON.parse(payload).nativeOcr.map(p => [p.id, p.executor]), [
    ['fixture.manga', 'paddle-manga-onnx-v1'], ['fixture.ctc', 'paddle-ctc-onnx-v1'],
  ]);
  // Updating one profile must not duplicate it or remove the other provider.
  await publish('fixture.ctc', 'paddle-ctc-onnx-v1');
  assert.equal(JSON.parse(Buffer.from(JSON.parse(await readFile(catalogPath, 'utf8')).payload,
    'base64')).nativeOcr.length, 2);
  envelope.payload = Buffer.from('{}').toString('base64');
  const tampered = JSON.stringify(envelope);
  await writeFile(catalogPath, tampered);
  await assert.rejects(publish('fixture.ctc', 'paddle-ctc-onnx-v1'));
  assert.equal(await readFile(catalogPath, 'utf8'), tampered);
});
