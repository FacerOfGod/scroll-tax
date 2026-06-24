import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

/**
 * A single soft orange "glow". Rendered with an SVG radial gradient that fades
 * to transparent-orange at the edges — this reads as a blurred shade without
 * needing a native blur library.
 *
 * Notes for the light/dark difference: every stop uses the SAME orange hue and
 * the final stop is transparent ORANGE (not `transparent`, which is black with
 * 0 alpha and produces a grey fringe on light backgrounds). It's painted on a
 * <Rect> rather than a <Circle> so there's no antialiased circle edge to
 * composite into a grey ring — the gradient itself has already faded to fully
 * transparent before the rect's corners.
 */
const Glow = React.memo(
  ({ size, opacity, gradientId }: { size: number; opacity: number; gradientId: string }) => (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FF5300" stopOpacity={opacity} />
          <Stop offset="0.5" stopColor="#FF5300" stopOpacity={opacity * 0.35} />
          <Stop offset="1" stopColor="#FF5300" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} fill={`url(#${gradientId})`} />
    </Svg>
  ),
);

interface BlobSpec {
  id: string;
  size: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  duration: number;
  opacity: number;
}

/** One drifting, gently pulsing glow. Transforms run on the native driver. */
const Blob = React.memo(({ id, size, from, to, duration, opacity }: BlobSpec) => {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [from.x, to.x] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [from.y, to.y] });
  const scale = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.18, 1] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        transform: [{ translateX }, { translateY }, { scale }],
      }}
    >
      <Glow size={size} opacity={opacity} gradientId={`glow-${id}`} />
    </Animated.View>
  );
});

/**
 * Full-screen background: a base color fill with several blurred orange glows
 * drifting and pulsing behind everything. Visible in both dark and light mode
 * (glows are softer in light mode so they don't overpower content).
 *
 * Mounted once, app-wide, behind the navigator. Non-interactive.
 */
const AnimatedBackground = () => {
  const { colors, isDark } = useTheme();
  const { width, height } = useWindowDimensions();

  const base = isDark ? 0.55 : 0.32;

  const blobs = useMemo<BlobSpec[]>(
    () => [
      {
        id: 'top-glow',
        size: width * 0.85,
        from: { x: -width * 0.1, y: -width * 0.4 },
        to: { x: width * 0.25, y: -width * 0.45 },
        duration: 18000,
        opacity: base,
      },
    ],
    [width, height, base],
  );

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.background }]}
    >
      {blobs.map(b => (
        <Blob key={b.id} {...b} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
});

export default AnimatedBackground;
