const { withGradleProperties } = require('expo/config-plugins');

// The Rust bridge ships these two ABIs. Do not produce APKs that advertise
// 32-bit runtimes without the corresponding native library.
module.exports = ({ config }) => withGradleProperties(config, (mod) => {
  mod.modResults = mod.modResults.filter((entry) => entry.key !== 'reactNativeArchitectures');
  mod.modResults.push({
    type: 'property',
    key: 'reactNativeArchitectures',
    value: 'arm64-v8a,x86_64',
  });
  return mod;
});
