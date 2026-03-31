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
  PermissionsAndroid,
  Platform,
  Animated,
  AppState,
  Linking,
  Modal,
  FlatList,
  TextInput,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../services/AuthContext';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { xrplService } from '../../services/XrplService';
import { ledgerService } from '../../services/LedgerService';
import { groupService } from '../../services/GroupService';
import { tokenService } from '../../services/TokenService';
import { ScrollDetectionService } from '../../services/ScrollDetectionService';
import * as Keychain from 'react-native-keychain';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';
import { PENDING_INVITE_KEY, PENDING_TELEGRAM_KEY, PENDING_SESSION_KEY } from '../../navigation/RootNavigator';
import Logo from '../../components/Logo';

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
            style={[miniChartStyles.badgeText, { color: isUp ? Colors.secondary : Colors.error }]}
            prefix={isUp ? '+' : '−'}
            suffix="%"
          />
          <Text style={[miniChartStyles.badgeLabel, { color: isUp ? Colors.secondary : Colors.error }]}>
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
                    backgroundColor: Colors.primary,
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
                    backgroundColor: Colors.primary,
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

const miniChartStyles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
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
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  price: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
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

const waveStyles = StyleSheet.create({
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
    backgroundColor: Colors.primary,
    borderRadius: 1,
  },
  hint: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500',
    letterSpacing: 0.8,
  },
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface TelegramSession {
  id: string;
  duration: number;
  stake: number;
  created_at: string;
  participantCount: number;
  banned_apps: string[];
}

const DashboardScreen = ({ navigation }: any) => {
  const { user, signOut, refreshTokenBalance } = useAuth();
  const [balance, setBalance]             = useState<string | null>(null);
  const [penaltyCount, setPenaltyCount]   = useState(0);
  const [penaltyCost, setPenaltyCost]     = useState(0);
  const [refreshing, setRefreshing]       = useState(false);
  const [copied, setCopied]               = useState(false);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [telegramSession, setTelegramSession] = useState<TelegramSession | null>(null);
  const [hasActiveGroup, setHasActiveGroup]   = useState(false);
  const [usageAccessGranted, setUsageAccessGranted] = useState(true);
  const [notifPermGranted, setNotifPermGranted]     = useState(true);
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
  const activePenaltyAmountRef = useRef<number>(0.5);
  const warnedAppsRef          = useRef<Set<string>>(new Set());
  const handlePenaltyRef       = useRef<(pkg: string, dur: number) => Promise<void>>(() => Promise.resolve());
  const relayToTelegramRef     = useRef<(pkg: string, amount: number) => Promise<void>>(() => Promise.resolve());
  const telegramIdRef          = useRef<string | null>(null);
  const initialUrlProcessed    = useRef(false);

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

  const fetchTelegramSession = useCallback(async () => {
    if (!user?.id) return;
    const { data: link } = await supabase
      .from('linked_accounts')
      .select('telegram_id')
      .eq('user_id', user.id)
      .single();
    if (!link?.telegram_id) { telegramIdRef.current = null; setTelegramSession(null); return; }
    telegramIdRef.current = link.telegram_id;

    const { data: participations } = await supabase
      .from('participants')
      .select('session_id')
      .eq('user_id', link.telegram_id);
    if (!participations?.length) { setTelegramSession(null); return; }

    const { data: sessions } = await supabase
      .from('sessions')
      .select('*')
      .in('id', participations.map((p: any) => p.session_id))
      .eq('status', 'active')
      .limit(1);
    const session = sessions?.[0] ?? null;
    if (!session) { setTelegramSession(null); return; }

    const { count } = await supabase
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session.id);

    setTelegramSession({ ...session, banned_apps: session.banned_apps ?? [], participantCount: count ?? 0 });
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;

      fetchTelegramSession();

      // Set threshold immediately so the native service uses 30 s from the start,
      // not the SharedPrefs default of 5 s that applies until the async DB call finishes.
      ScrollDetectionService.updateSettings({ thresholdSeconds: 30 });

      // Check usage access
      ScrollDetectionService.hasUsageAccess().then(granted => setUsageAccessGranted(granted));

      // Check notification permission
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
          .then(granted => setNotifPermGranted(granted));
      } else {
        setNotifPermGranted(true);
      }

      groupService.getActiveGroupForUser(user.id).then(({ data, error }) => {
        if (error) return;
        const group = (data as any)?.groups;
        setHasActiveGroup(!!group);
        if (group?.penalty_amount) {
          activePenaltyAmountRef.current = group.penalty_amount;
        }
        const bannedApps = telegramSession?.banned_apps?.length
          ? telegramSession.banned_apps
          : (group?.banned_apps ?? []);
        ScrollDetectionService.updateSettings({ bannedApps });
      });
    }, [user?.id]),
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

  // Sync banned apps to ScrollDetectionService whenever the Telegram session loads/changes
  useEffect(() => {
    if (!telegramSession?.banned_apps?.length) return;
    ScrollDetectionService.updateSettings({
      bannedApps: telegramSession.banned_apps,
      thresholdSeconds: 30,
    });
  }, [telegramSession?.id]);

  // Push Telegram context to native layer so it can POST deductions directly (bypassing JS thread)
  useEffect(() => {
    if (!telegramSession?.id || !telegramIdRef.current) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      ScrollDetectionService.setTelegramContext(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        session.access_token,
        telegramIdRef.current!,
        telegramSession.id,
        telegramSession.stake,
      );
    });
  }, [telegramSession?.id]);

  // Poll session status every 10s so the UI clears as soon as it's closed
  useEffect(() => {
    if (!telegramSession?.id) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', telegramSession.id)
        .single();
      if (data?.status !== 'active') {
        setTelegramSession(null);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [telegramSession?.id]);

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

  // Core join logic — called both on mount (via AsyncStorage) and from live deep links
  const processSessionJoin = useCallback(async (telegramId: string | null, sessionId: string) => {
    if (!user?.id) return;

    // Step 1 — link account if telegram_id provided
    if (telegramId) {
      await supabase
        .from('linked_accounts')
        .upsert({ telegram_id: telegramId, user_id: user.id });
    }

    // Step 2 — resolve telegram_id
    const resolvedTelegramId = telegramId ?? await (async () => {
      const { data } = await supabase
        .from('linked_accounts')
        .select('telegram_id')
        .eq('user_id', user.id)
        .single();
      return data?.telegram_id ?? null;
    })();

    if (!resolvedTelegramId) {
      Alert.alert('Link Telegram First', 'Open the bot and tap /start to link your account before joining a session.');
      return;
    }

    // Step 3 — check session is active
    const { data: session } = await supabase
      .from('sessions')
      .select('id, stake, duration')
      .eq('id', sessionId)
      .eq('status', 'active')
      .single();

    if (!session) {
      Alert.alert('Session Not Found', 'This session has ended or does not exist.');
      return;
    }

    // Step 4 — skip if already a participant
    const { data: existing } = await supabase
      .from('participants')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', resolvedTelegramId)
      .single();

    if (existing) {
      Alert.alert('Already Joined', 'You are already in this session.');
      return;
    }

    // Step 5 — join
    const { error } = await supabase
      .from('participants')
      .insert({ session_id: sessionId, user_id: resolvedTelegramId, username: resolvedTelegramId });

    if (error) {
      Alert.alert('Failed to Join', error.message);
    } else {
      fetchTelegramSession();
      Alert.alert('Joined! 🎉', `You are in the session.\n⏱ ${session.duration} min  💰 ${session.stake} TON`);
    }
  }, [user?.id]);

  // On mount / after login: drain anything saved to AsyncStorage while logged out.
  // Falls back to Linking.getInitialURL() to handle a race condition where
  // RootNavigator hasn't finished its async getInitialURL→setItem call by the
  // time this effect runs (happens on cold start when user is already logged in).
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const [telegramId, sessionId] = await Promise.all([
        AsyncStorage.getItem(PENDING_TELEGRAM_KEY),
        AsyncStorage.getItem(PENDING_SESSION_KEY),
      ]);
      if (telegramId) AsyncStorage.removeItem(PENDING_TELEGRAM_KEY);
      if (sessionId) {
        AsyncStorage.removeItem(PENDING_SESSION_KEY);
        await processSessionJoin(telegramId, sessionId);
      } else if (telegramId) {
        // Link only, no session to join
        await supabase
          .from('linked_accounts')
          .upsert({ telegram_id: telegramId, user_id: user.id });
      } else if (!initialUrlProcessed.current) {
        // Fallback: read the launch URL directly in case RootNavigator lost the race
        initialUrlProcessed.current = true;
        const url = await Linking.getInitialURL();
        if (!url) return;
        const sMatch = url.match(/scrolltax:\/\/session\?id=([^&]+)/);
        if (sMatch) {
          const sid = sMatch[1].trim();
          const tgM = url.match(/[?&]telegram_id=([^&]+)/);
          await processSessionJoin(tgM ? tgM[1].trim() : null, sid);
        }
      }
    })();
  }, [user?.id]);

  // Live deep-link handler: fires when the app is already open and a link arrives
  useEffect(() => {
    if (!user?.id) return;
    const sub = Linking.addEventListener('url', ({ url }) => {
      const linkMatch = url.match(/scrolltax:\/\/link\?telegram_id=([^&]+)/);
      if (linkMatch) {
        supabase.from('linked_accounts').upsert({ telegram_id: linkMatch[1].trim(), user_id: user.id });
        return;
      }
      const sessionMatch = url.match(/scrolltax:\/\/session\?id=([^&]+)/);
      if (!sessionMatch) return;
      const sessionId = sessionMatch[1].trim();
      const tgMatch = url.match(/[?&]telegram_id=([^&]+)/);
      const telegramId = tgMatch ? tgMatch[1].trim() : null;
      // Clear AsyncStorage so the mount effect doesn't double-join on next app open
      AsyncStorage.removeItem(PENDING_SESSION_KEY);
      if (telegramId) AsyncStorage.removeItem(PENDING_TELEGRAM_KEY);
      processSessionJoin(telegramId, sessionId);
    });
    return () => sub.remove();
  }, [user?.id, processSessionJoin]);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd,eur,chf',
        );
        const data = await res.json();
        setXrpPrices({ usd: data.ripple.usd, eur: data.ripple.eur, chf: data.ripple.chf });
      } catch {}
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
      } catch {}
    };
    fetch24h();
    const chartInterval = setInterval(fetch24h, 60_000);
    return () => clearInterval(chartInterval);
  }, [currency]);

  useEffect(() => {
    fetchBalance();
    ScrollDetectionService.startMonitoring();

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
      ScrollDetectionService.showNotification(
        `⏰ 30s on ${friendlyName}`,
        'Processing penalty…',
      );
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
            ScrollDetectionService.showNotification(
              `⏰ 30s on ${friendlyName}`,
              'Processing penalty…',
            );
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

  const DEV_WALLET = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

  const FRIENDLY_APP_NAMES: Record<string, string> = {
    'com.zhiliaoapp.musically':   'TikTok',
    'com.instagram.android':      'Instagram',
    'com.google.android.youtube': 'YouTube',
    'com.whatsapp':               'WhatsApp',
  };

  // Keep refs in sync so the AppState flush handler always calls the latest version
  const relayToTelegram = useCallback(async (packageName: string, amount: number) => {
    if (!user?.id) return;

    const { data: link } = await supabase
      .from('linked_accounts')
      .select('telegram_id')
      .eq('user_id', user.id)
      .single();
    if (!link?.telegram_id) {
      ScrollDetectionService.showNotification('📵 Telegram not linked', 'Link your Telegram account in the bot to enable TON penalties.');
      return;
    }

    const { data: participations } = await supabase
      .from('participants')
      .select('session_id')
      .eq('user_id', link.telegram_id);
    if (!participations?.length) {
      ScrollDetectionService.showNotification('📵 No Telegram session', 'Join a session via the bot to enable TON penalties.');
      return;
    }

    const { data: session } = await supabase
      .from('sessions')
      .select('id')
      .in('id', participations.map((p: any) => p.session_id))
      .eq('status', 'active')
      .single();
    if (!session) {
      ScrollDetectionService.showNotification('📵 Session ended', 'No active Telegram session found.');
      return;
    }

    const appName = FRIENDLY_APP_NAMES[packageName] ?? (packageName.split('.').pop() ?? packageName);

    // Try with app_name first; if column doesn't exist yet, retry without it
    const { error } = await supabase.from('deductions').insert({
      session_id: session.id,
      telegram_id: link.telegram_id,
      amount,
      app_name: appName,
    });

    if (error) {
      console.log('[relayToTelegram] insert error:', error.message, '— retrying without app_name');
      const { error: retryError } = await supabase.from('deductions').insert({
        session_id: session.id,
        telegram_id: link.telegram_id,
        amount,
      });
      if (retryError) console.log('[relayToTelegram] retry failed:', retryError.message);
    }
  }, [user?.id]);
  relayToTelegramRef.current = relayToTelegram;

  const handlePenaltyTriggered = async (packageName: string, _durationMinutes: number) => {
    const { data: membership, error: groupErr } = await groupService.getActiveGroupForUser(user!.id);
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
        // ── Token penalty path ──────────────────────────────────────────────
        const allMemberIds = await groupService.getGroupMemberIds(group.id);
        const otherMemberIds = allMemberIds.filter(id => id !== user!.id);

        await tokenService.redistributePenalty(user!.id, otherMemberIds, penaltyAmount);
        ScrollDetectionService.showNotification(
          `◈ ${penaltyAmount} Tokens deducted`,
          otherMemberIds.length > 0
            ? `Penalty for ${appName} — split to ${otherMemberIds.length} member(s).`
            : `Penalty for ${appName} — tokens removed.`,
        );
        // Refresh the token balance shown in the Tokens tab
        refreshTokenBalance();
      } else {
        // ── XRP penalty path ────────────────────────────────────────────────
        const { data: members } = await groupService.getGroupMembers(group.id);
        const otherMembers = members.filter((m: any) => m.user_id !== user!.id && m.wallet_address);

        const credentials = await Keychain.getGenericPassword({ service: `xrpl-${user!.id}` });
        if (!credentials) return;

        if (otherMembers.length === 0) {
          await xrplService.sendXrp(credentials.password, DEV_WALLET, String(penaltyAmount));
          ScrollDetectionService.showNotification(
            `💸 ${penaltyAmount} XRP sent to the pot`,
            `Penalty for ${appName} — no group mates yet, sent to the house.`,
          );
        } else {
          const share = Math.floor((penaltyAmount / otherMembers.length) * 1e6) / 1e6;
          await Promise.all(
            otherMembers.map((m: any) =>
              xrplService.sendXrp(credentials.password, m.wallet_address, String(share)),
            ),
          );
          ScrollDetectionService.showNotification(
            `💸 ${penaltyAmount} XRP split to the group`,
            `Penalty for ${appName} — ${share} XRP sent to each of ${otherMembers.length} member(s).`,
          );
        }
        fetchBalance();
      }

      await groupService.recordPenalty(user!.id, group.id, penaltyAmount);
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
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
                  {tab === 'app' ? 'App Wallet' : tab === 'ledger' ? '▣  Ledger' : '◈  Tokens'}
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
              {/* Main content blurs on tap */}
              <Animated.View style={[styles.balanceCardInner, { opacity: balanceOpacity }]}>
                {/* Left: total balance */}
                <View style={styles.balanceLeft}>
                  <Text style={styles.balanceLabel}>Total Balance</Text>
                  {balance === null ? (
                    <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
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
                      style={[styles.statValue, penaltyCost > 0 && { color: Colors.error }]}
                    />
                    <Text style={styles.statLabel}>XRP Lost</Text>
                  </View>
                  <View style={styles.statItemDivider} />
                  <View style={styles.statItem}>
                    {balance !== null ? (
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
              </Animated.View>

              {/* Footer: wave + hint always mounted, cross-fade via active prop */}
              <View style={styles.addressFooterRow}>
                <Text style={styles.walletAddress} numberOfLines={1} adjustsFontSizeToFit>{user?.address || ''}</Text>
                <TouchableOpacity onPress={handleCopyAddress} activeOpacity={0.6} style={styles.copyButton}>
                  <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
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
                    <ActivityIndicator color={Colors.primary} size="small" />
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
                  <ActivityIndicator color={Colors.primary} />
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
            <View style={styles.tokenTabContent}>
              <View style={styles.tokenIconRow}>
                <Text style={styles.tokenIcon}>◈</Text>
                <Text style={styles.tokenBalanceValue}>{user?.tokens ?? '—'}</Text>
                <Text style={styles.tokenBalanceUnit}>Tokens</Text>
              </View>
              <Text style={styles.tokenDescription}>
                In-app currency · Use for staking or redeeming gifts
              </Text>
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

        {/* Gift Shop — shown only when Tokens tab is active */}
        {activeWalletTab === 'tokens' && (
          <Animated.View style={[styles.giftShopCard, { opacity: balanceAnim.opacity, transform: [{ translateY: balanceAnim.translateY }], alignSelf: 'stretch' }]}>
            <View style={styles.giftShopHeader}>
              <Text style={styles.giftShopTitle}>Gift Shop</Text>
              <View style={styles.giftShopBadge}>
                <Text style={styles.giftShopBadgeText}>COMING SOON</Text>
              </View>
            </View>
            <Text style={styles.giftShopSub}>Redeem your tokens for rewards</Text>

          </Animated.View>
        )}

        {/* Permission warnings */}
        {!usageAccessGranted && (
          <TouchableOpacity
            style={styles.permissionBox}
            onPress={() => ScrollDetectionService.openUsageAccessSettings()}
            activeOpacity={0.75}
          >
            <Text style={styles.permissionIcon}>🔍</Text>
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>Usage Access required</Text>
              <Text style={styles.permissionSub}>Tap to enable so ScrollTax can detect banned apps</Text>
            </View>
            <Text style={styles.permissionChevron}>›</Text>
          </TouchableOpacity>
        )}

        {!notifPermGranted && (
          <TouchableOpacity
            style={styles.permissionBox}
            onPress={() => {
              if (Platform.OS === 'android' && Platform.Version >= 33) {
                PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
                  .then(result => setNotifPermGranted(result === PermissionsAndroid.RESULTS.GRANTED));
              }
            }}
            activeOpacity={0.75}
          >
            <Text style={styles.permissionIcon}>🔔</Text>
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>Notifications off</Text>
              <Text style={styles.permissionSub}>Tap to enable penalty alerts</Text>
            </View>
            <Text style={styles.permissionChevron}>›</Text>
          </TouchableOpacity>
        )}

        {/* Quick Actions */}
        <Animated.View
          style={{ opacity: actionsAnim.opacity, transform: [{ translateY: actionsAnim.translateY }] }}
        >
          <View style={styles.divider} />
          <View style={styles.actionsList}>
            <TouchableOpacity
              style={styles.actionBar}
              onPress={() => navigation.navigate('Groups')}
              activeOpacity={0.75}
            >
              <Text style={[styles.actionIcon, { color: Colors.primary }]}>◉◉</Text>
              <View style={styles.actionBarText}>
                <Text style={styles.actionLabel}>My Groups</Text>
                <Text style={styles.actionSub}>View & manage</Text>
              </View>
              {hasActiveGroup && (
                <Animated.View style={[styles.activeGroupDot, { opacity: pulseAnim }]} />
              )}
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>

            <View style={styles.actionBarDivider} />

            <TouchableOpacity
              style={styles.actionBar}
              onPress={() => navigation.navigate('CreateGroup')}
              activeOpacity={0.75}
            >
              <Text style={[styles.actionIcon, { color: Colors.primary }]}>⊕</Text>
              <View style={styles.actionBarText}>
                <Text style={styles.actionLabel}>New Group</Text>
                <Text style={styles.actionSub}>Start an accountability group</Text>
              </View>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>

            <View style={styles.actionBarDivider} />

            <TouchableOpacity
              style={styles.actionBar}
              onPress={() => navigation.navigate('DistractionSettings')}
              activeOpacity={0.75}
            >
              <Text style={[styles.actionIcon, { color: Colors.primary }]}>⚙</Text>
              <View style={styles.actionBarText}>
                <Text style={styles.actionLabel}>Tracking</Text>
                <Text style={styles.actionSub}>App & threshold settings</Text>
              </View>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>

            <View style={styles.actionBarDivider} />

            <TouchableOpacity
              style={styles.actionBar}
              onPress={() => navigation.navigate('CryptoGuide')}
              activeOpacity={0.75}
            >
              <Text style={[styles.actionIcon, { color: Colors.primary }]}>⬡</Text>
              <View style={styles.actionBarText}>
                <Text style={styles.actionLabel}>Crypto Guide</Text>
                <Text style={styles.actionSub}>How blockchain & XRP work</Text>
              </View>
              <Text style={styles.actionChevron}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Telegram Session */}
          {telegramSession && (() => {
            const endsAt = new Date(
              new Date(telegramSession.created_at).getTime() + telegramSession.duration * 60 * 1000,
            );
            const minsLeft = Math.max(0, Math.round((endsAt.getTime() - Date.now()) / 60000));
            return (
              <View style={styles.tgSessionBox}>
                <View style={styles.tgSessionHeader}>
                  <Text style={styles.tgPlane}>✈️</Text>
                  <Text style={styles.tgSessionTitle}>Active Telegram Session</Text>
                  <View style={styles.tgLiveDot} />
                </View>
                <View style={styles.tgSessionRow}>
                  <View style={styles.tgStat}>
                    <Text style={styles.tgStatValue}>{minsLeft}m</Text>
                    <Text style={styles.tgStatLabel}>Time Left</Text>
                  </View>
                  <View style={styles.tgStatDivider} />
                  <View style={styles.tgStat}>
                    <Text style={styles.tgStatValue}>{telegramSession.stake}</Text>
                    <Text style={styles.tgStatLabel}>TON Stake</Text>
                  </View>
                  <View style={styles.tgStatDivider} />
                  <View style={styles.tgStat}>
                    <Text style={styles.tgStatValue}>{telegramSession.participantCount}</Text>
                    <Text style={styles.tgStatLabel}>Players</Text>
                  </View>
                </View>
                <Text style={styles.tgSessionId}>ID: {telegramSession.id.slice(0, 8)}…</Text>
              </View>
            );
          })()}

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
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Send XRP via Ledger</Text>
            <Text style={styles.modalLabel}>Destination address</Text>
            <TextInput
              style={styles.modalInput}
              value={sendDestination}
              onChangeText={setSendDestination}
              placeholder="r..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalLabel}>Amount (XRP)</Text>
            <TextInput
              style={styles.modalInput}
              value={sendAmount}
              onChangeText={setSendAmount}
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
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
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
  },
  copyButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.primary,
  },
  signOutButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.7)',
  },
  signOutText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  balanceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
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
    backgroundColor: 'rgba(42, 42, 42, 0.5)',
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
    backgroundColor: 'rgba(42, 42, 42, 0.4)',
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
    borderTopColor: 'rgba(42, 42, 42, 0.4)',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  balanceLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  balanceValue: {
    fontSize: 44,
    fontWeight: '800',
    color: Colors.primary,
    marginTop: 4,
    letterSpacing: -2,
  },
  balanceCurrency: {
    fontSize: 16,
    color: Colors.textMuted,
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
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: 5,
  },
  fiatValue: {
    fontSize: 14,
    color: Colors.textMuted,
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
    borderColor: 'rgba(42, 42, 42, 0.6)',
  },
  currencyChipActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(255, 83, 0, 0.12)',
  },
  currencyChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  currencyChipTextActive: {
    color: Colors.primary,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 1,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(42, 42, 42, 0.5)',
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  actionsList: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
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
    backgroundColor: 'rgba(42, 42, 42, 0.4)',
    marginLeft: 54,
  },
  actionBarText: {
    flex: 1,
  },
  actionChevron: {
    fontSize: 22,
    color: Colors.textMuted,
    fontWeight: '300',
    lineHeight: 24,
  },
  activeGroupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#30D158',
    marginRight: 8,
    shadowColor: '#30D158',
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
    color: Colors.text,
    letterSpacing: -0.2,
  },
  actionSub: {
    fontSize: 11,
    color: Colors.textMuted,
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
    backgroundColor: Colors.secondary,
  },
  networkText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  tgSessionBox: {
    backgroundColor: 'rgba(255, 83, 0, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.25)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  tgSessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 6,
  },
  tgPlane: {
    fontSize: 16,
  },
  tgSessionTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: -0.1,
  },
  tgLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  tgSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tgStat: {
    flex: 1,
    alignItems: 'center',
  },
  tgStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255, 83, 0, 0.2)',
  },
  tgStatValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
  },
  tgStatLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  tgSessionId: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    opacity: 0.7,
  },
  permissionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 159, 10, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 10, 0.35)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 10,
  },
  permissionIcon: {
    fontSize: 18,
  },
  permissionText: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  permissionSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  permissionChevron: {
    fontSize: 20,
    color: Colors.primary,
    opacity: 0.7,
  },

  // ─── Wallet tabs ────────────────────────────────────────────────────────────
  walletTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(42, 42, 42, 0.5)',
  },
  walletTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  walletTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  walletTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    backgroundColor: Colors.primary,
  },
  walletTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: -0.1,
  },
  walletTabTextActive: {
    color: Colors.primary,
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
    color: Colors.text,
    marginBottom: 6,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  ledgerIdleSub: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 17,
  },
  ledgerScanBtn: {
    backgroundColor: Colors.primary,
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
    color: Colors.error,
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
    color: Colors.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  ledgerTip: {
    fontSize: 11,
    color: Colors.textMuted,
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
    color: Colors.text,
  },
  ledgerDeviceConnect: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  ledgerStopText: {
    fontSize: 12,
    color: Colors.textMuted,
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
    color: Colors.primary,
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
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
    borderBottomWidth: 0,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 18,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 12,
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.7)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.text,
    fontFamily: 'monospace',
  },

  // ─── Gift Shop card ───────────────────────────────────────────────────────
  giftShopCard: {
    marginTop: 0,
    marginBottom: 28,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
  },
  giftShopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  giftShopTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  giftShopBadge: {
    backgroundColor: 'rgba(255, 83, 0, 0.12)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  giftShopBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  giftShopSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 16,
  },
  giftShopGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  giftShopItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    opacity: 0.4,
  },
  giftShopItemIcon: {
    fontSize: 22,
  },
  giftShopItemLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 0.2,
  },

  // ─── Wallet tab: active token overrides ────────────────────────────────────
  walletTabActiveToken: {
    borderBottomColor: Colors.primary,
  },
  walletTabTextActiveToken: {
    color: Colors.primary,
  },

  // ─── Tokens tab content ───────────────────────────────────────────────────
  tokenTabContent: {
    padding: 24,
    alignItems: 'center',
    minHeight: 180,
    justifyContent: 'center',
    gap: 6,
  },
  tokenIconRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  tokenIcon: {
    fontSize: 22,
    color: Colors.primary,
  },
  tokenBalanceValue: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -1,
  },
  tokenBalanceUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
    letterSpacing: -0.3,
  },
  tokenDescription: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  tokenDivider: {
    height: 1,
    backgroundColor: Colors.border,
    width: '100%',
    marginVertical: 12,
  },
  tokenComingSoonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tokenComingSoonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  tokenComingSoonBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    backgroundColor: 'rgba(255, 83, 0, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    overflow: 'hidden',
  },
});

export default DashboardScreen;
