import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../prepare-wordnet.py', import.meta.url));
const fixture = Buffer.from('A small deterministic archive acquisition fixture.');
const digest = createHash('sha256').update(fixture).digest('hex');
const launcher = `
import json, runpy, sys
from pathlib import Path
owner = runpy.run_path(sys.argv[1])
acquire = owner['acquire_archive']
state = acquire.__globals__
assert state['expected'] == '640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52'
assert state['archive_size'] == 11537239
# Small fixture pin only in this imported test instance; no production override.
state['expected'] = sys.argv[4]
state['archive_size'] = int(sys.argv[5])
state['sources'] = tuple(json.loads(sys.argv[3]))
root = Path(sys.argv[2])
archive = root / 'cache' / 'WordNet-3.0.tar.gz'
existing = root / 'legacy.tar.gz'
`;

async function sandbox(t, cached) {
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn-wordnet-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = path.join(root, 'cache');
  const archive = path.join(cache, 'WordNet-3.0.tar.gz');
  await mkdir(cache);
  if (cached) await writeFile(archive, cached);
  return { root, cache, archive };
}

function run(root, sources, body = 'acquire(archive, existing, False)') {
  return new Promise(resolve => {
    execFile('python3', ['-B', '-c', launcher + body, script, root, JSON.stringify(sources), digest, String(fixture.length)], {
      timeout: 10_000, env: { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
    }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? error.signal ?? 'SPAWN_ERROR' : 0, stdout, stderr }));
  });
}

async function boundary(t, archive) {
  const hits = [];
  const observed = [];
  const server = createServer((request, response) => {
    hits.push(request.url);
    observed.push(existsSync(archive) ? readFileSync(archive).toString('hex') : null);
    response.setHeader('Connection', 'close');
    switch (request.url) {
      case '/unavailable':
        response.writeHead(503).end();
        break;
      case '/truncated':
        response.writeHead(200, { 'Content-Length': fixture.length });
        response.end(fixture.subarray(0, 7));
        break;
      case '/corrupt':
        response.end(Buffer.alloc(fixture.length, 63));
        break;
      case '/oversized':
        response.writeHead(200, { 'Content-Length': fixture.length + 1 });
        response.end(Buffer.alloc(fixture.length + 1));
        break;
      case '/redirect':
        response.writeHead(302, { Location: '/valid' }).end();
        break;
      case '/valid':
        response.end(fixture);
        break;
      default:
        response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { hits, observed, urls: routes => routes.map(route => base + route) };
}

test('publishes verified bytes after HTTP, truncation, digest and size failures', async t => {
  // Given: every failure reaches a real local HTTP boundary before a good source.
  const box = await sandbox(t);
  const http = await boundary(t, box.archive);
  const routes = ['/unavailable', '/truncated', '/corrupt', '/oversized', '/redirect', '/valid'];
  const sources = http.urls(routes);
  // When: acquisition exhausts each failed source once and accepts the final source.
  const result = await run(box.root, sources);
  // Then: failed bytes never appear at the cache path, nor survive as partials.
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(http.hits, routes);
  assert.deepEqual(http.observed, routes.map(() => null));
  assert.deepEqual(await readFile(box.archive), fixture);
  assert.deepEqual(await readdir(box.cache), ['WordNet-3.0.tar.gz']);
  for (const source of sources.slice(0, -1)) assert.ok(result.stderr.includes(source));
});

for (const cached of [undefined, Buffer.from('previous corrupt cache')]) {
  test(`leaves ${cached ? 'existing bytes unchanged' : 'no cache'} when every source fails`, async t => {
    // Given: failed sources, with or without an existing cache.
    const box = await sandbox(t, cached);
    const http = await boundary(t, box.archive);
    const routes = ['/truncated', '/corrupt'];
    // When: all candidates are rejected.
    const result = await run(box.root, http.urls(routes));
    // Then: no failed candidate is published and all staging storage is removed.
    assert.notEqual(result.code, 0);
    assert.deepEqual(http.hits, routes);
    assert.deepEqual(http.observed, routes.map(() => cached?.toString('hex') ?? null));
    assert.deepEqual(await readdir(box.cache), cached ? ['WordNet-3.0.tar.gz'] : []);
    if (cached) assert.deepEqual(await readFile(box.archive), cached);
  });
}

test('replaces a corrupt cache only after validating the complete candidate', async t => {
  // Given: an earlier poisoned cache and a good source.
  const cached = Buffer.from('previous corrupt cache');
  const box = await sandbox(t, cached);
  const http = await boundary(t, box.archive);
  // When: a complete valid archive is acquired.
  const result = await run(box.root, http.urls(['/valid']));
  // Then: the old cache survives until publication; only verified bytes replace it.
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(http.observed, [cached.toString('hex')]);
  assert.deepEqual(await readFile(box.archive), fixture);
  assert.deepEqual(await readdir(box.cache), ['WordNet-3.0.tar.gz']);
});

test('preserves the previous cache and cleans staging if atomic publication fails', async t => {
  // Given: a valid transfer but a filesystem that rejects the final rename.
  const cached = Buffer.from('previous cache');
  const box = await sandbox(t, cached);
  const http = await boundary(t, box.archive);
  // When: the real acquisition reaches its same-directory publication boundary.
  const result = await run(box.root, http.urls(['/valid']), `
def reject_publish(part, destination):
    assert part.parent.parent == destination.parent
    assert part.read_bytes() == ${JSON.stringify(fixture.toString())}.encode()
    raise PermissionError('injected publication failure')
Path.replace = reject_publish
acquire(archive, existing, False)
`);
  // Then: publication failure does not destroy the earlier cache or retain partials.
  assert.notEqual(result.code, 0);
  assert.deepEqual(http.hits, ['/valid']);
  assert.deepEqual(await readFile(box.archive), cached);
  assert.deepEqual(await readdir(box.cache), ['WordNet-3.0.tar.gz']);
});

test('continues after a process deadline with finite request and redirect limits', async t => {
  // Given: an expired first attempt, injected without depending on elapsed time.
  const box = await sandbox(t);
  const http = await boundary(t, box.archive);
  const sources = http.urls(['/unavailable', '/valid']);
  // When: the subprocess deadline fires, then the next real HTTP source succeeds.
  const result = await run(box.root, sources, `
subprocess = state['subprocess']
original = subprocess.run
limits = []
def expire_first(command, **options):
    limits.append({
        'process': options['timeout'],
        'request': int(command[command.index('--max-time') + 1]),
        'connect': int(command[command.index('--connect-timeout') + 1]),
        'redirects': int(command[command.index('--max-redirs') + 1]),
        'bytes': int(command[command.index('--max-filesize') + 1]),
    })
    if len(limits) == 1:
        raise subprocess.TimeoutExpired(command, options['timeout'])
    return original(command, **options)
subprocess.run = expire_first
acquire(archive, existing, False)
print(json.dumps(limits))
`);
  // Then: no retry or live timer is needed and the next source is usable.
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(http.hits, ['/valid']);
  assert.ok(result.stderr.includes(sources[0]));
  const limits = JSON.parse(result.stdout);
  assert.equal(limits.length, 2);
  for (const limit of limits) {
    assert.ok(limit.connect > 0 && limit.connect <= limit.request);
    assert.ok(limit.request > 0 && limit.request <= 120);
    assert.ok(limit.process >= limit.request && limit.process <= 125);
    assert.ok(limit.redirects > 0 && limit.redirects <= 3);
    assert.equal(limit.bytes, fixture.length);
  }
  assert.deepEqual(await readFile(box.archive), fixture);
});

for (const scenario of ['cached', 'legacy', 'missing', 'corrupt-cache', 'corrupt-legacy']) {
  test(`offline acquisition uses no network with ${scenario} storage`, async t => {
    // Given: isolated storage and a source that must never receive a request.
    const cached = scenario === 'cached' ? fixture : scenario === 'corrupt-cache' ? Buffer.from('bad') : undefined;
    const box = await sandbox(t, cached);
    if (scenario.includes('legacy')) {
      await writeFile(path.join(box.root, 'legacy.tar.gz'), scenario === 'legacy' ? fixture : Buffer.from('bad'));
    }
    const http = await boundary(t, box.archive);
    // When: preparation is explicitly offline.
    const result = await run(box.root, http.urls(['/valid']), 'acquire(archive, existing, True)');
    // Then: only already verified local bytes can be published.
    const success = scenario === 'cached' || scenario === 'legacy';
    assert.equal(result.code === 0, success, result.stderr);
    assert.deepEqual(http.hits, []);
    assert.deepEqual(await readdir(box.cache), success || cached ? ['WordNet-3.0.tar.gz'] : []);
    if (success || cached) assert.deepEqual(await readFile(box.archive), success ? fixture : cached);
    if (scenario.includes('legacy')) {
      assert.deepEqual(await readFile(path.join(box.root, 'legacy.tar.gz')), scenario === 'legacy' ? fixture : Buffer.from('bad'));
    }
  });
}
