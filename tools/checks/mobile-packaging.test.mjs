import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the real build script's arguments and file layout, without requiring
// Xcode on every unit-test host. The actual compiler/Pods gate remains in CI.
async function iosCommands(t, embeddedModuleMap = false) {
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
    import { appendFileSync, mkdirSync, writeFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
    import path from 'node:path';
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const spawnSync = childProcess.spawnSync;
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
      if (command === 'xcodebuild') {
        const out = args[args.indexOf('-output') + 1];
        for (const slice of ['ios-arm64', 'ios-arm64_x86_64-simulator']) {
          const headers = path.join(out, slice, 'Headers');
          mkdirSync(headers, { recursive: true });
          const source = args[args.indexOf('-headers') + 1];
          for (const file of readdirSync(source)) copyFileSync(path.join(source, file), path.join(headers, file));
          if (process.env.TEST_EMBED_MODULE_MAP === '1') writeFileSync(path.join(headers, 'module.modulemap'), 'module MlearnRustFFI {}');
        }
      }
      // Run the real inspection against the assembled fixture. Other tools must
      // never supply plausible-looking output to an unrelated command.
      if (command === 'find') return spawnSync(command, args, { encoding: 'utf8' });
      return { status: 0, stdout: command === 'xcrun' && args.includes('--show-sdk-path') ? '/fixture/iPhoneSimulator.sdk\\n' : '', stderr: '' };
    };
    syncBuiltinESMExports();
  `);
  const result = spawnSync(process.execPath, ['--import', preload, script, 'ios'], {
    encoding: 'utf8', env: { ...process.env, TEST_CALLS: calls, TEST_EMBED_MODULE_MAP: embeddedModuleMap ? '1' : '0' }, timeout: 10_000,
  });
  return { result, calls: (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) };
}

test('iOS XCFramework uses identical static library names for device and simulator', async t => {
  const { calls, result } = await iosCommands(t);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
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

test('iOS packaging rejects an XCFramework that reintroduces the FFI module map', async t => {
  const { result } = await iosCommands(t, true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected XCFramework module map\(s\): .*module\.modulemap/);
});

test('native video install repair is idempotent and rejects unsupported source or versions', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn video lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'tools'));
  const script = path.join(root, 'tools/patch-expo-video.mjs');
  await copyFile(new URL('../patch-expo-video.mjs', import.meta.url), script);
  const packageRoot = path.join(root, 'node_modules/expo-video');
  await mkdir(path.join(packageRoot, 'ios'), { recursive: true });
  const manifest = path.join(packageRoot, 'package.json');
  const file = path.join(packageRoot, 'ios/VideoView.swift');
  const before = `class VideoView {
  public override func didMoveToWindow() {
    #if !os(tvOS)
    playerViewController.beginAppearanceTransition(self.window != nil, animated: true)
    #endif
  }

  public override func safeAreaInsetsDidChange() {}
}
`;
  await writeFile(manifest, JSON.stringify({ version: '57.0.5' }));
  await writeFile(file, before);
  const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000 });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  const patched = await readFile(file, 'utf8');
  const superCall = patched.indexOf('super.didMoveToWindow()');
  assert.ok(superCall >= 0 && superCall < patched.indexOf('beginAppearanceTransition('));
  assert.ok(patched.indexOf('endAppearanceTransition()') > patched.indexOf('beginAppearanceTransition('));
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(file, 'utf8'), patched);
  const drift = before.replace('beginAppearanceTransition', 'changedUpstreamTransition');
  await writeFile(file, drift);
  assert.notEqual(run().status, 0);
  assert.equal(await readFile(file, 'utf8'), drift);
  await writeFile(manifest, JSON.stringify({ version: '57.0.6' }));
  await writeFile(file, before);
  assert.notEqual(run().status, 0);
  assert.equal(await readFile(file, 'utf8'), before);
});
