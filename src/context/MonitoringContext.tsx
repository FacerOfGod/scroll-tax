import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { AppState } from 'react-native';
import { ScrollDetectionService } from '../services/ScrollDetectionService';
import { groupService } from '../services/GroupService';
import { useAuth } from '../services/AuthContext';

/**
 * Owns the lifecycle of the native foreground monitoring service.
 *
 * Why this exists: monitoring used to be started by an effect on the home
 * Dashboard screen, so it only kicked in once that screen regained focus with
 * an active group loaded. A user who created a group landed on GroupDashboard
 * (and could leave the app entirely) without the service ever starting — so no
 * detection happened. This provider wraps the whole authenticated tree and is
 * the single source of truth for start/stop, independent of which screen shows.
 *
 * It reconciles the native service to reality whenever:
 *   - the user changes (sign in / out),
 *   - the app returns to the foreground (group/permission may have changed),
 *   - a screen calls refresh() after creating / joining / leaving a group.
 */

type MonitoringState = {
  /** Re-evaluate active-group + usage-access and start/stop the service. */
  refresh: () => Promise<void>;
};

const MonitoringContext = createContext<MonitoringState>({
  refresh: async () => {},
});

// Testing-friendly penalty threshold (seconds). Matches the beta value the
// Dashboard used so a tester sees a penalty within ~30 s instead of the group's
// 30-minute production trigger. For production, switch to
// group.penalty_trigger_time_minutes * 60.
const TEST_THRESHOLD_SECONDS = 30;

export const MonitoringProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  // Tracks whether we believe the service is running, to avoid spamming
  // startForegroundService on every foreground.
  const monitoringRef = useRef(false);

  const refresh = useCallback(async () => {
    // No authenticated user → nothing to monitor.
    if (!user?.id) {
      ScrollDetectionService.stopMonitoring();
      monitoringRef.current = false;
      return;
    }

    try {
      const [hasAccess, { data }] = await Promise.all([
        ScrollDetectionService.hasUsageAccess(),
        groupService.getActiveGroupForUser(user.id),
      ]);
      const group = (data as any)?.groups ?? null;

      if (group && hasAccess) {
        // Push settings BEFORE starting so the first poll already has the right
        // banned-apps list + threshold (otherwise it briefly uses SharedPrefs
        // defaults). Empty banned_apps is skipped natively, preserving defaults.
        ScrollDetectionService.updateSettings({
          thresholdSeconds: TEST_THRESHOLD_SECONDS,
          bannedApps: group.banned_apps ?? [],
        });
        ScrollDetectionService.startMonitoring();
        monitoringRef.current = true;
      } else {
        // No active group or usage access revoked → ensure the service is off
        // (call unconditionally to also clean up a stale START_STICKY restart).
        ScrollDetectionService.stopMonitoring();
        monitoringRef.current = false;
      }
    } catch (err) {
      console.warn('MonitoringProvider.refresh failed:', err);
    }
  }, [user?.id]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', state => {
      // On return to foreground, the active group or usage-access grant may have
      // changed while away — reconcile the service to the current reality.
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <MonitoringContext.Provider value={{ refresh }}>
      {children}
    </MonitoringContext.Provider>
  );
};

export const useMonitoring = (): MonitoringState => useContext(MonitoringContext);
