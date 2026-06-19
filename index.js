/**
 * @format
 *
 * Polyfills must be imported before anything else.
 * XRPL requires crypto, buffer, and URL globals.
 */
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { initCrashReporting } from './src/services/crashReporting';

global.Buffer = global.Buffer || Buffer;

// Initialize crash reporting as early as possible so startup errors are captured.
// No-op until SENTRY_DSN is set (see crashReporting.ts).
initCrashReporting();

AppRegistry.registerComponent(appName, () => App);
