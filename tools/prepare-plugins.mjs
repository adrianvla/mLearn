import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, copyFile } from 'node:fs/promises';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, createReadStream } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPrep=spawnSync('python3',['tools/prepare-wordnet.py','--offline'],{cwd:root,stdio:'inherit'});
if(dataPrep.status!==0) throw new Error('WordNet resource preparation failed');
const japanesePrep=spawnSync('python3',['tools/prepare-japanese.py','--offline'],{cwd:root,stdio:'inherit'});
if(japanesePrep.status!==0) throw new Error('Japanese pinned resource preparation failed');
const result = spawnSync('cargo', ['build', '-p', 'mlearn-example-hello', '-p','mlearn-language-english', '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) throw result.error ?? new Error('Plugin build failed');
const japaneseBuild = spawnSync('cargo', ['build', '--manifest-path','language-plugins/japanese/Cargo.toml','--locked','--target','wasm32-unknown-unknown','--release','--lib'], {cwd:root,stdio:'inherit'});
if (japaneseBuild.error || japaneseBuild.status !== 0) throw japaneseBuild.error ?? new Error('Japanese plugin build failed');
const target = process.env.CARGO_TARGET_DIR ? path.resolve(root,process.env.CARGO_TARGET_DIR) : path.join(root,'target');
const japaneseTarget = process.env.CARGO_TARGET_DIR ? target : path.join(root,'language-plugins/japanese/target');
const destination = path.join(root, 'target/plugin-cdn');
await mkdir(path.join(destination, 'modules'), { recursive: true });
await mkdir(path.join(destination, 'data'), { recursive: true });
const code = await readFile(path.join(target, 'wasm32-unknown-unknown/release/mlearn_example_hello.wasm'));
const data = await readFile(path.join(root, 'language-plugins/hello/assets/greeting.json'));
async function artifact(bytes, directory, extension) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const relative = `${directory}/${sha256}.${extension}`;
  await writeFile(path.join(destination, relative), bytes);
  return { path: relative, sha256, byteLength: bytes.length };
}
async function fileArtifact(source, directory, extension) {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(source)) hash.update(chunk);
  const sha256=hash.digest('hex');
  const relative=`${directory}/${sha256}.${extension}`;
  await copyFile(source,path.join(destination,relative));
  return {path:relative,sha256,byteLength:(await stat(source)).size};
}
const base = JSON.parse(await readFile(path.join(root, 'language-plugins/hello/plugin.json'), 'utf8'));
const { fixture: _fixture, ...identity } = base;
const manifest = { ...identity, code: await artifact(code, 'modules', 'wasm'), assets: { 'greeting.json': await artifact(data, 'data', 'json') } };
const englishIdentity=JSON.parse(await readFile(path.join(root,'language-plugins/english/plugin.json'),'utf8'));
const english={...englishIdentity,resources:{'lexicon.sqlite':'key-value-sqlite-v1'},code:await fileArtifact(path.join(target,'wasm32-unknown-unknown/release/mlearn_language_english.wasm'),'modules','wasm'),assets:{'lexicon.sqlite':await fileArtifact(path.join(root,'target/wordnet/lexicon-v1.sqlite'),'data','sqlite')}};
const japaneseIdentity=JSON.parse(await readFile(path.join(root,'language-plugins/japanese/plugin.json'),'utf8'));
const japanese={...japaneseIdentity,code:await fileArtifact(path.join(japaneseTarget,'wasm32-unknown-unknown/release/mlearn_japanese_engine.wasm'),'modules','wasm'),assets:{
  'sudachi.dic':await fileArtifact(path.join(root,'target/japanese/system.dic'),'data','dic'),
  'lexicon.sqlite':await fileArtifact(path.join(root,'target/japanese/lexicon-v1.sqlite'),'data','sqlite'),
}};
const plugins=[manifest,english,japanese];
const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, expiresAt: Math.floor(Date.now() / 1000) + 172800, plugins }));
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
await writeFile(path.join(destination, 'bundle.json'), JSON.stringify(plugins));
await writeFile(path.join(root, '.mlearn/dev-trust.json'), JSON.stringify({ url: 'http://127.0.0.1:7780/catalog.json', publicKey }));
console.log('Built hello, English and Japanese. Desktop authenticates/downloads code and data; mobile bundles executable plugins and resource inputs.');
