import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { captureException } from '../services/crashReporting';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render/lifecycle errors anywhere in the tree
 * so an uncaught exception shows a recoverable fallback instead of a blank crash.
 *
 * It sits outside every provider (including ThemeContext), so it cannot use the
 * theme hook and pins the static dark palette. Errors are logged here and
 * forwarded to the crash reporter (no-op until SENTRY_DSN is configured).
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled error caught by ErrorBoundary:', error, info.componentStack);
    captureException(error, { componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            The app hit an unexpected error. You can try again — if it keeps
            happening, please restart the app.
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.reset} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  title: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  button: {
    marginTop: 10,
    backgroundColor: Colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ErrorBoundary;
