import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
  AppState,
  Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { usePermissions } from '../../context/PermissionsContext';
import { ScrollDetectionService } from '../../services/ScrollDetectionService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BORDER_KEY = 'borderModeEnabled';

export default function DistractionSettingsScreen({ navigation }: any) {
  const { isDark, toggleTheme, colors } = useTheme();
  const { usageAccessGranted, notifGranted, refresh, requestNotifications } = usePermissions();
  const [hasOverlay, setHasOverlay] = useState<boolean | null>(null);
  const [borderEnabled, setBorderEnabled] = useState(false);

  const checkPerms = useCallback(() => {
    refresh();
    ScrollDetectionService.hasOverlayPermission().then(setHasOverlay);
  }, [refresh]);

  useFocusEffect(useCallback(() => { checkPerms(); }, [checkPerms]));

  // Re-check when the user returns from Android Settings
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') checkPerms();
    });
    return () => sub.remove();
  }, [checkPerms]);

  // Load the saved border-mode preference and sync it to the native service.
  // The overlay can only be active while the "display over other apps" permission
  // is granted, so a stored-on preference is gated on a fresh permission check —
  // if it was revoked since, we clear the preference and keep the switch off.
  useEffect(() => {
    AsyncStorage.getItem(BORDER_KEY).then(async v => {
      const saved = v === '1';
      const granted = saved ? await ScrollDetectionService.hasOverlayPermission() : false;
      const enabled = saved && granted;
      setBorderEnabled(enabled);
      if (saved && !granted) await AsyncStorage.setItem(BORDER_KEY, '0');
      ScrollDetectionService.updateSettings({ borderEnabled: enabled });
    });
  }, []);

  const toggleBorder = useCallback(async (value: boolean) => {
    // Turning off is always allowed.
    if (!value) {
      setBorderEnabled(false);
      await AsyncStorage.setItem(BORDER_KEY, '0');
      ScrollDetectionService.updateSettings({ borderEnabled: false });
      return;
    }

    // Turning on requires the "display over other apps" permission. If it isn't
    // granted, leave the switch off and send the user to grant it first.
    const granted = await ScrollDetectionService.hasOverlayPermission();
    setHasOverlay(granted);
    if (!granted) {
      ScrollDetectionService.openOverlaySettings();
      return;
    }

    setBorderEnabled(true);
    await AsyncStorage.setItem(BORDER_KEY, '1');
    ScrollDetectionService.updateSettings({ borderEnabled: true });
  }, []);

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ width: 56, height: 24 }} />
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.title}>Tracking Settings</Text>
        </View>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Appearance section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <Text style={styles.helperText}>Switch between light and dark mode.</Text>

          <View style={styles.permissionRow}>
            <View style={styles.permissionInfo}>
              <Text style={styles.permissionName}>Dark Mode</Text>
              <Text style={styles.permissionDesc}>Toggle light / dark theme</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
            />
          </View>
        </View>

        {/* Required Permissions section */}
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
            <View style={[styles.badge, usageAccessGranted ? styles.badgeOn : styles.badgeOff]}>
              <Text style={[styles.badgeText, usageAccessGranted ? styles.badgeTextOn : styles.badgeTextOff]}>
                {usageAccessGranted ? '✓ On' : '✗ Off'}
              </Text>
            </View>
          </View>
          {!usageAccessGranted && (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={() => ScrollDetectionService.openUsageAccessSettings()}
              activeOpacity={0.8}
            >
              <Text style={styles.permissionButtonText}>Enable Usage Access {'>'}</Text>
            </TouchableOpacity>
          )}

          <View style={styles.permissionRow}>
            <View style={styles.permissionInfo}>
              <Text style={styles.permissionName}>Notifications</Text>
              <Text style={styles.permissionDesc}>Penalty alerts and warnings</Text>
            </View>
            <View style={[styles.badge, notifGranted ? styles.badgeOn : styles.badgeOff]}>
              <Text style={[styles.badgeText, notifGranted ? styles.badgeTextOn : styles.badgeTextOff]}>
                {notifGranted ? '✓ On' : '✗ Off'}
              </Text>
            </View>
          </View>
          {!notifGranted && (
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={async () => {
                // First tap shows the system dialog. Once Android has recorded a
                // denial it stops showing the prompt, so fall back to the app's
                // notification settings where the user can flip it on manually.
                const granted = await requestNotifications();
                if (!granted) Linking.openSettings();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.permissionButtonText}>Enable Notifications {'>'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Banned-app warning style */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Banned-app warning</Text>
          <Text style={styles.helperText}>
            Show a red border that intensifies the longer you stay in a banned app —
            an ambient alternative to the warning notification.
          </Text>

          <View style={styles.permissionRow}>
            <View style={styles.permissionInfo}>
              <Text style={styles.permissionName}>Red border overlay</Text>
              <Text style={styles.permissionDesc}>Replaces the warning notification</Text>
            </View>
            <Switch
              value={borderEnabled}
              onValueChange={toggleBorder}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
            />
          </View>

          {hasOverlay === false && (
            <>
              <TouchableOpacity
                style={styles.permissionButton}
                onPress={() => ScrollDetectionService.openOverlaySettings()}
                activeOpacity={0.8}
              >
                <Text style={styles.permissionButtonText}>Allow "Display over other apps" {'>'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  back: {
    color: colors.textMuted,
    fontSize: 16,
  },
  titleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    paddingVertical: 20,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  helperText: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 20,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  permissionInfo: {
    flex: 1,
    gap: 2,
  },
  permissionName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  permissionDesc: {
    fontSize: 12,
    color: colors.textMuted,
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
    color: colors.secondary,
  },
  badgeTextOff: {
    color: colors.error,
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
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
