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
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../theme/colors';
import { useAuth } from '../../services/AuthContext';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../../services/supabaseClient';
import { xrplService } from '../../services/XrplService';
import { groupService } from '../../services/GroupService';
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

interface TelegramSession {
  id: string;
  duration: number;
  stake: number;
  created_at: string;
  participantCount: number;
  banned_apps: string[];
}

const DashboardScreen = ({ navigation }: any) => {
  const { user, signOut } = useAuth();
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

    const { data: members } = await groupService.getGroupMembers(group.id);
    const otherMembers = members.filter((m: any) => m.user_id !== user!.id && m.wallet_address);

    const credentials = await Keychain.getGenericPassword({ service: `xrpl-${user!.id}` });
    if (!credentials) return;

    try {
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

      await groupService.recordPenalty(user!.id, group.id, penaltyAmount);
      fetchBalance();
    } catch (e: any) {
      setPenaltyCount(prev => prev - 1);
      setPenaltyCost(prev => prev - penaltyAmount);
      pendingPenalties.current.pop();
      Alert.alert('Payment Failed', e?.message || 'Could not send XRP penalty.');
    }
  };
  handlePenaltyRef.current = handlePenaltyTriggered;

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
            <Logo size="sm" showWordmark direction="horizontal" />
            <View style={styles.addressRow}>
              <Text style={styles.walletAddress}>{truncateAddress(user?.address || '')}</Text>
              <TouchableOpacity onPress={handleCopyAddress} activeOpacity={0.6} style={styles.copyButton}>
                <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
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
            <View style={styles.cardFooter}>
              <PixelWave active={isRefreshingBalance} />
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Market Chart */}
        {chartData && xrpPrices && (
          <Animated.View style={{ opacity: balanceAnim.opacity, transform: [{ translateY: balanceAnim.translateY }] }}>
            <MiniPriceChart
              prices={chartData.prices}
              change24h={chartData.change24h}
              currentPrice={xrpPrices[currency]}
              currency={currency}
            />
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
    marginHorizontal: 20,
  },
  balanceRight: {
    flex: 1,
    justifyContent: 'space-between',
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
    color: Colors.warning,
  },
  permissionSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  permissionChevron: {
    fontSize: 20,
    color: Colors.warning,
    opacity: 0.7,
  },
});

export default DashboardScreen;
