const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
// Expo discovers workspace packages, but not the imported theme documents beside
// them. Without this watch root, edits keep serving the old JSON until restart.
// Keep Expo's monorepo resolution and existing watch roots; no React aliases.
config.watchFolders.push(path.resolve(__dirname, '../../resources'));
module.exports = config;
