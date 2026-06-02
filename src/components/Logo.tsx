import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ColorScheme } from '../theme/colors';
import { useTheme } from '../context/ThemeContext';

type LogoSize = 'sm' | 'md' | 'lg';
type LogoDirection = 'vertical' | 'horizontal';

interface LogoProps {
  size?: LogoSize;
  showWordmark?: boolean;
  showTagline?: boolean;
  direction?: LogoDirection;
}

const CONFIGS = {
  sm: { wordmarkSize: 20, taglineSize: 12, wordmarkMt: 10, hGap: 10 },
  md: { wordmarkSize: 30, taglineSize: 14, wordmarkMt: 13, hGap: 12 },
  lg: { wordmarkSize: 38, taglineSize: 15, wordmarkMt: 16, hGap: 14 },
};

const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showWordmark = false,
  showTagline = false,
  direction = 'vertical',
}) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const c = CONFIGS[size];
  const isHorizontal = direction === 'horizontal';


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
      <Text style={styles.wordmarkDot}>.</Text>
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
        {wordmark}
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {wordmark}
      {tagline}
    </View>
  );
};

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  wrapperRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    fontWeight: '900',
    letterSpacing: -1,
  },
  wordmarkScroll: {
    color: colors.text,
  },
  wordmarkTax: {
    color: colors.primary,
  },
  wordmarkDot: {
    color: colors.primary,
    opacity: 0.5,
  },
  tagline: {
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
});

export default Logo;
