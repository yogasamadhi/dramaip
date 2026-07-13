module.exports = function (api) {
  api.cache(true)
  return {
    // NativeWind exports a Babel preset (which supplies its own plugins), not
    // a plugin. Treating it as a plugin breaks Expo native bundle generation.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['react-native-reanimated/plugin'],
  }
}
