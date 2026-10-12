const { getDefaultConfig } = require('expo/metro-config');
// Expo supplies monorepo resolution; do not duplicate React with custom aliases.
module.exports = getDefaultConfig(__dirname);
