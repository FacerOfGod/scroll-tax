import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Animated,
  AppState,
  Modal,
  FlatList,
  TextInput,
  LayoutAnimation,
  UIManager,
  KeyboardAvoidingView,
} from 'react-native';
import { usePermissions } from '../../context/PermissionsContext';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../services/AuthContext';
import { supabase } from '../../services/supabaseClient';
import { xrplService } from '../../services/XrplService';
import { ledgerService } from '../../services/LedgerService';
import { groupService } from '../../services/GroupService';
import { ScrollDetectionService } from '../../services/ScrollDetectionService';
import * as Keychain from 'react-native-keychain';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';
import { PENDING_INVITE_KEY } from '../../navigation/RootNavigator';
import Logo from '../../components/Logo';
import InAppNotification from '../../components/InAppNotification';
import { HOUSE_WALLET } from '@env';
import { splitDrops, xrpToDropsInt, dropsToXrpString } from '../../utils/penaltySplit';
import { treasuryService } from '../../services/TreasuryService';

// ─── Animated Number ──────────────────────────────────────────────────────────

function useAnimatedNumber(target: number, duration = 550) {
  const [display, setDisplay] = useState(target);
  const currentRef = useRef(target);
  const rafRef     = useRef<number | null>(null);

  useEffect(() => {
    const start = currentRef.current;
    if (Math.abs(start - target) < 0.0001) {
      currentRef.current = target;
      setDisplay(target);
      return;
    }
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const val = start + (target - start) * eased;
      currentRef.current = val;
      setDisplay(val);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        currentRef.current = target;
        setDisplay(target);
      }
    };
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [target]);

  return display;
}

function AnimatedNumber({
  value,
  decimals = 2,
  style,
  prefix = '',
  suffix = '',
}: {
  value: number;
  decimals?: number;
  style?: any;
  prefix?: string;
  suffix?: string;
}) {
  const animated = useAnimatedNumber(value);
  return <Text style={style}>{prefix}{animated.toFixed(decimals)}{suffix}</Text>;
}

// ─── Mini Price Chart ─────────────────────────────────────────────────────────

const CURRENCY_SYMBOL: Record<string, string> = { usd: '$', eur: '€', chf: 'Fr.' };
const CHART_H = 68;
const CHART_PAD = 6;

const MiniPriceChart = React.memo(({
  prices,
  change24h,
  currentPrice,
  currency,
}: {
  prices: number[];
  change24h: number;
  currentPrice: number;
  currency: string;
}) => {
  const { colors } = useTheme();
  const miniChartStyles = createMiniChartStyles(colors);
  const [chartWidth, setChartWidth] = useState(0);
  const isUp = change24h >= 0;

  const min   = prices.length ? Math.min(...prices) : 0;
  const max   = prices.length ? Math.max(...prices) : 1;
  const range = max - min || 1;

  const getX = (i: number) =>
    CHART_PAD + (i / Math.max(prices.length - 1, 1)) * (chartWidth - CHART_PAD * 2);
  const getY = (p: number) =>
    CHART_PAD + (1 - (p - min) / range) * (CHART_H - CHART_PAD * 2);

  const points = chartWidth > 0 ? prices.map((p, i) => ({ x: getX(i), y: getY(p) })) : [];

  return (
    <View style={miniChartStyles.card}>
      {/* Header */}
      <View style={miniChartStyles.header}>
        <View>
          <Text style={miniChartStyles.pair}>XRP / {currency.toUpperCase()}</Text>
          <AnimatedNumber
            value={currentPrice}
            decimals={4}
            style={miniChartStyles.price}
            prefix={CURRENCY_SYMBOL[currency] ?? ''}
          />
        </View>
        <View style={[
          miniChartStyles.badge,
          {
            backgroundColor: isUp ? 'rgba(48,209,88,0.12)' : 'rgba(255,69,58,0.12)',
            borderColor:      isUp ? 'rgba(48,209,88,0.3)'  : 'rgba(255,69,58,0.3)',
          },
        ]}>
          <AnimatedNumber
            value={Math.abs(change24h)}
            decimals={2}
            style={[miniChartStyles.badgeText, { color: isUp ? colors.secondary : colors.error }]}
            prefix={isUp ? '+' : '−'}
            suffix="%"
          />
          <Text style={[miniChartStyles.badgeLabel, { color: isUp ? colors.secondary : colors.error }]}>
            24h
          </Text>
        </View>
      </View>

      {/* Line chart */}
      <View
        style={{ height: CHART_H }}
        onLayout={e => setChartWidth(e.nativeEvent.layout.width)}
      >
        {points.length > 1 && (
          <>
            {/* Area fill – thin vertical columns from point to bottom */}
            {points.map((pt, i) => {
              const colW = (chartWidth - CHART_PAD * 2) / (prices.length - 1);
              return (
                <View
                  key={`f${i}`}
                  style={{
                    position: 'absolute',
                    left: pt.x - colW / 2,
                    top: pt.y,
                    width: colW + 1,
                    height: CHART_H - pt.y,
                    backgroundColor: 'rgba(255, 83, 0, 0.07)',
                  }}
                />
              );
            })}

            {/* Line segments */}
            {points.slice(0, -1).map((pt, i) => {
              const next = points[i + 1];
              const dx   = next.x - pt.x;
              const dy   = next.y - pt.y;
              const len  = Math.sqrt(dx * dx + dy * dy);
              const angle = Math.atan2(dy, dx) * (180 / Math.PI);
              return (
                <View
                  key={`l${i}`}
                  style={{
                    position: 'absolute',
                    left: pt.x + dx / 2 - len / 2,
                    top:  pt.y + dy / 2 - 1,
                    width: len,
                    height: 2,
                    backgroundColor: colors.primary,
                    borderRadius: 1,
                    transform: [{ rotate: `${angle}deg` }],
                  }}
                />
              );
            })}

            {/* Current price dot */}
            {(() => {
              const last = points[points.length - 1];
              return (
                <>
                  <View style={{
                    position: 'absolute',
                    left: last.x - 8,
                    top:  last.y - 8,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: 'rgba(255, 83, 0, 0.2)',
                  }} />
                  <View style={{
                    position: 'absolute',
                    left: last.x - 4,
                    top:  last.y - 4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors.primary,
                  }} />
                </>
              );
            })()}
          </>
        )}
      </View>
    </View>
  );
});

const createMiniChartStyles = (colors: ColorScheme) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  pair: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  price: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    marginTop: 3,
    letterSpacing: -0.5,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '800',
  },
  badgeLabel: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 1,
  },
});

// ─── Pixel Wave ───────────────────────────────────────────────────────────────

const WAVE_COLS   = 16;
const PIXEL_SIZE  = 5;
const PIXEL_GAP   = 3;
const WAVE_AMP    = 12;
const WAVE_PERIOD = 650; // ms per full cycle

const PixelWave = React.memo(({ active }: { active: boolean }) => {
  const { colors } = useTheme();
  const waveStyles = createWaveStyles(colors);
  const anims      = useRef(
    Array.from({ length: WAVE_COLS }, () => new Animated.Value(0)),
  ).current;
  const containerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      // Fade the whole wave in, then start the bobbing loops
      Animated.timing(containerOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();

      const timeouts: ReturnType<typeof setTimeout>[] = [];
      const loops: Animated.CompositeAnimation[] = [];

      anims.forEach((anim, i) => {
        const t = setTimeout(() => {
          const loop = Animated.loop(
            Animated.sequence([
              Animated.timing(anim, { toValue: 1, duration: WAVE_PERIOD / 2, useNativeDriver: true }),
              Animated.timing(anim, { toValue: 0, duration: WAVE_PERIOD / 2, useNativeDriver: true }),
            ]),
          );
          loop.start();
          loops.push(loop);
        }, (i / WAVE_COLS) * WAVE_PERIOD);
        timeouts.push(t);
      });

      return () => {
        timeouts.forEach(clearTimeout);
        loops.forEach(l => l.stop());
        anims.forEach(a => a.setValue(0));
      };
    } else {
      // Fade the whole wave out, then reset pixels
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(() => {
        anims.forEach(a => a.setValue(0));
      });
    }
  }, [active]);

  const hintOpacity = containerOpacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={waveStyles.container}>
      <Animated.Text style={[waveStyles.hint, { opacity: hintOpacity }]}>
        tap to refresh
      </Animated.Text>
      <Animated.View style={[waveStyles.row, { opacity: containerOpacity, position: 'absolute' }]}>
        {anims.map((anim, i) => {
          const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -WAVE_AMP] });
          const opacity    = anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
          return (
            <Animated.View
              key={i}
              style={[waveStyles.pixel, { transform: [{ translateY }], opacity }]}
            />
          );
        })}
      </Animated.View>
    </View>
  );
});

const createWaveStyles = (colors: ColorScheme) => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    height: WAVE_AMP + PIXEL_SIZE + 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    height: WAVE_AMP + PIXEL_SIZE + 4,
    gap: PIXEL_GAP,
  },
  pixel: {
    width: PIXEL_SIZE,
    height: PIXEL_SIZE,
    backgroundColor: colors.primary,
    borderRadius: 1,
  },
  hint: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
    letterSpacing: 0.8,
  },
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DashboardScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user, signOut, refreshTokenBalance } = useAuth();
  const { usageAccessGranted, refresh: refreshPermissions } = usePermissions();
  const [balance, setBalance]             = useState<string | null>(null);
  const [penaltyCount, setPenaltyCount]   = useState(0);
  const [penaltyCost, setPenaltyCost]     = useState(0);
  const [activeStakeType, setActiveStakeType] = useState<'xrp' | 'tokens'>('xrp');
  const [showPenaltyStats, setShowPenaltyStats] = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [copied, setCopied]               = useState(false);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [hasActiveGroup, setHasActiveGroup]   = useState(false);
  const [inAppNotif, setInAppNotif] = useState<{ title: string; body: string } | null>(null);
  const showInAppNotif = (title: string, body: string) => setInAppNotif({ title, body });
  const [xrpPrices, setXrpPrices] = useState<{ usd: number; eur: number; chf: number } | null>(null);
  const [currency, setCurrency]   = useState<'usd' | 'eur' | 'chf'>('usd');
  const [chartData, setChartData] = useState<{ prices: number[]; change24h: number } | null>(null);

  // ─── Wallet tab state ─────────────────────────────────────────────────────
  type WalletTab = 'app' | 'ledger' | 'tokens';
  const [activeWalletTab, setActiveWalletTab] = useState<WalletTab>('app');
  const tabIndicatorAnim  = useRef(new Animated.Value(0)).current;
  const tabContentOpacity = useRef(new Animated.Value(1)).current;
  const [tabRowWidth, setTabRowWidth] = useState(0);
  type LedgerState = 'idle' | 'scanning' | 'connecting' | 'connected';
  const [ledgerUiState, setLedgerUiState] = useState<LedgerState>('idle');
  const [ledgerDevices, setLedgerDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [ledgerAddress, setLedgerAddress]   = useState<string | null>(null);
  const [ledgerPubKey, setLedgerPubKey]     = useState<string | null>(null);
  const [ledgerBalance, setLedgerBalance]   = useState<string>('0');
  const [ledgerError, setLedgerError]       = useState<string | null>(null);
  const [ledgerCopied, setLedgerCopied]     = useState(false);
  const [sendModalVisible, setSendModalVisible] = useState(false);
  const [sendDestination, setSendDestination]   = useState('');
  const [sendAmount, setSendAmount]             = useState('');
  const [isSending, setIsSending]               = useState(false);
  const [sendError, setSendError]               = useState<string | null>(null);
  const scanCleanupRef         = useRef<(() => void) | null>(null);
  const connectingDeviceName   = useRef<string>('');

  const headerAnim  = useEntranceAnimation(0);
  const balanceAnim = useEntranceAnimation(100);
  const actionsAnim = useEntranceAnimation(200);

  const balanceOpacity  = useRef(new Animated.Value(1)).current;
  const pulseAnim       = useRef(new Animated.Value(1)).current;

  const pendingPenalties       = useRef<{ appName: string; amount: number }[]>([]);
  const prevAppState           = useRef(AppState.currentState);
  const activeGroupIdRef       = useRef<string | null>(null);
  const activePenaltyAmountRef = useRef<number>(0.5);
  const warnedAppsRef          = useRef<Set<string>>(new Set());
  const handlePenaltyRef       = useRef<(pkg: string, dur: number) => Promise<void>>(() => Promise.resolve());

  const fetchBalance = useCallback(async () => {
    if (!user?.address) return;
    const bal = await xrplService.getBalance(user.address);
    setBalance(bal);
  }, [user?.address]);

  const handleTapRefresh = useCallback(() => {
    setIsRefreshingBalance(true);
    Animated.timing(balanceOpacity, {
      toValue: 0.08,
      duration: 380,
      useNativeDriver: true,
    }).start(async () => {
      await Promise.all([
        fetchBalance(),
        new Promise<void>(resolve => setTimeout(resolve, 3 * WAVE_PERIOD)),
      ]);
      setIsRefreshingBalance(false);
      Animated.timing(balanceOpacity, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }).start();
    });
  }, [fetchBalance, balanceOpacity]);

  const handleWalletTabChange = useCallback((tab: WalletTab) => {
    const tabIndex = tab === 'app' ? 0 : tab === 'ledger' ? 1 : 2;
    Animated.timing(tabContentOpacity, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(() => {
      setActiveWalletTab(tab);
      if (tab === 'tokens') refreshTokenBalance();
      Animated.spring(tabIndicatorAnim, {
        toValue: tabIndex,
        useNativeDriver: true,
        tension: 180,
        friction: 20,
      }).start();
    });
  }, [tabIndicatorAnim, tabContentOpacity, refreshTokenBalance]);

  useEffect(() => {
    if (activeWalletTab) {
      LayoutAnimation.configureNext({
        duration: 300,
        update: { type: LayoutAnimation.Types.spring, springDamping: 0.75 },
      });
      Animated.timing(tabContentOpacity, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }).start();
    }
  }, [activeWalletTab]);

  const handleCopyAddress = useCallback(() => {
    if (!user?.address) return;
    Clipboard.setString(user.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [user?.address]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBalance();
    setRefreshing(false);
  }, [fetchBalance]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;

      // Set threshold immediately so the native service uses 30 s from the start,
      // not the SharedPrefs default of 5 s that applies until the async DB call finishes.
      ScrollDetectionService.updateSettings({ thresholdSeconds: 30 });

      // Re-check usage access + notifications (state lives in PermissionsContext,
      // which also drives the Settings-tab attention dot).
      refreshPermissions();

      groupService.getActiveGroupForUser(user.id).then(({ data, error }) => {
        if (error) return;
        const group = (data as any)?.groups;
        setHasActiveGroup(!!group);
        activeGroupIdRef.current = group?.id ?? null;
        if (group?.penalty_amount) {
          activePenaltyAmountRef.current = group.penalty_amount;
        }
        setActiveStakeType(group?.stake_type ?? 'xrp');
        const bannedApps = group?.banned_apps ?? [];
        // Only push if non-empty — pushing [] overwrites SharedPrefs and clears the
        // native default banned-apps list, disabling detection until the next focus.
        if (bannedApps.length > 0) {
          ScrollDetectionService.updateSettings({ bannedApps });
        }
      });
    }, [user?.id, refreshPermissions]),
  );

  // Pulse animation for active-group indicator
  useEffect(() => {
    if (!hasActiveGroup) { pulseAnim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasActiveGroup]);

  // After login, check if a group invite deep link was pending
  useEffect(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(PENDING_INVITE_KEY).then(groupId => {
      if (groupId) {
        AsyncStorage.removeItem(PENDING_INVITE_KEY);
        navigation.navigate('GroupDashboard', { groupId });
      }
    });
  }, [user?.id]);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd,eur,chf',
        );
        const data = await res.json();
        setXrpPrices({ usd: data.ripple.usd, eur: data.ripple.eur, chf: data.ripple.chf });
      } catch (err) {
        console.warn('Failed to fetch XRP prices:', err);
      }
    };
    fetchPrices();
    const priceInterval = setInterval(fetchPrices, 60_000);
    return () => clearInterval(priceInterval);
  }, []);

  useEffect(() => {
    const fetch24h = async () => {
      try {
        const res  = await fetch(
          `https://api.coingecko.com/api/v3/coins/ripple/market_chart?vs_currency=${currency}&days=1`,
        );
        const data = await res.json();
        const raw  = (data.prices as [number, number][]).map(([, p]) => p);
        if (!raw.length) return;
        const change = ((raw[raw.length - 1] - raw[0]) / raw[0]) * 100;
        setChartData({ prices: raw.slice(-24), change24h: change });
      } catch (err) {
        console.warn('Failed to fetch XRP 24h chart:', err);
      }
    };
    fetch24h();
    const chartInterval = setInterval(fetch24h, 60_000);
    return () => clearInterval(chartInterval);
  }, [currency]);

  // Only run the foreground monitoring service when the user is in an active
  // group AND has granted usage-access. Stop it in any other case.
  useEffect(() => {
    if (hasActiveGroup && usageAccessGranted) {
      ScrollDetectionService.startMonitoring();
    } else {
      ScrollDetectionService.stopMonitoring();
    }
  }, [hasActiveGroup, usageAccessGranted]);

  useEffect(() => {
    fetchBalance();

    // Register the XRPL seed with the native module so it can HMAC-sign
    // the offline pending-penalty queue against tampering.
    Keychain.getGenericPassword({ service: `xrpl-${user!.id}` }).then(cred => {
      if (cred) ScrollDetectionService.setXrplSeed(cred.password);
    }).catch(err => console.warn('Failed to register XRPL seed for offline penalty signing:', err));

    const scrollSub     = ScrollDetectionService.onScroll((_packageName: string) => {});
    const bannedAppSub  = ScrollDetectionService.onBannedAppEntered((packageName: string) => {
      const friendly: Record<string, string> = {
        'com.zhiliaoapp.musically':  'TikTok',
        'com.instagram.android':     'Instagram',
        'com.google.android.youtube':'YouTube',
        'com.whatsapp':              'WhatsApp',
      };
      const name = friendly[packageName] ?? packageName.split('.').pop();
      if (warnedAppsRef.current.has(packageName)) return;
      warnedAppsRef.current.add(packageName);
      const penalty = activePenaltyAmountRef.current;
      Alert.alert('Banned App Detected', `You opened ${name}. Stay too long and you'll lose ${penalty} XRP.`);
    });

    const penaltySub = ScrollDetectionService.onPenalty((data: string) => {
      const [packageName, durationStr] = data.split('|');
      const duration = parseInt(durationStr, 10) || 1;
      const friendlyName = ({
        'com.zhiliaoapp.musically':   'TikTok',
        'com.instagram.android':      'Instagram',
        'com.google.android.youtube': 'YouTube',
        'com.whatsapp':               'WhatsApp',
      } as Record<string, string>)[packageName] ?? packageName.split('.').pop() ?? packageName;
      showInAppNotif(`⏰ 30s on ${friendlyName}`, 'Processing penalty…');
      handlePenaltyRef.current(packageName, duration);
    });

    return () => {
      scrollSub.remove();
      bannedAppSub.remove();
      penaltySub.remove();
    };
  }, [user?.address]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      const wasAway = prevAppState.current !== 'active';
      prevAppState.current = nextState;

      if (nextState === 'active' && wasAway) {
        warnedAppsRef.current.clear();

        // Re-push server-authoritative banned-apps settings to the native service,
        // overwriting any SharedPreferences tampering that occurred while away.
        groupService.getActiveGroupForUser(user!.id).then(({ data }) => {
          const g = (data as any)?.groups;
          if (g?.status === 'active') {
            ScrollDetectionService.updateSettings({
              thresholdSeconds: (g.penalty_trigger_time_minutes ?? 1) * 60,
              bannedApps:       g.banned_apps ?? [],
            });
          }
        }).catch(err => console.warn('Failed to re-push banned-apps settings:', err));

        // Check if usage access was revoked while away. If so, forfeit the user's stake.
        // (PermissionsContext also re-checks on foreground; this read drives the forfeit.)
        ScrollDetectionService.hasUsageAccess().then(async granted => {
          if (!granted && activeGroupIdRef.current) {
            const groupId = activeGroupIdRef.current;
            activeGroupIdRef.current = null;
            setHasActiveGroup(false);
            const result = await groupService.forfeitStake(groupId);
            const lost = result.amount?.toFixed(2) ?? '?';
            Alert.alert(
              'Stake Forfeited',
              `App usage permission was revoked. Your remaining stake of ${lost} has been forfeited and distributed to your group.`,
              [{ text: 'OK' }],
            );
          }
        });

        // Flush any penalties that fired while JS was inactive (app backgrounded)
        ScrollDetectionService.getPendingPenalties().then(pending => {
          if (!pending) return;
          pending.split(';').filter(Boolean).forEach(item => {
            const [pkg, durationStr] = item.split('|');
            const duration = parseInt(durationStr, 10) || 1;
            const friendlyName = ({
              'com.zhiliaoapp.musically':   'TikTok',
              'com.instagram.android':      'Instagram',
              'com.google.android.youtube': 'YouTube',
              'com.whatsapp':               'WhatsApp',
            } as Record<string, string>)[pkg] ?? pkg.split('.').pop() ?? pkg;
            showInAppNotif(`⏰ 30s on ${friendlyName}`, 'Processing penalty…');
            handlePenaltyRef.current(pkg, duration);
          });
        });

        setTimeout(() => {
          if (pendingPenalties.current.length === 0) return;
          const total    = pendingPenalties.current.reduce((sum, p) => sum + p.amount, 0);
          const count    = pendingPenalties.current.length;
          const appNames = [...new Set(pendingPenalties.current.map(p => p.appName))].join(', ');
          pendingPenalties.current = [];
          fetchBalance();
          Alert.alert(
            '💸 Penalty Summary',
            `${count} penalty${count > 1 ? ' events' : ''} while you were away.\n\nApps: ${appNames}\nTotal deducted: −${total.toFixed(2)} XRP`,
            [{ text: 'Got it' }],
          );
        }, 1500);
      }
    });
    return () => subscription.remove();
  }, [fetchBalance]);

  const DEV_WALLET = HOUSE_WALLET || 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

  const handlePenaltyTriggered = async (packageName: string, _durationMinutes: number) => {
    const { data: membership } = await groupService.getActiveGroupForUser(user!.id);
    const group = membership?.groups as any;
    if (!group?.id) {
      return;
    }

    const penaltyAmount = group.penalty_amount ?? 0.5;
    const appName       = packageName.split('.').pop();

    setPenaltyCount(prev => prev + 1);
    setPenaltyCost(prev => prev + penaltyAmount);
    pendingPenalties.current.push({ appName: appName || packageName, amount: penaltyAmount });

    const isTokenGroup = group.stake_type === 'tokens';

    try {
      if (isTokenGroup) {
        // ── Token penalty path (server-side atomic) ─────────────────────────
        const result = await groupService.recordPenaltyRpc(group.id, packageName);
        if (!result.ok) {
          if (result.error === 'rate_limited') return;
          throw new Error(result.error ?? 'Penalty failed');
        }
        showInAppNotif(`◈ ${result.amount} Tokens deducted`, `Penalty for ${appName} — split to group.`);
        refreshTokenBalance();
      } else if (treasuryService.address) {
        // ── XRP penalty path (treasury-backed) ──────────────────────────────
        // Redistribution happens server-side inside record_penalty: the
        // offender's held stake is debited and split to the other members'
        // ledger balances. No device-signed on-chain transaction here.
        const result = await groupService.recordPenaltyRpc(group.id, packageName);
        if (!result.ok && result.error !== 'rate_limited') {
          throw new Error(result.error ?? 'Penalty failed');
        }
        if (result.ok) {
          showInAppNotif(`💸 ${penaltyAmount} XRP penalty`, `Deducted from your stake and split to the group.`);
          fetchBalance();
        }
      } else {
        // ── XRP penalty path (legacy: device signs from the user's wallet) ──
        const { data: members } = await groupService.getGroupMembers(group.id);
        const otherMembers = members.filter((m: any) => m.user_id !== user!.id && m.wallet_address);

        const credentials = await Keychain.getGenericPassword({ service: `xrpl-${user!.id}` });
        if (!credentials) return;

        const txHashes: string[] = [];
        if (otherMembers.length === 0) {
          const tx = await xrplService.sendXrp(credentials.password, DEV_WALLET, String(penaltyAmount));
          const h = (tx as any)?.result?.hash;
          if (h) txHashes.push(h);
          showInAppNotif(`💸 ${penaltyAmount} XRP sent to the pot`, `Penalty for ${appName} — no group mates yet, sent to the house.`);
        } else {
          // Split in integer drops so no dust is lost; the remainder goes to the
          // first member (see splitDrops). XRPL payments are independent and cannot
          // be made atomic, so track how many succeeded — a mid-loop failure is
          // surfaced instead of recording one hash as if everyone had been paid.
          const perMemberDrops = splitDrops(xrpToDropsInt(penaltyAmount), otherMembers.length);
          let sent = 0;
          let attempted = 0;
          try {
            for (let i = 0; i < otherMembers.length; i++) {
              const drops = perMemberDrops[i];
              if (drops <= 0) continue; // nothing owed to this member
              attempted += 1;
              const tx = await xrplService.sendXrp(
                credentials.password, otherMembers[i].wallet_address, dropsToXrpString(drops),
              );
              const h = (tx as any)?.result?.hash;
              if (h) txHashes.push(h);
              sent += 1;
            }
          } catch (sendErr: any) {
            fetchBalance();
            throw new Error(
              `Penalty partially sent: ${sent}/${attempted} members paid. ${sendErr?.message ?? ''}`.trim(),
            );
          }
          showInAppNotif(`💸 ${penaltyAmount} XRP split to the group`, `Penalty for ${appName} — split across ${otherMembers.length} member(s).`);
        }
        fetchBalance();

        // Record server-side — server re-reads penalty_amount from group row.
        const txHash = txHashes[0];
        const result = await groupService.recordPenaltyRpc(group.id, packageName, txHash);
        if (!result.ok && result.error !== 'rate_limited') {
          throw new Error(result.error ?? 'Server record failed');
        }

        // Best-effort on-chain verification — awaited so errors are swallowed cleanly.
        if (txHash && result.ok) {
          try {
            const { data: evtRows } = await supabase
              .from('penalty_events')
              .select('id')
              .eq('group_id', group.id)
              .eq('user_id', user!.id)
              .order('fired_at', { ascending: false })
              .limit(1);
            const eventId = evtRows?.[0]?.id;
            if (eventId) {
              await supabase.functions.invoke('verify-penalty-tx', {
                body: { penalty_event_id: eventId, tx_hash: txHash },
              });
            }
          } catch {
            // Non-fatal: verification will be retried on the next penalty.
          }
        }
      }
    } catch (e: any) {
      setPenaltyCount(prev => prev - 1);
      setPenaltyCost(prev => prev - penaltyAmount);
      pendingPenalties.current.pop();
      Alert.alert('Payment Failed', e?.message || 'Could not process penalty.');
    }
  };
  handlePenaltyRef.current = handlePenaltyTriggered;

  // ─── Ledger handlers ──────────────────────────────────────────────────────

  const handleStartScan = useCallback(async () => {
    setLedgerError(null);
    const granted = await ledgerService.requestPermissions();
    if (!granted) {
      setLedgerError('Bluetooth permission required');
      return;
    }
    setLedgerDevices([]);
    setLedgerUiState('scanning');
    const cleanup = ledgerService.scanDevices(device => {
      setLedgerDevices(prev =>
        prev.find(d => d.id === device.id) ? prev : [...prev, device],
      );
    });
    scanCleanupRef.current = cleanup;
    // Auto-stop after 30 seconds
    setTimeout(() => {
      if (scanCleanupRef.current) {
        scanCleanupRef.current();
        scanCleanupRef.current = null;
        setLedgerUiState(s => (s === 'scanning' ? 'idle' : s));
      }
    }, 30_000);
  }, []);

  const handleStopScan = useCallback(() => {
    scanCleanupRef.current?.();
    scanCleanupRef.current = null;
    setLedgerUiState('idle');
  }, []);

  const handleConnectDevice = useCallback(async (device: { id: string; name: string }) => {
    handleStopScan();
    connectingDeviceName.current = device.name;
    setLedgerUiState('connecting');
    setLedgerError(null);
    try {
      await ledgerService.connect(device.id, device.name);
      const { address, publicKey } = await ledgerService.getAddress();
      setLedgerAddress(address);
      setLedgerPubKey(publicKey);
      const bal = await xrplService.getBalance(address);
      setLedgerBalance(bal);
      setLedgerUiState('connected');
    } catch (err: any) {
      setLedgerError(err?.message ?? 'Connection failed');
      setLedgerUiState('idle');
    }
  }, [handleStopScan]);

  const handleLedgerDisconnect = useCallback(async () => {
    await ledgerService.disconnect();
    setLedgerUiState('idle');
    setLedgerAddress(null);
    setLedgerPubKey(null);
    setLedgerBalance('0');
    setLedgerError(null);
  }, []);

  const handleLedgerCopyAddress = useCallback(() => {
    if (!ledgerAddress) return;
    Clipboard.setString(ledgerAddress);
    setLedgerCopied(true);
    setTimeout(() => setLedgerCopied(false), 2000);
  }, [ledgerAddress]);

  const handleLedgerSend = useCallback(async () => {
    if (!ledgerAddress || !ledgerPubKey) return;
    if (!sendDestination.trim()) { setSendError('Enter a destination address'); return; }
    const amt = parseFloat(sendAmount);
    if (isNaN(amt) || amt <= 0) { setSendError('Enter a valid amount'); return; }
    setSendError(null);
    setIsSending(true);
    try {
      await ledgerService.signAndSubmitPayment({
        fromAddress: ledgerAddress,
        publicKey: ledgerPubKey,
        destination: sendDestination.trim(),
        amountXrp: sendAmount.trim(),
      });
      setSendModalVisible(false);
      setSendDestination('');
      setSendAmount('');
      const bal = await xrplService.getBalance(ledgerAddress);
      setLedgerBalance(bal);
      Alert.alert('Sent', 'Transaction confirmed on XRPL.');
    } catch (err: any) {
      setSendError(err?.message ?? 'Transaction failed');
    } finally {
      setIsSending(false);
    }
  }, [ledgerAddress, ledgerPubKey, sendDestination, sendAmount]);

  const truncateAddress = (addr: string) =>
    addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : '';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          style={[
            styles.header,
            { opacity: headerAnim.opacity, transform: [{ translateY: headerAnim.translateY }] },
          ]}
        >
          <View>
            <Logo size="md" showWordmark direction="horizontal" />
          </View>
          <TouchableOpacity style={styles.signOutButton} onPress={signOut} activeOpacity={0.7}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Balance + Stats Card */}
        <Animated.View
          style={[
            styles.balanceCard,
            { opacity: balanceAnim.opacity, transform: [{ translateY: balanceAnim.translateY }] },
          ]}
        >
          {/* Wallet tab selector */}
          <View
            style={styles.walletTabRow}
            onLayout={e => setTabRowWidth(e.nativeEvent.layout.width)}
          >
            {(['app', 'ledger', 'tokens'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                onPress={() => handleWalletTabChange(tab)}
                style={styles.walletTab}
                activeOpacity={0.7}
              >
                <Text style={[styles.walletTabText, activeWalletTab === tab && styles.walletTabTextActive]}>
                  {tab === 'app' ? '○ App Wallet' : tab === 'ledger' ? '▣  Ledger' : '◈  Tokens'}
                </Text>
              </TouchableOpacity>
            ))}
            {tabRowWidth > 0 && (
              <Animated.View
                style={[
                  styles.walletTabIndicator,
                  {
                    width: tabRowWidth / 3,
                    transform: [{
                      translateX: tabIndicatorAnim.interpolate({
                        inputRange: [0, 1, 2],
                        outputRange: [0, tabRowWidth / 3, (tabRowWidth / 3) * 2],
                      }),
                    }],
                  },
                ]}
              />
            )}
          </View>

          <Animated.View style={{ opacity: tabContentOpacity }}>
          {activeWalletTab === 'app' ? (
            <TouchableOpacity onPress={handleTapRefresh} activeOpacity={1}>
              <TouchableOpacity
                onPress={() => setShowPenaltyStats(v => !v)}
                style={styles.statsToggleBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.statsToggleBtnText}>{showPenaltyStats ? '−' : '+'}</Text>
              </TouchableOpacity>
              {/* Main content blurs on tap */}
              <Animated.View style={[styles.balanceCardInner, { opacity: balanceOpacity }]}>
                {/* Left: total balance */}
                <View style={[styles.balanceLeft, !showPenaltyStats && { alignItems: 'center' }]}>
                  <Text style={styles.balanceLabel}>Total Balance</Text>
                  {balance === null ? (
                    <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
                  ) : (
                    <>
                      <View style={styles.balanceRow}>
                        <AnimatedNumber value={parseFloat(balance)} decimals={2} style={styles.balanceValue} />
                        <Text style={styles.balanceCurrencyInline}>XRP</Text>
                      </View>
                      {xrpPrices && (
                        <AnimatedNumber
                          value={parseFloat(balance) * xrpPrices[currency]}
                          decimals={2}
                          style={styles.fiatValue}
                          prefix={({ usd: '$', eur: '€', chf: 'Fr.' } as Record<string, string>)[currency]}
                          suffix={` ${currency.toUpperCase()}`}
                        />
                      )}
                      <View style={styles.currencyRow}>
                        {(['usd', 'eur', 'chf'] as const).map(c => (
                          <TouchableOpacity
                            key={c}
                            onPress={() => setCurrency(c)}
                            style={[styles.currencyChip, currency === c && styles.currencyChipActive]}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                          >
                            <Text style={[styles.currencyChipText, currency === c && styles.currencyChipTextActive]}>
                              {c.toUpperCase()}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                </View>

                {showPenaltyStats && (
                  <>
                    <View style={styles.cardDividerV} />

                    {/* Right: stats */}
                    <View style={styles.balanceRight}>
                      <View style={styles.statItem}>
                        <AnimatedNumber value={penaltyCount} decimals={0} style={styles.statValue} />
                        <Text style={styles.statLabel}>Penalties</Text>
                      </View>
                      <View style={styles.statItemDivider} />
                      <View style={styles.statItem}>
                        <AnimatedNumber
                          value={penaltyCost}
                          decimals={2}
                          style={[styles.statValue, penaltyCost > 0 && { color: colors.error }]}
                        />
                        <Text style={styles.statLabel}>{activeStakeType === 'tokens' ? 'Tokens Lost' : 'XRP Lost'}</Text>
                      </View>
                      <View style={styles.statItemDivider} />
                      <View style={styles.statItem}>
                        {activeStakeType === 'tokens' ? (
                          <AnimatedNumber
                            value={(user?.tokens ?? 0) - penaltyCost}
                            decimals={2}
                            style={styles.statValue}
                          />
                        ) : balance !== null ? (
                          <AnimatedNumber
                            value={parseFloat(balance) - penaltyCost}
                            decimals={2}
                            style={styles.statValue}
                          />
                        ) : (
                          <Text style={styles.statValue}>—</Text>
                        )}
                        <Text style={styles.statLabel}>Net Balance</Text>
                      </View>
                    </View>
                  </>
                )}
              </Animated.View>

              {/* Footer: wave + hint always mounted, cross-fade via active prop */}
              <View style={styles.addressFooterRow}>
                <Text style={styles.walletAddress} numberOfLines={1} adjustsFontSizeToFit>{user?.address || ''}</Text>
                <TouchableOpacity onPress={handleCopyAddress} activeOpacity={0.6} style={styles.copyButton}>
                  <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => navigation.navigate('WalletBackup')}
                  activeOpacity={0.6}
                  style={styles.copyButton}
                >
                  <Text style={styles.copyButtonText}>Back up</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cardFooter}>
                <PixelWave active={isRefreshingBalance} />
              </View>
            </TouchableOpacity>
          ) : activeWalletTab === 'ledger' ? (
            /* ── Ledger tab ── */
            <View style={styles.ledgerTabContent}>
              {ledgerUiState === 'idle' && (
                <>
                  <Text style={styles.ledgerIdleTitle}>Connect Ledger Nano X</Text>
                  <Text style={styles.ledgerIdleSub}>Sign XRP transactions with your hardware wallet</Text>
                  <TouchableOpacity style={styles.ledgerScanBtn} onPress={handleStartScan} activeOpacity={0.8}>
                    <Text style={styles.ledgerScanBtnText}>Scan for Devices</Text>
                  </TouchableOpacity>
                  {ledgerError && <Text style={styles.ledgerError}>{ledgerError}</Text>}
                </>
              )}

              {ledgerUiState === 'scanning' && (
                <>
                  <View style={styles.ledgerRow}>
                    <ActivityIndicator color={colors.primary} size="small" />
                    <Text style={styles.ledgerScanningText}>Searching for devices…</Text>
                  </View>
                  <Text style={styles.ledgerTip}>Open the XRP app on your Ledger before connecting</Text>
                  {ledgerDevices.length > 0 && (
                    <FlatList
                      data={ledgerDevices}
                      keyExtractor={d => d.id}
                      scrollEnabled={false}
                      style={{ width: '100%', marginTop: 8 }}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={styles.ledgerDeviceRow}
                          onPress={() => handleConnectDevice(item)}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.ledgerDeviceName}>{item.name}</Text>
                          <Text style={styles.ledgerDeviceConnect}>Connect ›</Text>
                        </TouchableOpacity>
                      )}
                    />
                  )}
                  <TouchableOpacity onPress={handleStopScan} style={{ marginTop: 10 }}>
                    <Text style={styles.ledgerStopText}>Stop scanning</Text>
                  </TouchableOpacity>
                  {ledgerError && <Text style={styles.ledgerError}>{ledgerError}</Text>}
                </>
              )}

              {ledgerUiState === 'connecting' && (
                <>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.ledgerScanningText}>
                    Connecting to {connectingDeviceName.current}…
                  </Text>
                  <Text style={styles.ledgerTip}>Make sure the XRP app is open on your Ledger</Text>
                </>
              )}

              {ledgerUiState === 'connected' && ledgerAddress && (
                <>
                  <View style={styles.ledgerConnectedBadge}>
                    <Text style={styles.ledgerConnectedLabel}>▣  Hardware Wallet</Text>
                  </View>
                  <View style={styles.ledgerAddressRow}>
                    <Text style={styles.walletAddress}>{truncateAddress(ledgerAddress)}</Text>
                    <TouchableOpacity onPress={handleLedgerCopyAddress} style={styles.copyButton}>
                      <Text style={styles.copyButtonText}>{ledgerCopied ? 'Copied' : 'Copy'}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.balanceRow, { marginTop: 12 }]}>
                    <AnimatedNumber value={parseFloat(ledgerBalance)} decimals={2} style={styles.balanceValue} />
                    <Text style={styles.balanceCurrencyInline}>XRP</Text>
                  </View>
                  {xrpPrices && (
                    <AnimatedNumber
                      value={parseFloat(ledgerBalance) * xrpPrices[currency]}
                      decimals={2}
                      style={styles.fiatValue}
                      prefix={({ usd: '$', eur: '€', chf: 'Fr.' } as Record<string, string>)[currency]}
                      suffix={` ${currency.toUpperCase()}`}
                    />
                  )}
                  <TouchableOpacity
                    style={[styles.ledgerScanBtn, { marginTop: 18 }]}
                    onPress={() => { setSendError(null); setSendModalVisible(true); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.ledgerScanBtnText}>Send XRP</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleLedgerDisconnect} style={{ marginTop: 10 }}>
                    <Text style={styles.ledgerStopText}>Disconnect</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            /* ── Tokens tab ── */
            <View style={styles.balanceCardInner}>
              <TouchableOpacity
                onPress={() => setShowPenaltyStats(v => !v)}
                style={styles.statsToggleBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.statsToggleBtnText}>{showPenaltyStats ? '−' : '+'}</Text>
              </TouchableOpacity>
              <View style={[styles.balanceLeft, !showPenaltyStats && { alignItems: 'center' }]}>
                <Text style={styles.balanceLabel}>Token Balance</Text>
                <View style={styles.tokenIconRow}>
                  <Text style={styles.tokenIcon}>◈</Text>
                  <Text style={styles.tokenBalanceValue}>{user?.tokens ?? '—'}</Text>
                  <Text style={styles.tokenBalanceUnit}>Tokens</Text>
                </View>
                <Text style={styles.tokenDescription}>In-app currency</Text>
              </View>
              {showPenaltyStats && (
                <>
                  <View style={styles.cardDividerV} />
                  <View style={styles.balanceRight}>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{penaltyCount}</Text>
                      <Text style={styles.statLabel}>Penalties</Text>
                    </View>
                    <View style={styles.statItemDivider} />
                    <View style={styles.statItem}>
                      <Text style={[styles.statValue, penaltyCost > 0 && { color: colors.error }]}>
                        {penaltyCost.toFixed(2)}
                      </Text>
                      <Text style={styles.statLabel}>Tokens Lost</Text>
                    </View>
                    <View style={styles.statItemDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>
                        {((user?.tokens ?? 0) - penaltyCost).toFixed(2)}
                      </Text>
                      <Text style={styles.statLabel}>Net Balance</Text>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}
          </Animated.View>
        </Animated.View>

        {/* Market Chart — hidden when Tokens tab is active */}
        {activeWalletTab !== 'tokens' && chartData && xrpPrices && (
          <Animated.View style={{ opacity: balanceAnim.opacity, transform: [{ translateY: balanceAnim.translateY }] }}>
            <MiniPriceChart
              prices={chartData.prices}
              change24h={chartData.change24h}
              currentPrice={xrpPrices[currency]}
              currency={currency}
            />
          </Animated.View>
        )}


        {/* Permission warnings now live on the Settings tab (with an attention dot). */}

        {/* Network status — primary navigation now lives in the bottom tab bar */}
        <Animated.View
          style={{ opacity: actionsAnim.opacity, transform: [{ translateY: actionsAnim.translateY }] }}
        >
          {/* Testnet notice */}
          <View style={styles.networkBadge}>
            <View style={styles.networkDot} />
            <Text style={styles.networkText}>Connected to XRPL Testnet</Text>
          </View>
        </Animated.View>
      </ScrollView>

      {/* ── Ledger Send Modal ── */}
      <Modal
        visible={sendModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSendModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Send XRP via Ledger</Text>
            <Text style={styles.modalLabel}>Destination address</Text>
            <TextInput
              style={styles.modalInput}
              value={sendDestination}
              onChangeText={setSendDestination}
              placeholder="r..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalLabel}>Amount (XRP)</Text>
            <TextInput
              style={styles.modalInput}
              value={sendAmount}
              onChangeText={setSendAmount}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />
            {sendError && <Text style={styles.ledgerError}>{sendError}</Text>}
            <TouchableOpacity
              style={[styles.ledgerScanBtn, isSending && { opacity: 0.6 }]}
              onPress={handleLedgerSend}
              disabled={isSending}
              activeOpacity={0.8}
            >
              {isSending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ledgerScanBtnText}>Confirm on Ledger</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSendModalVisible(false)} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={styles.ledgerStopText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {inAppNotif && (
        <InAppNotification
          title={inAppNotif.title}
          body={inAppNotif.body}
          onDismiss={() => setInAppNotif(null)}
        />
      )}
    </SafeAreaView>
  );
};

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    marginBottom: 24,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  walletAddress: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
  },
  signOutButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  signOutText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  balanceCardInner: {
    flexDirection: 'row',
    padding: 24,
    alignItems: 'stretch',
  },
  balanceLeft: {
    flex: 1,
    justifyContent: 'center',
  },
  cardDividerV: {
    width: 1,
    backgroundColor: colors.border,
    marginLeft: 28,
    marginRight: 12,
  },
  balanceRight: {
    flex: 0.75,
    justifyContent: 'space-between',
    paddingLeft: 14,
  },
  statItem: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  statItemDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  addressFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  balanceLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  balanceValue: {
    fontSize: 44,
    fontWeight: '800',
    color: colors.text,
    marginTop: 4,
    letterSpacing: -2,
  },
  balanceCurrency: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: -2,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginTop: 4,
  },
  balanceCurrencyInline: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 5,
  },
  fiatValue: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: 4,
  },
  currencyRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  currencyChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  currencyChipActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255, 83, 0, 0.12)',
  },
  currencyChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  currencyChipTextActive: {
    color: colors.primary,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  actionsList: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 28,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  actionBarDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 54,
  },
  actionBarText: {
    flex: 1,
  },
  actionChevron: {
    fontSize: 22,
    color: colors.textMuted,
    fontWeight: '300',
    lineHeight: 24,
  },
  activeGroupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.secondary,
    marginRight: 8,
    shadowColor: colors.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
    elevation: 4,
  },
  actionIcon: {
    fontSize: 22,
    width: 28,
    textAlign: 'center',
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  actionSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    lineHeight: 15,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  networkDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.secondary,
  },
  networkText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  // ─── Wallet tabs ────────────────────────────────────────────────────────────
  walletTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  walletTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  walletTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  walletTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    backgroundColor: colors.primary,
  },
  walletTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: -0.1,
  },
  walletTabTextActive: {
    color: colors.primary,
  },

  // ─── Ledger tab content ──────────────────────────────────────────────────────
  ledgerTabContent: {
    padding: 24,
    alignItems: 'center',
    minHeight: 180,
    justifyContent: 'center',
  },
  ledgerIdleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  ledgerIdleSub: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 17,
  },
  ledgerScanBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 28,
    alignItems: 'center',
    width: '100%',
  },
  ledgerScanBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: -0.2,
  },
  ledgerError: {
    color: colors.error,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
    fontWeight: '500',
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  ledgerScanningText: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  ledgerTip: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 16,
  },
  ledgerDeviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255, 83, 0, 0.07)',
    borderRadius: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.2)',
  },
  ledgerDeviceName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  ledgerDeviceConnect: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  ledgerStopText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  ledgerConnectedBadge: {
    backgroundColor: 'rgba(255, 83, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 12,
  },
  ledgerConnectedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  ledgerAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // ─── Send Modal ─────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: 0,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 18,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 12,
  },
  modalInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
    fontFamily: 'monospace',
  },

  // ─── Tokens tab content ───────────────────────────────────────────────────
  statsToggleBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  statsToggleBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
    lineHeight: 18,
  },
  tokenIconRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  tokenIcon: {
    fontSize: 22,
    color: colors.primary,
  },
  tokenBalanceValue: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -1,
  },
  tokenBalanceUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    letterSpacing: -0.3,
  },
  tokenDescription: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
});

export default DashboardScreen;
