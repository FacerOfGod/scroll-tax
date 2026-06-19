import { NativeModules, NativeEventEmitter } from 'react-native';

const { ScrollDetection } = NativeModules;
const emitter = new NativeEventEmitter(ScrollDetection);

export const ScrollDetectionService = {
  startMonitoring: () => {
    if (!ScrollDetection?.startMonitoring) {
      console.warn('startMonitoring not available — rebuild native app');
      return;
    }
    ScrollDetection.startMonitoring();
  },

  stopMonitoring: () => {
    ScrollDetection?.stopMonitoring?.();
  },

  updateSettings: (config: {
    thresholdSeconds?: number;
    bannedApps?: string[];
    borderEnabled?: boolean;
  }) => {
    ScrollDetection?.updateSettings?.(config);
  },

  hasUsageAccess: (): Promise<boolean> => {
    if (!ScrollDetection?.hasUsageAccess) return Promise.resolve(false);
    return ScrollDetection.hasUsageAccess();
  },

  openUsageAccessSettings: () => {
    if (!ScrollDetection?.openUsageAccessSettings) {
      console.warn('openUsageAccessSettings not available — rebuild native app');
      return;
    }
    ScrollDetection.openUsageAccessSettings();
  },

  /** Whether "display over other apps" is granted (required for the red-border overlay). */
  hasOverlayPermission: (): Promise<boolean> => {
    if (!ScrollDetection?.hasOverlayPermission) return Promise.resolve(false);
    return ScrollDetection.hasOverlayPermission();
  },

  openOverlaySettings: () => {
    if (!ScrollDetection?.openOverlaySettings) {
      console.warn('openOverlaySettings not available — rebuild native app');
      return;
    }
    ScrollDetection.openOverlaySettings();
  },

  /**
   * Whether the app is exempt from Doze battery optimization. When false, the OS
   * can suspend the foreground monitor during deep sleep, missing penalties — so
   * prompt the user to exempt the app for reliable 24/7 accountability.
   */
  isIgnoringBatteryOptimizations: (): Promise<boolean> => {
    if (!ScrollDetection?.isIgnoringBatteryOptimizations) return Promise.resolve(true);
    return ScrollDetection.isIgnoringBatteryOptimizations();
  },

  openBatteryOptimizationSettings: () => {
    if (!ScrollDetection?.openBatteryOptimizationSettings) {
      console.warn('openBatteryOptimizationSettings not available — rebuild native app');
      return;
    }
    ScrollDetection.openBatteryOptimizationSettings();
  },

  showNotification: (title: string, body: string) => {
    ScrollDetection?.showNotification?.(title, body);
  },

  onScroll: (callback: (packageName: string) => void) =>
    emitter.addListener('onScrollEvent', callback),

  onPenalty: (callback: (data: string) => void) =>
    emitter.addListener('onPenaltyEvent', callback),

  onBannedAppEntered: (callback: (packageName: string) => void) =>
    emitter.addListener('onBannedAppEntered', callback),

  getPendingPenalties: (): Promise<string> =>
    ScrollDetection?.getPendingPenalties?.() ?? Promise.resolve(''),

  /**
   * Registers the XRPL wallet seed with the native module so it can
   * HMAC-sign the offline pending-penalty queue. Call once on app mount
   * after loading the seed from Keychain.
   */
  setXrplSeed: (seed: string): void => {
    ScrollDetection?.setXrplSeed?.(seed);
  },
};
