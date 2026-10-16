import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const wrapper = fileURLToPath(new URL('../../tests/mobile/ios-driver/xcodebuild', import.meta.url));
async function forwarded(t, args) {
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn driver invocation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tool = path.join(root, 'real xcodebuild');
  const calls = path.join(root, 'args');
  await writeFile(tool, '#!/bin/bash\nprintf "%s\\0" "$@" > "$TEST_CALLS"\n', { mode: 0o755 });
  const result = spawnSync('bash', [wrapper, ...args], {
    env: { ...process.env, MLEARN_XCODEBUILD: tool, TEST_CALLS: calls }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return (await readFile(calls, 'utf8')).split('\0').slice(0, -1);
}

test('Maestro launches its serving XCTest without running bundled helper unit tests', async t => {
  const args = ['test-without-building', '-xctestrun', '/fixture path/maestro-driver-ios-config.xctestrun', '-destination', 'id=H00', '-derivedDataPath', '/build path'];
  assert.deepEqual(await forwarded(t, args), [...args, '-only-testing:maestro-driver-iosUITests/maestro_driver_iosUITests']);
});

test('unrelated consuming-app builds and XCTest invocations pass through unchanged', async t => {
  for (const args of [
    ['build', '-workspace', '/app path/mLearn.xcworkspace'],
    ['test-without-building', '-xctestrun', '/app path/mLearn.xctestrun'],
  ]) assert.deepEqual(await forwarded(t, args), args);
});
