// Drive the real Tauri binary through WebKit WebDriver, without mocking IPC.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startCatalog } from '../../tools/catalog-server.mjs';

await mkdir('test-results/desktop', { recursive: true });
const catalog = await startCatalog(path.resolve('target/plugin-cdn'));
const driver = spawn('tauri-driver', ['--port', '4444'], { stdio: 'inherit' });
let session;
async function rpc(method, endpoint, body) {
  const response = await fetch(`http://127.0.0.1:4444${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
  return result.value;
}
async function until(work, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await work(); if (result) return result; } catch (error) { last = error; }
    await delay(150);
  }
  throw new Error(`Timed out: ${description}; ${last ?? ''}`);
}
async function script(source, args = []) { return rpc('POST', `/session/${session}/execute/sync`, { script: source, args }); }
async function text(expected) { return until(async () => (await script('return document.body.innerText')).includes(expected), expected); }
async function click(label) {
  const element = await until(async () => {
    const value = await rpc('POST', `/session/${session}/element`, { using: 'css selector', value: `[aria-label="${label}"]` });
    return value['element-6066-11e4-a52e-4f735466cecf'];
  }, label);
  await rpc('POST', `/session/${session}/element/${element}/click`, {});
}
async function launch() {
  const result = await rpc('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: path.resolve('target/debug/mlearn-desktop') } } } });
  session = result.sessionId;
  assert.ok(session, 'WebDriver session missing');
  await text('Tauri desktop');
}
async function screenshot(name) {
  const data = await rpc('GET', `/session/${session}/screenshot`);
  await writeFile(`test-results/desktop/${name}.png`, Buffer.from(data, 'base64'));
}
try {
  await until(() => rpc('GET', '/status'), 'WebDriver startup');
  await launch();
  await click('Install SDK example');
  await text('Verified plugin installed from the catalog.');
  await click('Run hello');
  await text('Hello, world!');
  await click('Slate');
  await text('Theme saved by Rust');
  await screenshot('downloaded-plugin-and-saved-theme');
  await rpc('DELETE', `/session/${session}`); session = undefined;
  await launch();
  await text('Current: Slate.');
  await click('Run hello');
  await text('Hello, world!');
  await screenshot('persisted-after-native-restart');
  console.log('Real Tauri IPC, signed plugin download, Wasmi invocation, SQLite save and process restart passed.');
} catch (error) {
  if (session) {
    await screenshot('failure').catch(() => {});
    const body = await script('return document.body.innerText').catch(() => 'No DOM available');
    await writeFile('test-results/desktop/failure.txt', String(body));
  }
  throw error;
} finally {
  if (session) await rpc('DELETE', `/session/${session}`).catch(() => {});
  driver.kill('SIGTERM');
  catalog.close();
}
