const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow .tflite model files to be bundled as assets
config.resolver.assetExts.push('tflite', 'bin');

// assets/model/ is gitignored (trained locally, see TRAINING.md). When the
// model files are absent, resolve them to an empty module so the app still
// bundles — lib/tflite.ts then reports the on-device tier as unavailable.
const MODEL_DIR = path.join(__dirname, 'assets', 'model');
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/assets\/model\/(plant_disease\.tflite|labels\.json)$/.test(moduleName)) {
    const file = path.join(MODEL_DIR, path.basename(moduleName));
    if (!fs.existsSync(file)) return { type: 'empty' };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
