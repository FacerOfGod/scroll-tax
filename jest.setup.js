// Jest environment setup. Registers the native-module mocks that component tests
// need so importing the app tree doesn't throw on missing TurboModules.
import 'react-native-gesture-handler/jestSetup';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Sentry pulls in a native module; mock it so importing crash-reporting (and any
// screen/component that does) doesn't require the real SDK under Jest. `virtual`
// lets the suite run before `npm install @sentry/react-native` has been run.
jest.mock(
  '@sentry/react-native',
  () => ({ init: jest.fn(), captureException: jest.fn() }),
  { virtual: true },
);

// Side-effect polyfill that reaches for a native module — no-op it under Jest.
jest.mock('react-native-get-random-values', () => ({}));
