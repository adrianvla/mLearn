import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchVideoView } from '../patch-expo-video.mjs';

const configPath = new URL('../../apps/client/app.config.js', import.meta.url);
function applyAppConfig(properties, projectBuildGradle) {
  const config = { name: 'mLearn v3 Dev', modResults: properties };
  // Expo supplies this lifecycle hook during prebuild. Run the real config's
  // transformation while isolating the framework loader from this Node test.
  const context = createContext({
    module: { exports: {} },
    require(specifier) {
      if (specifier === '@expo/config-plugins/build/utils/generateCode')
        return createRequire(import.meta.url)(specifier);
      assert.equal(specifier, 'expo/config-plugins');
      return {
        withGradleProperties: (value, action) => action(value),
        withProjectBuildGradle(value, action) {
          if (projectBuildGradle) value.projectBuildGradle = action({ modResults: projectBuildGradle }).modResults;
          return value;
        },
      };
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

test('Android toolchain generation preserves the project and is stable across repeated prebuilds', () => {
  const original = 'buildscript { repositories { google() } }\napply plugin: "expo-root-project"\napply plugin: "com.facebook.react.rootproject"\n';
  const first = applyAppConfig([], { language: 'groovy', contents: original }).projectBuildGradle;
  assert.ok(first, 'The consuming project must receive the native toolchain mod');
  assert.ok(first.contents.includes(original.split('\n')[0]));
  assert.ok(first.contents.endsWith(original.split('\n').slice(1).join('\n')));
  const second = applyAppConfig([], { ...first }).projectBuildGradle;
  assert.equal(second.contents, first.contents);
  assert.throws(() => applyAppConfig([], { language: 'kotlin', contents: original }));
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

// The guarded UIKit lifecycle repair must reach the consuming native app.
// Remove both when the upstream binary passes the native input flow.
test('iOS builds the video module from source rather than the precompiled Expo binary', async () => {
  const require = createRequire(import.meta.url);
  const { createAutolinkingOptionsLoader } = require('expo-modules-autolinking/build/commands/autolinkingOptions');
  const loader = createAutolinkingOptionsLoader({
    projectRoot: fileURLToPath(new URL('../../apps/client', import.meta.url)),
  });
  assert.deepEqual((await loader.getPlatformOptions('apple')).buildFromSource, ['expo-video']);
  assert.equal((await loader.getPlatformOptions('android')).buildFromSource, undefined);
});

test('the pinned video dependency repair is reproducible, idempotent and rejects an unreviewed upgrade', () => {
  const dependency = new URL('../../node_modules/expo-video/', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', dependency), 'utf8'));
  const shipped = readFileSync(new URL('ios/VideoView.swift', dependency), 'utf8');
  // Reconstruct the upstream input from the consumed, native-tested copy.
  const upstream = shipped.replace(
    '    playerViewController.endAppearanceTransition()\n    #endif\n  }\n\n  public override func safeAreaInsetsDidChange()',
    '    #endif\n  }\n\n  public override func safeAreaInsetsDidChange()',
  );
  assert.notEqual(upstream, shipped);
  assert.equal(patchVideoView(version, upstream), shipped);
  assert.equal(patchVideoView(version, shipped), shipped);
  assert.throws(() => patchVideoView('unreviewed', shipped), Error);
  assert.throws(() => patchVideoView(version, 'unknown-source'), Error);
});
