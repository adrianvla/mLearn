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

test('failure-only picker experiments never replace the original native acceptance exit', async t => {
  const runner = fileURLToPath(new URL('../../tests/mobile/run-ios.sh', import.meta.url));
  for (const scenario of [
    { original: 0, replay: 0, keyboard: 0, calls: 1 },
    { original: 7, replay: 0, keyboard: 0, calls: 2 },
    { original: 3, replay: 1, keyboard: 0, calls: 3 },
  ]) {
    const root = await mkdtemp(path.join(tmpdir(), 'mlearn picker experiments-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const calls = path.join(root, 'calls.jsonl');
    await writeFile(path.join(root, 'maestro'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), flow = args.at(-1);
fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + '\\n');
const code = Number(flow.endsWith('/watch.yaml') ? process.env.ORIGINAL_EXIT
  : flow.endsWith('/picker-keyboard-replay.yaml') ? process.env.KEYBOARD_EXIT : process.env.REPLAY_EXIT);
const output = args[args.indexOf('--output') + 1];
fs.writeFileSync(output, '<testsuites><testsuite>' + (code ? '<failure>Assertion is false: id: m01-japanese, mp4 is not visible</failure>' : '') + '</testsuite></testsuites>');
process.exit(code);
`, { mode: 0o755 });
    const result = spawnSync('bash', [runner, 'retained-test-device'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`,
        TEST_CALLS: calls, ORIGINAL_EXIT: String(scenario.original),
        REPLAY_EXIT: String(scenario.replay), KEYBOARD_EXIT: String(scenario.keyboard) },
    });
    assert.equal(result.status, scenario.original, result.stderr || result.error?.message);
    const invocations = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(invocations.length, scenario.calls);
    if (scenario.original) {
      const diagnostic = JSON.parse(await readFile(path.join(root, 'test-results/mobile/picker-diagnostic.json'), 'utf8'));
      assert.deepEqual(diagnostic, {
        video: 'm01-japanese', originalExit: scenario.original,
        identicalReplayExit: scenario.replay, keyboardReplayExit: scenario.calls === 3 ? scenario.keyboard : null,
      });
    }
  }
});
