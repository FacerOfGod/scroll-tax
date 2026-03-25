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

global.Buffer = global.Buffer || Buffer;

AppRegistry.registerComponent(appName, () => App);
