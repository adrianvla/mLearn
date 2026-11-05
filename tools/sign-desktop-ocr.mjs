// Local development provenance only. Production publishers supply their own
// authenticated artifacts and key; no retained runtime path enters the catalog.
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import path from 'node:path';

const [input, descriptor] = process.argv.slice(2);
if (!input || !descriptor) throw new Error('Usage: node tools/sign-desktop-ocr.mjs PACKAGING_OUTPUT PROFILE_DESCRIPTOR');
const identity = JSON.parse(await readFile(descriptor, 'utf8'));
if (!identity.id || !/^[a-zA-Z0-9._-]{1,128}$/.test(identity.id)
    || typeof identity.label !== 'string' || !identity.label || identity.label.length > 128
    || !['paddle-manga-onnx-v1', 'paddle-ctc-onnx-v1'].includes(identity.executor)) {
  throw new Error('Invalid native OCR profile descriptor');
}
const metadata = JSON.parse(await readFile(path.join(input, 'artifacts.json'), 'utf8'));
const destination = path.resolve('target/plugin-cdn');
await mkdir(path.join(destination, 'native-ocr'), { recursive: true });
async function artifact(key) {
  const info = metadata[key];
  const relative = `native-ocr/${info.sha256}.zip`;
  await copyFile(path.join(input, `${key}.zip`), path.join(destination, relative));
  return { path: relative, sha256: info.sha256, byteLength: info.byteLength };
}
const profile = {
  id: identity.id,
  label: identity.label,
  target: `${process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch}`,
  executor: identity.executor,
  runtime: await artifact('runtime'), models: await artifact('models'),
  runtimeIndexSha256: metadata.runtime.indexSha256,
  modelsIndexSha256: metadata.models.indexSha256,
};
const privateKey = createPrivateKey(await readFile('.mlearn/dev-publisher.pem'));
const catalogPath = path.join(destination, 'ocr-catalog.json');
let existing;
try {
  existing = await readFile(catalogPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let profiles = [];
if (existing) {
  if (existing.byteLength > 65536) throw new Error('Existing native OCR catalog exceeds its bound');
  const envelope = JSON.parse(existing);
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!verify(null, bytes, createPublicKey(privateKey), Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Refusing to replace an unauthenticated native OCR catalog');
  }
  const catalog = JSON.parse(bytes);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.nativeOcr) || catalog.nativeOcr.length > 8) {
    throw new Error('Existing native OCR catalog has an unsupported schema');
  }
  profiles = catalog.nativeOcr.filter(item => item.id !== profile.id);
}
profiles.push(profile);
if (profiles.length > 8) throw new Error('Native OCR catalog exceeds eight profiles');
const payload = Buffer.from(JSON.stringify({
  schemaVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 172800, nativeOcr: profiles,
}));
await writeFile(catalogPath, JSON.stringify({
  payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64'),
}));
console.log('SIGNED ' + JSON.stringify(profile));
