// Explicit online preparation. Plugin builds remain offline.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(await readFile(join(root, 'language-plugins/japanese/data-pin.json'), 'utf8'));
const archive = JSON.parse(await readFile(join(root, 'language-plugins/japanese/archive-pin.json'), 'utf8'));
const cache = process.env.MLEARN_LANGUAGE_SOURCE_CACHE ?? join(root, '.mlearn/package-sources');
const exec = promisify(execFile);
const cancellation = new AbortController();
const cancel = () => cancellation.abort(new Error('Japanese source preparation cancelled'));
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);

async function verified(path, size, digest) {
  let metadata;
  try { metadata = await stat(path); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (metadata.size !== size) throw new Error(`Cached source size mismatch: ${path}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== digest) throw new Error(`Cached source digest mismatch: ${path}`);
  return true;
}
function bounded(limit, hash) {
  let length = 0;
  return new Transform({
    transform(chunk, _, callback) {
      length += chunk.length;
      if (length > limit) return callback(new Error('Source exceeds pinned byte limit'));
      hash?.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      if (hash && length !== limit) return callback(new Error('Source is truncated'));
      callback();
    },
  });
}
async function download(url, destination, size, digest, gitBlob = false) {
  const response = await fetch(url, { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(60000)]) });
  if (!response.ok || !response.body) throw new Error(`Source download rejected: ${response.status} ${url}`);
  const hash = createHash(gitBlob ? 'sha1' : 'sha256');
  if (gitBlob) hash.update(`blob ${size}\0`);
  await pipeline(Readable.fromWeb(response.body), bounded(size, hash), createWriteStream(destination), { signal: cancellation.signal });
  if (hash.digest('hex') !== digest) throw new Error(`Source digest mismatch: ${url}`);
}
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(join(cache, '.japanese-source-'));
try {
  const wheel = join(cache, pin.sudachi.wheel);
  if (!await verified(wheel, pin.sudachi.wheelByteLength, pin.sudachi.wheelSha256)) {
    const part = join(temporary, 'dictionary.whl');
    await download(pin.sudachi.wheelUrl, part, pin.sudachi.wheelByteLength, pin.sudachi.wheelSha256);
    await rename(part, wheel);
  }
  const official = join(cache, `JMdict_e-${pin.jmdict.sha256}.gz`);
  const canonical = join(cache, `JMdict_e-${archive.expandedSha256}.xml`);
  if (!await verified(official, pin.jmdict.byteLength, pin.jmdict.sha256)
      && !await verified(canonical, archive.expandedByteLength, archive.expandedSha256)) {
    const files = [archive.base, ...archive.patches];
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < files.length) {
        const index = next++;
        const item = files[index];
        await download(`https://raw.githubusercontent.com/${archive.repository}/${archive.revision}/${item.path}`,
          join(temporary, `${index}.br`), item.size, item.sha, true);
      }
    }));
    const xml = join(temporary, 'JMdict_e.xml');
    await pipeline(createReadStream(join(temporary, '0.br')), createBrotliDecompress(),
      bounded(128 * 1024 * 1024), createWriteStream(xml), { signal: cancellation.signal });
    const patch = join(temporary, 'next.patch');
    for (let index = 1; index < files.length; index++) {
      await pipeline(createReadStream(join(temporary, `${index}.br`)), createBrotliDecompress(),
        bounded(8 * 1024 * 1024), createWriteStream(patch), { signal: cancellation.signal });
      await exec('patch', ['--batch', '--silent', xml, patch], { maxBuffer: 65536, timeout: 30000, signal: cancellation.signal });
      if ((await stat(xml)).size > 128 * 1024 * 1024) throw new Error('Replayed XML exceeds preparation limit');
    }
    await verified(xml, archive.expandedByteLength, archive.expandedSha256);
    await rename(xml, canonical);
  }
  console.log('Pinned Japanese sources verified; subsequent plugin builds are offline.');
} finally {
  await rm(temporary, { recursive: true, force: true });
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
