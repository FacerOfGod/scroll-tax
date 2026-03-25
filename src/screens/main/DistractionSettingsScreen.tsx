import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../theme/colors';
import { ScrollDetectionService } from '../../services/ScrollDetectionService';

export default function DistractionSettingsScreen({ navigation }: any) {
  const [hasUsage, setHasUsage] = useState<boolean | null>(null);

  const checkUsage = useCallback(() => {
    ScrollDetectionService.hasUsageAccess().then(setHasUsage);
  }, []);

  useFocusEffect(useCallback(() => { checkUsage(); }, [checkUsage]));

  // Re-check when the user returns from Android Settings
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkUsage();
    });
    return () => sub.remove();
  }, [checkUsage]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.back}>{'<'}</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.title}>Tracking Settings</Text>
        </View>
        <View style={{ width: 56 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Required Permissions</Text>
          <Text style={styles.helperText}>
            Usage Access must be granted for ScrollTax to detect banned apps.
          </Text>

          <View style={styles.permissionRow}>
            <View style={styles.permissionInfo}>
              <Text style={styles.permissionName}>Usage Access</Text>
              <Text style={styles.permissionDesc}>Tracks time spent in each app</Text>
            </View>
            {hasUsage === null ? null : (
              <View style={[styles.badge, hasUsage ? styles.badgeOn : styles.badgeOff]}>
                <Text style={[styles.badgeText, hasUsage ? styles.badgeTextOn : styles.badgeTextOff]}>
                  {hasUsage ? '✓ On' : '✗ Off'}
                </Text>
              </View>
            )}
          </View>
          {!hasUsage && (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={() => ScrollDetectionService.openUsageAccessSettings()}
              activeOpacity={0.8}
            >
              <Text style={styles.permissionButtonText}>Enable Usage Access ></Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  back: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  titleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  content: {
    padding: 20,
  },
  section: {
    paddingVertical: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  helperText: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  permissionInfo: {
    flex: 1,
    gap: 2,
  },
  permissionName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  permissionDesc: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginLeft: 10,
  },
  badgeOn: {
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderColor: 'rgba(48, 209, 88, 0.4)',
  },
  badgeOff: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    borderColor: 'rgba(255, 69, 58, 0.35)',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  badgeTextOn: {
    color: Colors.secondary,
  },
  badgeTextOff: {
    color: Colors.error,
  },
  permissionButton: {
    backgroundColor: 'rgba(255, 83, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.3)',
    borderRadius: 9999,
    padding: 13,
    alignItems: 'center',
  },
  permissionButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
