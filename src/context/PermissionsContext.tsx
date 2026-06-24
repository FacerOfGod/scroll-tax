import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { AppState, Platform, PermissionsAndroid } from 'react-native';
import { ScrollDetectionService } from '../services/ScrollDetectionService';

type PermissionsState = {
  /** Whether Usage Access is granted (needed to detect banned apps). */
  usageAccessGranted: boolean;
  /** Whether POST_NOTIFICATIONS is granted (penalty alerts). */
  notifGranted: boolean;
  /** True when any required permission is missing — drives the Settings-tab dot. */
  needsAttention: boolean;
  /** Re-check both permissions; returns the fresh values. */
  refresh: () => Promise<{ usageAccessGranted: boolean; notifGranted: boolean }>;
  /** Prompt for the notification permission (Android 13+). */
  requestNotifications: () => Promise<boolean>;
};

const PermissionsContext = createContext<PermissionsState | undefined>(undefined);

const checkNotifGranted = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || Platform.Version < 33) return true;
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch {
    return true;
  }
};

export const PermissionsProvider = ({ children }: { children: React.ReactNode }) => {
  // Optimistic defaults (true) so the Settings-tab dot doesn't flash before the
  // first async check resolves.
  const [usageAccessGranted, setUsageAccessGranted] = useState(true);
  const [notifGranted, setNotifGranted] = useState(true);

  const refresh = useCallback(async () => {
    const [usage, notif] = await Promise.all([
      ScrollDetectionService.hasUsageAccess(),
      checkNotifGranted(),
    ]);
    setUsageAccessGranted(usage);
    setNotifGranted(notif);
    return { usageAccessGranted: usage, notifGranted: notif };
  }, []);

  const requestNotifications = useCallback(async () => {
    if (Platform.OS !== 'android' || Platform.Version < 33) return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    setNotifGranted(granted);
    return granted;
  }, []);

  // Prompt for notifications once on mount, then keep both permissions current
  // whenever the app returns to the foreground (the user may have toggled a
  // permission in Android Settings while away).
  useEffect(() => {
    requestNotifications();
    ScrollDetectionService.hasUsageAccess().then(setUsageAccessGranted);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh, requestNotifications]);

  const needsAttention = !usageAccessGranted || !notifGranted;

  return (
    <PermissionsContext.Provider
      value={{
        usageAccessGranted,
        notifGranted,
        needsAttention,
        refresh,
        requestNotifications,
      }}
    >
      {children}
    </PermissionsContext.Provider>
  );
};

export const usePermissions = (): PermissionsState => {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error('usePermissions must be used within a PermissionsProvider');
  }
  return ctx;
};
