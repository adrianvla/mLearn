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

test('rejects missing metadata and stale artifact references', async () => {
  await withReleaseDirectory(async (directory) => {
    await assert.rejects(() => verifyUpdateArtifacts(directory), /No updater metadata/);
    fs.writeFileSync(
      path.join(directory, 'latest-linux-arm64.yml'),
      'version: 2.7.0\nfiles:\n  - url: mLearn-2.7.0-arm64.AppImage\n    sha512: unused\n',
    );
    await assert.rejects(() => verifyUpdateArtifacts(directory), /references missing artifact/);
  });
});
