import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

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
