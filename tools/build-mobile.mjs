import { spawnSync } from 'node:child_process';
import { mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (!['ios', 'android'].includes(platform)) throw new Error('Usage: node tools/build-mobile.mjs ios|android');
if (platform === 'ios' && process.platform !== 'darwin') throw new Error('iOS native builds require macOS and Xcode.');
function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} ${args.join(' ')} failed`);
}
function output(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr || `${command} failed`);
  return result.stdout.trim();
}
run(process.execPath, ['tools/prepare-plugins.mjs']);
run(process.execPath, ['tools/prepare-documents.mjs']);
run('cargo', ['build', '--locked', '-p', 'mlearn-ffi', '--features', 'mobile-bundle']);
const library = path.join(root, 'target/debug', process.platform === 'darwin' ? 'libmlearn_ffi.dylib' : process.platform === 'win32' ? 'mlearn_ffi.dll' : 'libmlearn_ffi.so');
const moduleRoot = path.join(root, 'apps/client/modules/mlearn-native');
const generated = path.join(moduleRoot, platform, 'generated');
await mkdir(generated, { recursive: true });
run('cargo', ['run', '--locked', '-p', 'mlearn-bindgen', '--', 'generate', '--library', library, '--language', platform === 'ios' ? 'swift' : 'kotlin', '--config', 'crates/ffi/uniffi.toml', '--out-dir', generated, '--no-format']);
if (platform === 'ios') {
  const headers = path.join(generated, 'headers');
  const frameworkHeaders = path.join(generated, 'xcframework-headers');
  for (const directory of [headers, frameworkHeaders]) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
  }
  // CocoaPods exposes this module map explicitly. Do not also embed it in
  // the XCFramework, or Clang sees two definitions of MlearnRustFFI.
  for (const file of await readdir(generated)) {
    if (file.endsWith('.h')) {
      await copyFile(path.join(generated, file), path.join(headers, file));
      await copyFile(path.join(generated, file), path.join(frameworkHeaders, file));
    }
    if (file.endsWith('.modulemap')) await copyFile(path.join(generated, file), path.join(headers, 'module.modulemap'));
  }
  // Fail on missing C-module visibility before spending time building all Pods.
  // Use UniFFI's generated module map unchanged, as the CocoaPods target does.
  const sdk = output('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']);
  for (const arch of ['arm64', 'x86_64']) {
    run('xcrun', ['swiftc', '-typecheck', '-parse-as-library', '-module-name', 'MlearnBindingsCheck',
      '-sdk', sdk, '-target', `${arch}-apple-ios16.4-simulator`, '-I', headers,
      '-Xcc', `-fmodule-map-file=${path.join(headers, 'module.modulemap')}`,
      path.join(generated, 'MlearnRust.swift')]);
  }
  const device = 'aarch64-apple-ios';
  const simulators = ['aarch64-apple-ios-sim', 'x86_64-apple-ios'];
  run('rustup', ['target', 'add', device, ...simulators]);
  for (const target of [device, ...simulators]) {
    run('cargo', ['build', '--locked', '-p', 'mlearn-ffi', '--release', '--target', target]);
  }
  // Simulator architectures share a platform slice, unlike device arm64.
  // CocoaPods requires the same binary basename in every XCFramework slice.
  const simulatorLibrary = path.join(generated, 'simulator', 'libmlearn_ffi.a');
  await mkdir(path.dirname(simulatorLibrary), { recursive: true });
  run('xcrun', ['lipo', '-create', ...simulators.map(target => path.join(root, 'target', target, 'release/libmlearn_ffi.a')), '-output', simulatorLibrary]);
  const framework = path.join(generated, 'MlearnRust.xcframework');
  await rm(framework, { recursive: true, force: true });
  run('xcodebuild', ['-create-xcframework',
    '-library', path.join(root, 'target', device, 'release/libmlearn_ffi.a'), '-headers', frameworkHeaders,
    '-library', simulatorLibrary, '-headers', frameworkHeaders, '-output', framework]);
  // Protect against duplicate Clang module registration in the assembled app.
  const embeddedModuleMaps = output('find', [framework, '-type', 'f', '-name', '*.modulemap']);
  if (embeddedModuleMaps) throw new Error(`Unexpected XCFramework module map(s): ${embeddedModuleMaps}`);
} else {
  const probe = spawnSync('cargo', ['ndk', '--version'], { cwd: root, stdio: 'ignore' });
  if (probe.status !== 0) throw new Error('Install the Android NDK and cargo-ndk first: cargo install cargo-ndk --locked');
  run('rustup', ['target', 'add', 'aarch64-linux-android', 'x86_64-linux-android']);
  const output = path.join(moduleRoot, 'android/src/main/jniLibs');
  run('cargo', ['ndk', '-t', 'arm64-v8a', '-t', 'x86_64', '--platform', '26', '-o', output, 'build', '--locked', '-p', 'mlearn-ffi', '--release'], {
    CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS: '-C link-arg=-Wl,-z,max-page-size=16384',
    CARGO_TARGET_X86_64_LINUX_ANDROID_RUSTFLAGS: '-C link-arg=-Wl,-z,max-page-size=16384',
  });
}
console.log(`Native ${platform} module prepared. Run the Expo development build, not Expo Go.`);
