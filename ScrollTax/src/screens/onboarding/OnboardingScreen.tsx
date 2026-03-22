import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Animated,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';

const FEATURES = [
  { icon: '💰', title: 'Stake XRP', desc: 'Lock funds into a group to commit to your goals.' },
  { icon: '📵', title: 'Stay Focused', desc: 'Our tracker watches for excessive scrolling on distraction apps.' },
  { icon: '⚡', title: 'Pay the Tax', desc: 'Scroll too long? XRP is automatically sent to the group pool.' },
  { icon: '🏆', title: 'Win Together', desc: 'The most focused member earns back the most.' },
];

const OnboardingScreen = ({ navigation }: any) => {
  const logoAnim     = useEntranceAnimation(0);
  const feature0Anim = useEntranceAnimation(120);
  const feature1Anim = useEntranceAnimation(200);
  const feature2Anim = useEntranceAnimation(280);
  const feature3Anim = useEntranceAnimation(360);
  const badgeAnim    = useEntranceAnimation(440);
  const ctaAnim      = useEntranceAnimation(490);

  const featureAnims = [feature0Anim, feature1Anim, feature2Anim, feature3Anim];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.content}>
        {/* Logo */}
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
          <Text style={styles.logoText}>ScrollTax</Text>
          <Text style={styles.tagline}>Focus is Financial Accountability.</Text>
        </Animated.View>

        {/* Feature Rows */}
        <View style={styles.features}>
          {FEATURES.map((f, i) => (
            <Animated.View
              key={i}
              style={{
                opacity: featureAnims[i].opacity,
                transform: [{ translateY: featureAnims[i].translateY }],
              }}
            >
              <View style={styles.featureRow}>
                <View style={styles.featureIconBox}>
                  <Text style={styles.featureIcon}>{f.icon}</Text>
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.desc}</Text>
                </View>
              </View>
            </Animated.View>
          ))}
        </View>

        {/* Network Badge */}
        <Animated.View
          style={[styles.networkBadge, { opacity: badgeAnim.opacity }]}
        >
          <View style={styles.networkDot} />
          <Text style={styles.networkText}>Running on XRPL Testnet</Text>
        </Animated.View>

        {/* CTA */}
        <Animated.View
          style={[
            styles.cta,
            { opacity: ctaAnim.opacity, transform: [{ translateY: ctaAnim.translateY }] },
          ]}
        >
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Signup')}
            activeOpacity={0.82}
          >
            <Text style={styles.primaryButtonText}>Create Account</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.6}
          >
            <Text style={styles.secondaryButtonText}>I already have an account</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    justifyContent: 'space-between',
  },
  logoSection: {
    alignItems: 'center',
    paddingTop: 20,
  },
  logoRing: {
    width: 76,
    height: 76,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoMark: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  logoMarkText: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 15,
    color: Colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  features: {
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  featureIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureIcon: {
    fontSize: 22,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  featureDesc: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  networkDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.secondary,
  },
  networkText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  cta: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    height: 58,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
  },
});

export default OnboardingScreen;
