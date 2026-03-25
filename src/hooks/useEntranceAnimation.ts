import { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';

export function useEntranceAnimation(delay = 0) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      delay,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, []);

  return {
    opacity: progress,
    translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }),
  };
}
