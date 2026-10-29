// UI acceptance adapter: real Rust/SQLite/language execution; only the external
// text provider/catalog availability is controlled. Native window/media/clipboard claims require
// the separate consuming-platform harness and are never fabricated here.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { EventEmitter, once } from 'node:events';
import path from 'node:path';
import { startCatalog } from './catalog-server.mjs';

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function nativeHost(binary, profile, trust) {
  const child = spawn(binary, [profile, JSON.stringify(trust)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let next = 0;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => readyReject(new Error('Native QA owner did not become ready')), 15000);
  const exit = new Promise(resolve => child.once('close', (code, signal) => {
    clearTimeout(timer);
    const error = new Error(`Native QA owner exited (${code ?? signal})`);
    readyReject(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    resolve({ code, signal });
  }));
  child.once('error', error => { clearTimeout(timer); readyReject(error); });
  child.stdin.on('error', error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let response;
    try {
      if (line.length > 4_194_304) throw new Error('Native QA reply exceeded its bound');
      response = JSON.parse(line);
    } catch (error) {
      readyReject(error);
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      child.kill('SIGTERM');
      return;
    }
    if (response.event === 'ready') { clearTimeout(timer); readyResolve(); return; }
    const waiter = pending.get(response.id);
    if (!waiter) {
      child.kill('SIGTERM');
      return;
    }
    pending.delete(response.id);
    if (Object.hasOwn(response, 'error')) {
      if (typeof response.error === 'string') waiter.reject(new Error(response.error));
      else if (response.error && typeof response.error === 'object'
        && typeof response.error.code === 'string' && typeof response.error.message === 'string')
        waiter.reject(response.error);
      else waiter.reject(new Error('Malformed native QA error'));
    } else waiter.resolve(response.value);
  });
  return {
    child, ready,
    invoke(command, args) {
      const lane = ['begin_bounded_read', 'cancel_bounded_read', 'cancel_source_open'].includes(command)
        ? command : 'ordinary';
      const limit = lane === 'ordinary' ? 32 : lane === 'cancel_source_open' ? 1 : 2;
      if ([...pending.values()].filter(waiter => waiter.lane === lane).length >= limit)
        return Promise.reject({ code: 'busy', message: 'Native QA transport lane is full' });
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, lane });
        child.stdin.write(`${JSON.stringify({ id, command, request: args?.request ?? null,
          read_id: args?.id ?? null })}\n`, error => {
          if (error) { pending.delete(id); reject(error); }
        });
      });
    },
    async stop(crash = false) {
      if (crash) child.kill('SIGKILL');
      else child.stdin.end();
      let forced = false;
      const timeout = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 15000);
      const result = await exit;
      clearTimeout(timeout);
      lines.close();
      if (forced || !crash && result.code !== 0) throw new Error('Native QA owner did not shut down cleanly');
    },
  };
}

export async function startRuntimeBrowserQa({ profile, binary = 'target/debug/examples/runtime_browser_qa',
  responseText = 'Children walked home.' }) {
  const trust = JSON.parse(await readFile('.mlearn/dev-trust.json', 'utf8'));
  await mkdir(profile, { recursive: true });
  let catalogMode = 'complete', heldCatalog = null;
  const catalogEvents = new EventEmitter();
  const catalog = await startCatalog(path.resolve('target/plugin-cdn'), 0, async (request, response, byteLength) => {
    if (catalogMode === 'fail') {
      response.writeHead(503);
      response.end();
    } else if (catalogMode === 'hold' && !request.url?.endsWith('.json')) {
      if (heldCatalog) throw new Error('Only one catalog response may remain active');
      heldCatalog = response;
      const closed = new Promise(resolve => response.once('close', resolve));
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': byteLength });
      response.flushHeaders();
      catalogEvents.emit('started');
      await closed;
      heldCatalog = null;
      catalogEvents.emit('closed');
    }
  });
  trust.url = `http://127.0.0.1:${catalog.address().port}/catalog.json`;
  let core = nativeHost(path.resolve(binary), path.resolve(profile), trust);
  try { await core.ready; } catch (error) {
    await core.stop().catch(stopError => console.error(stopError));
    await closeServer(catalog);
    throw error;
  }
  let mode = 'complete', held = null, providerRequests = 0;
  const providerEvents = new EventEmitter();
  const counts = new Map();
  const allowed = new Set(['http://127.0.0.1:4173', 'http://localhost:4173']);
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !allowed.has(origin)) { response.writeHead(403); response.end(); return; }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    try {
      let body = '', size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 262144) throw new Error('QA transport request exceeds its bound');
        body += chunk;
      }
      const value = JSON.parse(body);
      if (request.url === '/invoke') {
        if (typeof value.command !== 'string') throw new Error('Missing native command');
        if (value.command === 'runtime_execute' || value.command === 'execute_bounded_read') {
          const command = JSON.parse(value.args.request);
          const key = command.type === 'conversation' ? `conversation:${command.command.action}` : command.type;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        } else if (['begin_bounded_read', 'cancel_bounded_read', 'cancel_source_open'].includes(value.command)) {
          counts.set(value.command, (counts.get(value.command) ?? 0) + 1);
        }
        const result = await core.invoke(value.command, value.args);
        if (!response.destroyed) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ value: result }));
        }
      } else if (request.url === '/v1/chat/completions') {
        providerRequests++;
        if (mode === 'fail') {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'The external provider fixture is unavailable' }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }] })}\n\n`);
        if (mode === 'hold') {
          if (held) throw new Error('Only one provider response may remain active');
          held = response;
          response.once('close', () => {
            if (held === response) held = null;
            providerEvents.emit('closed', providerRequests);
          });
          providerEvents.emit('started', providerRequests);
        } else {
          response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        }
      } else { response.writeHead(404); response.end(); }
    } catch (error) {
      if (!response.destroyed) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        const coded = error && typeof error === 'object'
          && typeof error.code === 'string' && typeof error.message === 'string';
        response.end(JSON.stringify({ error: coded ? { code: error.code, message: error.message }
          : error instanceof Error ? error.message : String(error) }));
      }
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) { await core.stop(); await closeServer(catalog); throw error; }
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, profile, catalogUrl: trust.url,
    get pid() { return core.child.pid; },
    invoke: (command, args) => core.invoke(command, args),
    providerMode(value) {
      if (!['complete', 'hold', 'fail'].includes(value)) throw new Error('Unknown external provider fixture mode');
      mode = value;
    },
    catalogMode(value) {
      if (!['complete', 'hold', 'fail'].includes(value)) throw new Error('Unknown catalog fixture mode');
      catalogMode = value;
    },
    nextCatalogStart: () => once(catalogEvents, 'started', { signal: AbortSignal.timeout(5000) }),
    nextCatalogClose: () => once(catalogEvents, 'closed', { signal: AbortSignal.timeout(5000) }),
    metadata: () => ({ providerRequests, activeProvider: held !== null, activeCatalog: heldCatalog !== null,
      counts: Object.fromEntries(counts) }),
    nextProviderStart: () => once(providerEvents, 'started', { signal: AbortSignal.timeout(5000) }),
    nextProviderClose: () => once(providerEvents, 'closed', { signal: AbortSignal.timeout(5000) }),
    releaseProvider() {
      if (!held) throw new Error('No actual provider request is held');
      const response = held; held = null;
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    },
    async crashRestart() {
      await core.stop(true);
      core = nativeHost(path.resolve(binary), path.resolve(profile), trust);
      await core.ready;
    },
    async close() {
      try { await core.stop(); }
      finally { await closeServer(server); await closeServer(catalog); }
    },
  };
}

export async function attachRuntimeBrowserQa(page, url) {
  await page.addInitScript(({ url }) => {
    Object.defineProperty(globalThis, 'isTauri', { value: true });
    Object.defineProperty(window, '__MLEARN_MEDIA_BASE__', { value: `${url}/unsupported-media/` });
    let nextCallback = 0;
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: false,
      value: {
        metadata: { currentWindow: { label: 'qa-browser' }, currentWebview: { label: 'qa-browser' } },
        transformCallback(callback, once = false) {
          const id = ++nextCallback;
          window[`_${id}`] = data => { if (once) delete window[`_${id}`]; callback(data); };
          return id;
        },
        unregisterCallback(id) { delete window[`_${id}`]; },
        async invoke(command, args) {
          const response = await fetch(`${url}/invoke`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, args }),
          });
          const result = await response.json();
          if (!response.ok || Object.hasOwn(result, 'error')) {
            if (result.error && typeof result.error === 'object'
              && typeof result.error.code === 'string' && typeof result.error.message === 'string')
              throw result.error;
            throw new Error(result.error ?? 'Native QA transport failed');
          }
          return result.value;
        },
      },
    });
  }, { url });
}
