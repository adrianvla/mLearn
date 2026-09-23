#!/usr/bin/env node
/** Small service for local exercise or deployment behind TLS. No dashboard. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? '.');
const port = Number(process.env.KIKAN_RUNTIME_PORT ?? 7780);
const countsPath = path.join(directory, 'diagnostic-counts.json');
let previous = {};
try { previous = JSON.parse(fs.readFileSync(countsPath, 'utf8')); } catch { /* Fresh service. */ }
const counts = new Map(Object.entries(previous));
const files = new Map([['/discovery.json', 'discovery.json'], ['/configuration.json', 'configuration.json']]);
const server = http.createServer((request, response) => {
  if (request.method === 'GET' && files.has(request.url)) {
    try {
      const data = fs.readFileSync(path.join(directory, files.get(request.url)));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(data);
    } catch { response.writeHead(404).end(); }
    return;
  }
  if (request.method === 'GET' && /^\/rollbacks\/\d+\.\d+\.\d+\/[A-Za-z0-9._-]+$/.test(request.url ?? '')) {
    try {
      const data = fs.readFileSync(path.join(directory, request.url.slice(1)));
      response.writeHead(200, { 'Content-Type': request.url.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
        'Content-Length': data.length, 'Cache-Control': 'public, max-age=31536000, immutable' });
      response.end(data);
    } catch { response.writeHead(404).end(); }
    return;
  }
  if (request.method === 'POST' && request.url === '/telemetry') {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4096) request.destroy();
    });
    request.on('end', () => {
      try {
        const event = JSON.parse(raw);
        const allowed = new Set(['app_start', 'runtime_rejected', 'guardian_blocked', 'update_failed', 'process_crash']);
        if (!event || Object.keys(event).some((key) => !['event', 'version', 'platform', 'fingerprint'].includes(key))
          || !allowed.has(event.event) || typeof event.version !== 'string' || event.version.length > 30
          || typeof event.platform !== 'string' || event.platform.length > 20
          || (event.fingerprint !== undefined && (typeof event.fingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(event.fingerprint)))) throw new Error('Invalid event');
        const today = new Date().toISOString().slice(0, 10);
        const key = `${today}:${event.event}:${event.platform}:${event.fingerprint ?? 'none'}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        for (const existing of counts.keys()) if (existing.slice(0, 10) < cutoff) counts.delete(existing);
        if (counts.size > 1000) counts.delete(counts.keys().next().value);
        const temporary = `${countsPath}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(counts)));
        fs.renameSync(temporary, countsPath);
        response.writeHead(204).end();
      } catch { response.writeHead(400).end(); }
    });
    return;
  }
  response.writeHead(404).end();
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`KikanRuntime serving ${directory} on ${port}\n`));
