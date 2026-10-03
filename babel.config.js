module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo adds the react-native-worklets plugin automatically (Reanimated 4).
    presets: ['babel-preset-expo'],
  };
};
