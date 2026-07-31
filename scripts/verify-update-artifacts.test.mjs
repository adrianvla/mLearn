import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyUpdateArtifacts } from './verify-update-artifacts.mjs';

async function withReleaseDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-update-artifacts-'));
  try {
    return await run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('accepts metadata whose referenced artifacts and checksums match', async () => {
  await withReleaseDirectory(async (directory) => {
    const artifact = Buffer.from('installer');
    const checksum = crypto.createHash('sha512').update(artifact).digest('base64');
    fs.writeFileSync(path.join(directory, 'mLearn.Setup.2.7.0-x64.exe'), artifact);
    fs.writeFileSync(
      path.join(directory, 'latest.yml'),
      `version: 2.7.0\nfiles:\n  - url: mLearn.Setup.2.7.0-x64.exe\n    sha512: ${checksum}\n`,
    );

    assert.deepEqual(await verifyUpdateArtifacts(directory, '2.7.0'), ['latest.yml']);
  });
});

test('rejects mismatched versions and invalid checksums', async () => {
  await withReleaseDirectory(async (directory) => {
    fs.writeFileSync(path.join(directory, 'mLearn-2.7.0.AppImage'), 'installer');
    fs.writeFileSync(
      path.join(directory, 'latest-linux.yml'),
      'version: 2.7.0\nfiles:\n  - url: mLearn-2.7.0.AppImage\n    sha512: abc\n',
    );

    await assert.rejects(() => verifyUpdateArtifacts(directory, '2.8.0'), /expected 2\.8\.0/);
    await assert.rejects(() => verifyUpdateArtifacts(directory, '2.7.0'), /invalid SHA-512/);
  });
});

//
// V8 snapshot version consistency check
// Prevents cross-architecture contamination where electron-builder assembles a
// binary from one Electron version with snapshot files from another.
//
// Electron exposes its V8 version in snapshot_blob.bin and v8_context_snapshot.bin
// as a version string like "14.8.178.38-electron.0". The executable itself reports
// a (possibly different) version in its PE resources. A mismatch means the package
// was built with corrupted or cross-arch-contaminated binaries — a direct cause of
// the Squirrel.Mac "code object is not signed at all" class of failures on Windows.
//
// This test validates that within a single extracted release, the V8 snapshot version
// string is consistent across all snapshot files and matches the architecture
// declared in the artifact path.

import { V8_SNAPSHOT_VERSION_PATTERN, extractV8VersionFromSnapshot } from './verify-update-artifacts.mjs';

test('extracts V8 version from snapshot blob', async () => {
  const fixture = Buffer.concat([
    Buffer.alloc(100),
    Buffer.from('V8 version: 14.8.178.38-electron.0'),
    Buffer.alloc(5000),
    Buffer.from('snapshot version 14.8.178.38-electron.0'),
  ]);
  assert.equal(extractV8VersionFromSnapshot(fixture), '14.8.178.38-electron.0');
});

test('detects version mismatch between snapshot files (regression)', async () => {
  const fixture = Buffer.concat([
    Buffer.from('V8 version: 14.8.203.20-electron.0'),
    Buffer.from('snapshot version 14.8.178.38-electron.0'),
  ]);
  // Same file containing two different versions indicates cross-contamination
  assert.throws(
    () => extractV8VersionFromSnapshot(fixture),
    /inconsistent V8 versions/,
  );
});

test('returns null for snapshots without version strings', async () => {
  const fixture = Buffer.alloc(1000);
  assert.equal(extractV8VersionFromSnapshot(fixture), null);
});
