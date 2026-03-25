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

  updateSettings: (config: { thresholdSeconds?: number; bannedApps?: string[] }) => {
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

  setTelegramContext: (
    supabaseUrl: string,
    supabaseKey: string,
    accessToken: string,
    telegramId: string,
    sessionId: string,
    amount: number,
  ) => {
    ScrollDetection?.setTelegramContext?.(supabaseUrl, supabaseKey, accessToken, telegramId, sessionId, amount);
  },
};
