// Jest environment setup. Registers the native-module mocks that component tests
// need so importing the app tree doesn't throw on missing TurboModules.
import 'react-native-gesture-handler/jestSetup';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
