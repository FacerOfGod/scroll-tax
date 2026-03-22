import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

type LogoSize = 'sm' | 'md' | 'lg';
type LogoDirection = 'vertical' | 'horizontal';

interface LogoProps {
  size?: LogoSize;
  showWordmark?: boolean;
  showTagline?: boolean;
  direction?: LogoDirection;
}

const CONFIGS = {
  sm: {
    ring: 56,  ringRadius: 17,
    icon: 44,  iconRadius: 13,
    barH: 3,   barGap: 4,
    wordmarkSize: 20, taglineSize: 12, wordmarkMt: 10, hGap: 10,
  },
  md: {
    ring: 72,  ringRadius: 22,
    icon: 58,  iconRadius: 17,
    barH: 4,   barGap: 5,
    wordmarkSize: 30, taglineSize: 14, wordmarkMt: 13, hGap: 12,
  },
  lg: {
    ring: 88,  ringRadius: 26,
    icon: 72,  iconRadius: 21,
    barH: 5,   barGap: 7,
    wordmarkSize: 38, taglineSize: 15, wordmarkMt: 16, hGap: 14,
  },
};

const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showWordmark = false,
  showTagline = false,
  direction = 'vertical',
}) => {
  const c = CONFIGS[size];
  const isHorizontal = direction === 'horizontal';

  const mark = (
    <View style={[styles.ring, { width: c.ring, height: c.ring, borderRadius: c.ringRadius }]}>
      <View style={[styles.icon, { width: c.icon, height: c.icon, borderRadius: c.iconRadius }]}>
        {/* Subtle top-left highlight for depth */}
        <View
          style={[
            styles.highlight,
            { borderRadius: c.iconRadius, width: c.icon * 0.7, height: c.icon * 0.45 },
          ]}
        />
        {/* S-scroll bars */}
        <View style={styles.bars}>
          {/* Top bar — right-aligned */}
          <View
            style={[
              styles.bar,
              { height: c.barH, borderRadius: c.barH / 2, alignSelf: 'flex-end' },
            ]}
          />
          <View style={{ height: c.barGap }} />
          {/* Middle bar — full width, slightly thicker */}
          <View
            style={[
              styles.barFull,
              { height: c.barH + 1, borderRadius: (c.barH + 1) / 2 },
            ]}
          />
          <View style={{ height: c.barGap }} />
          {/* Bottom bar — left-aligned */}
          <View
            style={[
              styles.bar,
              { height: c.barH, borderRadius: c.barH / 2, alignSelf: 'flex-start', opacity: 0.75 },
            ]}
          />
        </View>
      </View>
    </View>
  );

  const wordmark = showWordmark ? (
    <Text
      style={[
        styles.wordmark,
        { fontSize: c.wordmarkSize },
        !isHorizontal && { marginTop: c.wordmarkMt },
        isHorizontal && { marginLeft: c.hGap },
      ]}
    >
      <Text style={styles.wordmarkScroll}>Scroll</Text>
      <Text style={styles.wordmarkTax}>Tax</Text>
    </Text>
  ) : null;

  const tagline =
    showTagline && !isHorizontal ? (
      <Text style={[styles.tagline, { fontSize: c.taglineSize }]}>
        Focus is Financial Accountability.
      </Text>
    ) : null;

  if (isHorizontal) {
    return (
      <View style={styles.wrapperRow}>
        {mark}
        {wordmark}
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {mark}
      {wordmark}
      {tagline}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  wrapperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ring: {
    borderWidth: 1.5,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  bars: {
    width: '68%',
  },
  bar: {
    width: '64%',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  barFull: {
    width: '100%',
    backgroundColor: '#FFFFFF',
  },
  wordmark: {
    fontWeight: '900',
    letterSpacing: -1,
  },
  wordmarkScroll: {
    color: Colors.text,
  },
  wordmarkTax: {
    color: Colors.primary,
  },
  tagline: {
    color: Colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
});

export default Logo;
