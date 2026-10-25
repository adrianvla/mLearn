import { spawn } from 'node:child_process';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
// Parsing needs no entropy. getrandom's official unsupported backend returns
// an error if an unrelated lopdf write/encryption path ever requests randomness;
// it supplies neither predictable random bytes nor ambient JS/WASI imports.
const flags = [process.env.CARGO_ENCODED_RUSTFLAGS ?? '', '--cfg', 'getrandom_backend="unsupported"']
  .filter(Boolean).join('\x1f');
const jobs = process.env.CARGO_BUILD_JOBS ?? '2';
const child = spawn('cargo', ['build', '--locked', '-p', 'mlearn-document-pdf-guest',
  '--target', 'wasm32-unknown-unknown', '--release', '--lib', '-j', jobs], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: jobs, CARGO_ENCODED_RUSTFLAGS: flags },
});
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (status, signal) => signal ? reject(new Error(`cargo terminated: ${signal}`)) : resolve(status));
});
if (code !== 0) process.exit(code ?? 1);
const compiled = path.join(target, 'wasm32-unknown-unknown/release/mlearn_document_pdf_guest.wasm');
const bytes = await readFile(compiled);
if (bytes.length > 4 * 1024 * 1024 || bytes.subarray(0, 4).toString('hex') !== '0061736d') {
  throw new Error('document guest is not an admissible core-Wasm module');
}
const output = path.join(root, 'crates/document-parser/artifacts');
await mkdir(output, { recursive: true });
const artifact = path.join(output, 'document_pdf_guest.wasm');
const previous = await readFile(artifact).catch(error => {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
  throw error;
});
// Native preparation must not restart a running desktop app when the trusted
// document code is unchanged.
if (!previous?.equals(bytes)) await copyFile(compiled, artifact);
console.log(`document-pdf-guest bytes=${bytes.length} sha256=${createHash('sha256').update(bytes).digest('hex')}`);
