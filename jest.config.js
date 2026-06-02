module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Whitelist RN-ecosystem packages that ship untransformed ESM so Babel
  // transpiles them instead of Jest choking on `export`/`import` syntax.
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-navigation|react-native-.*|@ledgerhq)/)',
  ],
};
