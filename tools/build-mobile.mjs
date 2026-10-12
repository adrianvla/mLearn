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
run(process.execPath, ['tools/prepare-plugins.mjs']);
run('cargo', ['build', '-p', 'mlearn-ffi', '--features', 'mobile-bundle']);
const library = path.join(root, 'target/debug', process.platform === 'darwin' ? 'libmlearn_ffi.dylib' : process.platform === 'win32' ? 'mlearn_ffi.dll' : 'libmlearn_ffi.so');
const moduleRoot = path.join(root, 'apps/client/modules/mlearn-native');
const generated = path.join(moduleRoot, platform, 'generated');
await mkdir(generated, { recursive: true });
run('cargo', ['run', '-p', 'mlearn-bindgen', '--', 'generate', '--library', library, '--language', platform === 'ios' ? 'swift' : 'kotlin', '--config', 'crates/ffi/uniffi.toml', '--out-dir', generated, '--no-format']);
if (platform === 'ios') {
  const simulator = process.arch === 'arm64' ? 'aarch64-apple-ios-sim' : 'x86_64-apple-ios';
  const targets = ['aarch64-apple-ios', simulator];
  run('rustup', ['target', 'add', ...targets]);
  for (const target of targets) run('cargo', ['build', '-p', 'mlearn-ffi', '--release', '--target', target]);
  const headers = path.join(generated, 'headers');
  await mkdir(headers, { recursive: true });
  for (const file of await readdir(generated)) {
    if (file.endsWith('.h')) await copyFile(path.join(generated, file), path.join(headers, file));
    if (file.endsWith('.modulemap')) await copyFile(path.join(generated, file), path.join(headers, 'module.modulemap'));
  }
  const framework = path.join(generated, 'MlearnRust.xcframework');
  await rm(framework, { recursive: true, force: true });
  run('xcodebuild', ['-create-xcframework', ...targets.flatMap((target) => ['-library', path.join(root, 'target', target, 'release/libmlearn_ffi.a'), '-headers', headers]), '-output', framework]);
} else {
  const probe = spawnSync('cargo', ['ndk', '--version'], { cwd: root, stdio: 'ignore' });
  if (probe.status !== 0) throw new Error('Install the Android NDK and cargo-ndk first: cargo install cargo-ndk --locked');
  run('rustup', ['target', 'add', 'aarch64-linux-android', 'x86_64-linux-android']);
  const output = path.join(moduleRoot, 'android/src/main/jniLibs');
  run('cargo', ['ndk', '-t', 'arm64-v8a', '-t', 'x86_64', '--platform', '26', '-o', output, 'build', '-p', 'mlearn-ffi', '--release'], {
    CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS: '-C link-arg=-Wl,-z,max-page-size=16384',
    CARGO_TARGET_X86_64_LINUX_ANDROID_RUSTFLAGS: '-C link-arg=-Wl,-z,max-page-size=16384',
  });
}
console.log(`Native ${platform} module prepared. Run the Expo development build, not Expo Go.`);
