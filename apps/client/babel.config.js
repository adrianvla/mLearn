const path = require('node:path');
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['react-native-unistyles/plugin', {
      root: path.resolve(__dirname, '../../packages/ui/src'),
      autoProcessPaths: ['packages/ui/src', 'apps/client/src'],
      autoProcessImports: ['@mlearn/theme', '@mlearn/theme/runtime'],
    }]],
  };
};
