import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configPath = new URL('../../apps/client/app.config.js', import.meta.url);
function applyAppConfig(properties) {
  const config = { name: 'mLearn v3 Dev', modResults: properties };
  // Expo supplies this lifecycle hook during prebuild. Run the real config's
  // transformation while isolating the framework loader from this Node test.
  const context = createContext({
    module: { exports: {} },
    require(specifier) {
      assert.equal(specifier, 'expo/config-plugins');
      return { withGradleProperties: (value, action) => action(value) };
    },
  });
  if (!existsSync(configPath)) return config; // Expo's static app.json path.
  runInContext(readFileSync(configPath, 'utf8'), context, { filename: 'app.config.js' });
  return context.module.exports({ config });
}

test('Android prebuild only advertises ABIs supplied by the Rust bridge', () => {
  const original = [
    { type: 'comment', value: 'Retain unrelated configuration' },
    { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m' },
    { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86,x86_64' },
  ];
  const actual = applyAppConfig(original);
  const properties = JSON.parse(JSON.stringify(actual.modResults));
  assert.deepEqual(properties.filter(item => item.key === 'reactNativeArchitectures'), [
    { type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a,x86_64' },
  ]);
  assert.deepEqual(properties.filter(item => item.key !== 'reactNativeArchitectures'), original.slice(0, 2));
  assert.deepEqual(JSON.parse(JSON.stringify(applyAppConfig(properties).modResults)), properties);
});

test('normal Metro development observes shared theme resources outside workspace packages', () => {
  const require = createRequire(import.meta.url);
  const config = require('../../apps/client/metro.config.js');
  const source = fileURLToPath(new URL('../../resources/themes/quartz.json', import.meta.url));
  assert.ok([config.projectRoot, ...config.watchFolders].some(folder =>
    source.startsWith(`${path.resolve(folder)}${path.sep}`)),
  'A theme edit must invalidate the normal development graph, not require a fresh profile or cache wipe');
  assert.ok(config.resolver.sourceExts.includes(path.extname(source).slice(1)));
});

// The 57.0.5 prebuilt loses AVKit input after enlarged Watch reflow.
// Remove the override when its precompiled artifact passes the native input flow.
test('iOS builds the video module from source rather than the precompiled Expo binary', async () => {
  const require = createRequire(import.meta.url);
  const { createAutolinkingOptionsLoader } = require('expo-modules-autolinking/build/commands/autolinkingOptions');
  const loader = createAutolinkingOptionsLoader({
    projectRoot: fileURLToPath(new URL('../../apps/client', import.meta.url)),
  });
  assert.deepEqual((await loader.getPlatformOptions('apple')).buildFromSource, ['expo-video']);
  assert.equal((await loader.getPlatformOptions('android')).buildFromSource, undefined);
});
