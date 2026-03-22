import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../services/AuthContext';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';

const SignupScreen = ({ navigation }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<'idle' | 'wallet' | 'account'>('idle');
  const { signUp } = useAuth();

  const logoAnim   = useEntranceAnimation(0);
  const headerAnim = useEntranceAnimation(120);
  const formAnim   = useEntranceAnimation(220);
  const footerAnim = useEntranceAnimation(380);

  const handleSignup = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak Password', 'Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    setStep('wallet');

    const { error, data } = await signUp(email.trim(), password);

    setIsSubmitting(false);
    setStep('idle');

    if (error) {
      Alert.alert('Signup Failed', error.message || 'Could not create account.');
    } else if (data?.session) {
      // Email confirmation disabled — auto logged in, navigator switches automatically.
    } else {
      Alert.alert(
        'Check Your Email',
        'We sent a confirmation link. Click it to activate your account.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }],
      );
    }
  };

  const getButtonLabel = () => {
    if (step === 'wallet') return 'Generating XRPL Wallet...';
    if (step === 'account') return 'Creating Account...';
    return 'Create Account';
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo mark */}
          <Animated.View
            style={[
              styles.logoSection,
              { opacity: logoAnim.opacity, transform: [{ translateY: logoAnim.translateY }] },
            ]}
          >
            <View style={styles.logoRing}>
              <View style={styles.logoMark}>
                <Text style={styles.logoMarkText}>ST</Text>
              </View>
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.header,
              { opacity: headerAnim.opacity, transform: [{ translateY: headerAnim.translateY }] },
            ]}
          >
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              A new XRPL testnet wallet will be generated for you automatically.
            </Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.form,
              { opacity: formAnim.opacity, transform: [{ translateY: formAnim.translateY }] },
            ]}
          >
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={Colors.textMuted}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
                autoCorrect={false}
                editable={!isSubmitting}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Min. 6 characters"
                placeholderTextColor={Colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSignup}
                editable={!isSubmitting}
              />
            </View>

            {isSubmitting && (
              <View style={styles.progressBox}>
                <ActivityIndicator color={Colors.primary} size="small" />
                <Text style={styles.progressText}>{getButtonLabel()}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={isSubmitting}
              activeOpacity={0.82}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={styles.infoRow}>
              <Text style={styles.infoText}>
                Your wallet seed is stored securely in the device keychain. ScrollTax never uploads it.
              </Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.footer, { opacity: footerAnim.opacity }]}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={isSubmitting}>
              <Text style={styles.footerLink}> Sign in</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoRing: {
    width: 70,
    height: 70,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoMark: {
    width: 58,
    height: 58,
    borderRadius: 17,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 5,
  },
  logoMarkText: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  header: {
    marginBottom: 36,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textMuted,
    marginTop: 8,
    lineHeight: 22,
  },
  form: {
    gap: 16,
    marginBottom: 32,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.surface,
    height: 56,
    borderRadius: 14,
    paddingHorizontal: 16,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.7)',
  },
  progressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  progressText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    height: 58,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  infoRow: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.5)',
  },
  infoText: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    color: Colors.textMuted,
    fontSize: 15,
  },
  footerLink: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});

export default SignupScreen;
