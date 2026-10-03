const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow .tflite model files to be bundled as assets
config.resolver.assetExts.push('tflite', 'bin');

module.exports = config;
