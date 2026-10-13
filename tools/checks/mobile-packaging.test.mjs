import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the real build script's arguments and file layout, without requiring
// Xcode on every unit-test host. The actual compiler/Pods gate remains in CI.
async function iosCommands(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn mobile packaging-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tools'));
  const script = path.join(root, 'tools/build-mobile.mjs');
  await copyFile(new URL('../build-mobile.mjs', import.meta.url), script);
  const calls = path.join(root, 'calls.jsonl');
  const preload = path.join(root, 'toolchain.mjs');
  await writeFile(preload, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
    import path from 'node:path';
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    childProcess.spawnSync = (command, args) => {
      appendFileSync(process.env.TEST_CALLS, JSON.stringify({ command, args }) + '\\n');
      if (command === 'cargo' && args.includes('--out-dir')) {
        const out = args[args.indexOf('--out-dir') + 1];
        mkdirSync(out, { recursive: true });
        writeFileSync(path.join(out, 'MlearnRust.swift'), '// generated fixture');
        writeFileSync(path.join(out, 'MlearnRustFFI.h'), '// generated fixture');
        writeFileSync(path.join(out, 'MlearnRustFFI.modulemap'), 'module MlearnRustFFI { header "MlearnRustFFI.h" export * }');
      }
      if (command === 'xcrun' && args[0] === 'lipo') {
        const out = args[args.indexOf('-output') + 1];
        if (!existsSync(path.dirname(out))) throw new Error('Simulator output directory was not created');
      }
      return { status: 0, stdout: '/fixture/iPhoneSimulator.sdk\\n', stderr: '' };
    };
    syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, ['--import', preload, script, 'ios'], {
    encoding: 'utf8', env: { ...process.env, TEST_CALLS: calls }, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}

test('iOS XCFramework uses identical static library names for device and simulator', async t => {
  const calls = await iosCommands(t);
  const pack = calls.find(call => call.command === 'xcodebuild' && call.args[0] === '-create-xcframework');
  assert.ok(pack, 'XCFramework creation must be invoked');
  const libraries = pack.args.flatMap((arg, i) => arg === '-library' ? [pack.args[i + 1]] : []);
  assert.deepEqual(libraries.map(file => path.basename(file)), ['libmlearn_ffi.a', 'libmlearn_ffi.a']);
  assert.notEqual(libraries[0], libraries[1], 'Device and simulator libraries must stay separate');
  const lipo = calls.find(call => call.command === 'xcrun' && call.args[0] === 'lipo');
  assert.ok(lipo);
  assert.equal(lipo.args[lipo.args.indexOf('-output') + 1], libraries[1]);
  assert.ok(lipo.args.some(arg => arg.includes('/aarch64-apple-ios-sim/')));
  assert.ok(lipo.args.some(arg => arg.includes('/x86_64-apple-ios/')));
});
