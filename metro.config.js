const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro config for React Native + XRPL.
 *
 * Root cause of "stuck at 100% bundling":
 *   @xrplf/isomorphic/ws ships a browser-safe WebSocket wrapper (browser.js)
 *   and a Node.js ws build (index.js). Metro defaults to 'main' which picks
 *   the Node build → tries to bundle native `ws`, `bufferutil`, `utf-8-validate`
 *   → hangs forever.
 *
 * Fix:
 *   1. resolverMainFields: include 'browser' so Metro picks browser.js builds.
 *   2. extraNodeModules: polyfill the remaining Node built-ins xrpl touches.
 *   3. unstable_enablePackageExports: false — avoids Metro hanging on complex
 *      `exports` maps in newer packages.
 */
const config = {
  resolver: {
    resolverMainFields: ['react-native', 'browser', 'main'],
    unstable_enablePackageExports: false,
    extraNodeModules: {
      stream: require.resolve('stream-browserify'),
      buffer: require.resolve('buffer'),
      events: require.resolve('events'),
      url: require.resolve('react-native-url-polyfill'),
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
