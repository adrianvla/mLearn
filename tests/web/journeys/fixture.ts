/// <reference types="node" />
import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { startRuntimeBrowserQa, attachRuntimeBrowserQa } from '../../../tools/runtime-browser-qa.mjs';

export type NativeCore = Awaited<ReturnType<typeof startRuntimeBrowserQa>>;

/**
 * Milestone Review journeys: real Rust runtime, signed packages, SQLite and language execution behind
 * the browser-hosted UI. Every journey fails on any renderer console error or uncaught page error.
 * The QA transport answers native command errors with HTTP 500, which Chromium reports as a failed
 * resource load; in Tauri the same rejection is an IPC promise, so only that transport line is exempt.
 */
export const test = base.extend<{ nativeCore: NativeCore; consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      errors.push(`${message.text()} @ ${message.location().url}`);
    });
    await use(errors);
  },
  nativeCore: async ({ page, consoleErrors }, use, info) => {
    const native = await startRuntimeBrowserQa({ profile: `.mlearn/m01-m11/profiles/${info.title.slice(0, 24).replace(/\W+/g, '-')}-${randomUUID()}` });
    try {
      await attachRuntimeBrowserQa(page, native.url);
      await page.route(`${native.url}/unsupported-media/**`, async route => {
        const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
        let file: string;
        try { file = await native.invoke('source_media_path', { id }); } catch { await route.fulfill({ status: 404 }); return; }
        const { size } = await stat(file);
        const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
        const start = range ? Number(range[1]) : 0;
        const end = Math.min(size - 1, range?.[2] ? Number(range[2]) : start + 4 * 1024 * 1024 - 1);
        const handle = await open(file, 'r');
        try {
          const body = Buffer.alloc(end - start + 1);
          await handle.read(body, 0, body.length, start);
          await route.fulfill({ status: 206, body, headers: {
            'Content-Type': mediaType(file), 'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(body.length),
          } });
        } finally { await handle.close(); }
      });
      await use(native);
      const transport = `${native.url}/invoke`;
      const product = consoleErrors.filter(line => !(line.startsWith('Failed to load resource') && line.endsWith(`@ ${transport}`)));
      await info.attach('console-errors.json', { body: JSON.stringify(consoleErrors, null, 2), contentType: 'application/json' });
      expect(product, 'renderer console errors').toEqual([]);
    } finally {
      await native.close();
    }
  },
});

export { expect };

function mediaType(file: string) {
  const extension = path.extname(file).toLowerCase();
  return extension === '.webm' ? 'video/webm' : extension === '.mov' ? 'video/quicktime' : 'video/mp4';
}

export async function installPackage(page: Page, name: RegExp | string = /English/) {
  await page.goto('/settings?section=languages');
  await page.getByRole('button', { name: 'Check for packages', exact: true }).click();
  const updateLabel = typeof name === 'string' ? new RegExp(`^Update .*${name}`) : new RegExp(`^Update .*${name.source}`);
  const label = typeof name === 'string' ? new RegExp(`^Install .*${name}`) : new RegExp(`^Install .*${name.source}`);
  const installed = page.getByRole('button', { name: updateLabel }).first();
  await expect(installed.or(page.getByRole('button', { name: label })).first()).toBeVisible({ timeout: 30_000 });
  if (await installed.isVisible()) return;
  await page.getByRole('button', { name: label }).first().click();
  const update = typeof name === 'string' ? new RegExp(`^Update .*${name}`) : new RegExp(`^Update .*${name.source}`);
  await expect(page.getByRole('button', { name: update }).first()).toBeVisible({ timeout: 60_000 });
}

/** A tone WAV: loud speech-like segment then silence, for synthesis and fake microphone input. */
export function toneWav(loudSeconds: number, silentSeconds: number, rate = 16000) {
  const samples = Math.round((loudSeconds + silentSeconds) * rate);
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    const loud = index < loudSeconds * rate;
    data.writeInt16LE(loud ? Math.round(12000 * Math.sin(2 * Math.PI * 220 * index / rate)) : 0, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export type SpeechFixture = {
  readonly url: string;
  transcript: string;
  fail: boolean;
  readonly requests: { path: string; body: string }[];
  close(): Promise<void>;
};

/** External OpenAI-compatible speech provider fixture; the runtime calls it natively. */
export async function startSpeechFixture(): Promise<SpeechFixture> {
  const requests: { path: string; body: string }[] = [];
  const state = { transcript: 'Hello there', fail: false };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    requests.push({ path: request.url ?? '', body: request.url?.endsWith('/speech') ? body.toString() : `${body.length} bytes` });
    if (state.fail) { response.writeHead(503); response.end(); return; }
    if (request.url === '/v1/audio/speech') {
      const audio = toneWav(6, 0);
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length });
      response.end(audio);
    } else if (request.url === '/v1/audio/transcriptions') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ text: state.transcript }));
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Speech fixture did not bind');
  return {
    url: `http://127.0.0.1:${address.port}/v1`, requests,
    get transcript() { return state.transcript; }, set transcript(value) { state.transcript = value; },
    get fail() { return state.fail; }, set fail(value) { state.fail = value; },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

export async function execute<T = any>(native: NativeCore, request: object): Promise<T> {
  return JSON.parse(await native.invoke('runtime_execute', { request: JSON.stringify(request) }));
}
