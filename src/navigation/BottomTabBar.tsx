import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Animated, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {useTheme} from '../context/ThemeContext';
import {usePermissions} from '../context/PermissionsContext';
import {ColorScheme} from '../theme/colors';
import SettingsIcon from '../components/icons/SettingsIcon';
import BookIcon from '../components/icons/BookIcon';

// Glyph icons reuse the geometric style already used across the app
// (see DashboardScreen quick-action icons).
const ICONS: Record<string, string> = {
  Home: '⌂',
  Groups: '◉◉',
  SelfBets: '◆',
  DistractionSettings: '⚙',
  CryptoGuide: '⬡',
};

const LABELS: Record<string, string> = {
  Home: 'Home',
  Groups: 'Groups',
  SelfBets: 'Bets',
  DistractionSettings: 'Setting',
  CryptoGuide: 'Guide',
};

const BottomTabBar = ({state, navigation}: BottomTabBarProps) => {
  const {colors} = useTheme();
  const {needsAttention} = usePermissions();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const styles = createStyles(colors);

  const tabWidth = width / state.routes.length;
  const translateX = React.useRef(new Animated.Value(state.index * tabWidth)).current;

  React.useEffect(() => {
    Animated.spring(translateX, {
      toValue: state.index * tabWidth,
      useNativeDriver: true,
      bounciness: 4,
      speed: 12,
    }).start();
  }, [state.index, tabWidth]);

  // Gentle glow/unglow pulse on the Settings-tab attention dot.
  const glowAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!needsAttention) {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {toValue: 1, duration: 900, useNativeDriver: true}),
        Animated.timing(glowAnim, {toValue: 0, duration: 900, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [needsAttention, glowAnim]);

  return (
    <View style={[styles.bar, {paddingBottom: Math.max(insets.bottom, 10)}]}>
      <Animated.View
        style={[
          styles.slidingHighlight,
          {
            width: tabWidth,
            transform: [{translateX}],
          },
        ]}>
        <View style={styles.slidingHighlightInner} />
      </Animated.View>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const color = focused ? colors.primary : colors.textMuted;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? {selected: true} : {}}
            accessibilityLabel={LABELS[route.name] ?? route.name}
            onPress={onPress}
            style={styles.item}
            activeOpacity={0.7}>
            <View style={styles.iconContainer}>
              <View style={styles.iconWrap}>
                {route.name === 'DistractionSettings' ? (
                  <SettingsIcon size={16} color={color} />
                ) : route.name === 'CryptoGuide' ? (
                  <BookIcon size={16} color={color} />
                ) : (
                  <Text style={[styles.icon, {color}]}>
                    {ICONS[route.name] ?? '•'}
                  </Text>
                )}
              </View>
              {route.name === 'DistractionSettings' && needsAttention && (
                <View style={styles.attentionDotWrap} pointerEvents="none">
                  <Animated.View
                    style={[
                      styles.attentionGlow,
                      {
                        opacity: glowAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.1, 0.35],
                        }),
                        transform: [
                          {
                            scale: glowAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 1.55],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                  <View style={styles.attentionDot} />
                </View>
              )}
            </View>
            <Text style={[styles.label, {color}]} numberOfLines={1}>
              {LABELS[route.name] ?? route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 8,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: -2},
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 12,
    },
    item: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconContainer: {
      position: 'relative',
      marginBottom: 3,
    },
    iconWrap: {
      minWidth: 46,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 15,
      overflow: 'hidden',
    },
    attentionDotWrap: {
      position: 'absolute',
      top: 2,
      right: 13,
      width: 9,
      height: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    attentionDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.primary,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    attentionGlow: {
      position: 'absolute',
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.primary,
    },
    iconWrapActive: {},
    slidingHighlight: {
      position: 'absolute',
      top: 8,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    slidingHighlightInner: {
      width: 46,
      height: 30,
      borderRadius: 15,
      backgroundColor: 'rgba(255, 83, 0, 0.12)',
    },
    icon: {
      fontSize: 16,
      fontWeight: '700',
    },
    label: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
  });

export default BottomTabBar;
