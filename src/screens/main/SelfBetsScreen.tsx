import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import * as Keychain from 'react-native-keychain';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../services/AuthContext';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';
import {
  selfBetService,
  PROVIDER_META,
  SelfBet,
  BetProgress,
  ConnectedAccount,
} from '../../services/SelfBetService';

const fmtRemaining = (endIso: string) => {
  const ms = new Date(endIso).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
};

// Soft tinted pill palette (matches the status pills used across Groups / Dashboard).
const STATUS_TINT = {
  active: { bg: 'rgba(255, 83, 0, 0.15)', border: 'rgba(255, 83, 0, 0.35)' },
  won: { bg: 'rgba(48, 209, 88, 0.15)', border: 'rgba(48, 209, 88, 0.35)' },
  lost: { bg: 'rgba(255, 69, 58, 0.15)', border: 'rgba(255, 69, 58, 0.35)' },
} as const;

const SelfBetsScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user, refreshTokenBalance } = useAuth();

  const [bets, setBets] = useState<SelfBet[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [progress, setProgress] = useState<Record<string, BetProgress>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);

  const headerAnim = useEntranceAnimation(0);
  const listAnim = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    const [list, accts] = await Promise.all([
      selfBetService.listMyBets(),
      selfBetService.listAccounts(),
    ]);
    setBets(list);
    setAccounts(accts);
    // Pull live progress for active bets (usually just a few).
    const active = list.filter(b => b.status === 'active');
    const entries = await Promise.all(
      active.map(async b => [b.id, await selfBetService.getProgress(b.id)] as const),
    );
    setProgress(prev => {
      const next = { ...prev };
      for (const [id, p] of entries) next[id] = p;
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const focusSub = navigation.addListener('focus', load);
    return () => focusSub();
  }, [load, navigation]);

  // Fade the list in once data is ready (matches Groups).
  useEffect(() => {
    if (!loading) {
      Animated.timing(listAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [loading, listAnim]);

  const onRefresh = async () => {
    setRefreshing(true);
    listAnim.setValue(0);
    await load();
    setRefreshing(false);
  };

  // Fund an XRP bet's escrow deposit into the treasury (also used to retry a deposit
  // that failed at create time).
  const completeDeposit = async (bet: SelfBet) => {
    if (!user) return;
    setChecking(bet.id);
    const creds = await Keychain.getGenericPassword({ service: `xrpl-${user.id}` });
    if (!creds) {
      setChecking(null);
      Alert.alert('Wallet key missing', 'Sign out and back in, then try again.');
      return;
    }
    const dep = await selfBetService.depositEscrow(creds.password, bet.id, String(bet.stake_amount));
    setChecking(null);
    if (!dep.ok) {
      Alert.alert('Deposit failed', dep.error ?? 'Try again.');
      return;
    }
    Alert.alert('Bet funded', 'Your XRP stake is escrowed.');
    load();
  };

  // Settle a bet (wins early if the goal is met, loses if the deadline passed). XRP
  // settlement is server-driven from the treasury — the device never sends funds.
  const check = async (bet: SelfBet) => {
    setChecking(bet.id);
    const res = await selfBetService.settleBet(bet.id);
    setChecking(null);

    if (!res.ok) {
      Alert.alert('Check failed', res.error || 'Try again.');
      return;
    }

    if (res.awaiting_deposit) {
      Alert.alert('Deposit needed', 'This XRP bet isn\'t funded yet. Tap "Fund deposit" to activate it.');
    } else if (res.settled) {
      const won = res.status === 'won';
      if (won && bet.stake_type === 'tokens') await refreshTokenBalance();
      let msg: string;
      if (!won) {
        msg = 'The deadline passed without hitting the goal. Stake forfeited.';
      } else if (bet.stake_type !== 'xrp') {
        msg = 'Goal reached — your stake is back.';
      } else if (res.refund?.ok) {
        msg = 'Goal reached — your XRP stake was refunded on-chain.';
      } else {
        msg = 'Goal reached — your XRP refund is processing and will arrive shortly.';
      }
      Alert.alert(won ? '🎉 You won!' : 'Bet lost', msg);
    } else {
      const p = res.progress ?? 0;
      Alert.alert('Still going', `${p}/${bet.target_count} ${bet.metric}. ${fmtRemaining(bet.period_end)}.`);
    }
    setProgress(prev => ({ ...prev, [bet.id]: res }));
    load();
  };

  const handleNewBet = () => {
    // Guide users without a linked account straight to connecting one, rather than
    // letting them open the create form only to hit a dead end.
    navigation.navigate(accounts.length === 0 ? 'ConnectedAccounts' : 'CreateSelfBet');
  };

  const renderBet = (bet: SelfBet) => {
    const meta = PROVIDER_META[bet.provider];
    const p = progress[bet.id];
    const needsDeposit =
      bet.status === 'active' && bet.stake_type === 'xrp' && bet.escrow_status === 'pending';
    const current = p?.progress ?? (bet.final_value != null ? bet.final_value - bet.baseline : 0);
    const shown = Math.max(0, Math.floor(current));
    const pct = Math.max(0, Math.min(1, current / bet.target_count));
    const tint = STATUS_TINT[bet.status];
    const statusColor =
      bet.status === 'won' ? colors.secondary : bet.status === 'lost' ? colors.error : colors.primary;

    return (
      <View key={bet.id} style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.iconChip}>
            <Text style={styles.cardIcon}>{meta.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {bet.target_count} {meta.metricNoun}
            </Text>
            <Text style={styles.cardSub}>{meta.label}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: tint.bg, borderColor: tint.border }]}>
            <Text style={[styles.badgeText, { color: statusColor }]}>{bet.status.toUpperCase()}</Text>
          </View>
        </View>

        {needsDeposit && (
          <View style={styles.depositNotice}>
            <Text style={styles.depositNoticeText}>
              Stake not funded yet — fund the deposit to activate this bet.
            </Text>
          </View>
        )}

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: statusColor }]} />
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaText, { color: statusColor, fontWeight: '700' }]}>
            {shown}/{bet.target_count} {meta.metricNoun}
          </Text>
          <Text style={styles.metaText}>
            {bet.status === 'active' ? fmtRemaining(bet.period_end) : bet.status === 'won' ? 'Goal reached' : 'Deadline missed'}
          </Text>
        </View>

        <View style={styles.stakeRow}>
          <View style={styles.stakeBlock}>
            <Text style={styles.stakeLabel}>Stake</Text>
            <Text style={styles.stakeValue}>
              {bet.stake_amount} {bet.stake_type === 'xrp' ? 'XRP' : '◈ Tokens'}
            </Text>
          </View>
          {bet.status === 'active' && (
            <TouchableOpacity
              style={[styles.checkBtn, needsDeposit && styles.fundBtn]}
              onPress={() => (needsDeposit ? completeDeposit(bet) : check(bet))}
              disabled={checking === bet.id}
              activeOpacity={0.8}
            >
              {checking === bet.id ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.checkBtnText}>{needsDeposit ? 'Fund deposit' : 'Check now'}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const activeBets = bets.filter(b => b.status === 'active');
  const settledBets = bets.filter(b => b.status !== 'active');
  const wonCount = bets.filter(b => b.status === 'won').length;
  const lostCount = bets.filter(b => b.status === 'lost').length;

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View
        style={[
          styles.header,
          { opacity: headerAnim.opacity, transform: [{ translateY: headerAnim.translateY }] },
        ]}
      >
        <View style={{ width: 72 }} />
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.title}>Self Bets</Text>
        </View>
        <TouchableOpacity
          style={styles.accountsBtn}
          onPress={() => navigation.navigate('ConnectedAccounts')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Text style={styles.accountsBtnText}>Accounts</Text>
        </TouchableOpacity>
      </Animated.View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <Animated.ScrollView
          contentContainerStyle={styles.content}
          style={{ opacity: listAnim }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          {bets.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>◎</Text>
              <Text style={styles.emptyTitle}>
                {accounts.length === 0 ? 'Connect an account' : 'No bets yet'}
              </Text>
              <Text style={styles.emptyText}>
                {accounts.length === 0
                  ? 'Link a GitHub, Strava, Chess.com or LeetCode account, then wager on your own progress.'
                  : 'Wager on your own GitHub commits, Strava runs, Chess.com wins or LeetCode solves — hit the goal in time to win your stake back.'}
              </Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={handleNewBet} activeOpacity={0.85}>
                <Text style={styles.emptyBtnText}>
                  {accounts.length === 0 ? 'Connect an account' : 'Place your first bet'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Overview */}
              <View style={styles.summaryCard}>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{activeBets.length}</Text>
                  <Text style={styles.summaryLabel}>Active</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={[styles.summaryValue, wonCount > 0 && { color: colors.secondary }]}>
                    {wonCount}
                  </Text>
                  <Text style={styles.summaryLabel}>Won</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={[styles.summaryValue, lostCount > 0 && { color: colors.error }]}>
                    {lostCount}
                  </Text>
                  <Text style={styles.summaryLabel}>Lost</Text>
                </View>
              </View>

              {activeBets.length > 0 && (
                <>
                  <Text style={styles.sectionHeader}>Active</Text>
                  {activeBets.map(renderBet)}
                </>
              )}
              {settledBets.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, styles.sectionHeaderMuted]}>Settled</Text>
                  {settledBets.map(renderBet)}
                </>
              )}
            </>
          )}
        </Animated.ScrollView>
      )}

      <TouchableOpacity style={styles.fab} onPress={handleNewBet} activeOpacity={0.85}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 16,
    },
    titleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    title: { fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
    accountsBtn: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    accountsBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { padding: 16, paddingBottom: 110, gap: 14 },

    // Summary
    summaryCard: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 16,
      marginBottom: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 3,
    },
    summaryStat: { flex: 1, alignItems: 'center', gap: 4 },
    summaryValue: { fontSize: 24, fontWeight: '800', color: colors.primary, letterSpacing: -0.5 },
    summaryLabel: {
      fontSize: 10,
      color: colors.textMuted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    summaryDivider: { width: 1, backgroundColor: colors.border, marginVertical: 4 },

    // Section headers (match Groups)
    sectionHeader: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.secondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginTop: 8,
      marginBottom: 2,
      marginLeft: 4,
    },
    sectionHeaderMuted: { color: colors.textMuted, marginTop: 16 },

    // Bet card
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 3,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconChip: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: 'rgba(255, 83, 0, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(255, 83, 0, 0.25)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardIcon: { fontSize: 20, color: colors.primary },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
    cardSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    depositNotice: {
      backgroundColor: 'rgba(255, 159, 10, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(255, 159, 10, 0.3)',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    depositNoticeText: { color: colors.warning, fontSize: 12, fontWeight: '600', lineHeight: 17 },
    progressTrack: {
      height: 8,
      borderRadius: 9999,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    progressFill: { height: 8, borderRadius: 9999 },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    metaText: { color: colors.textMuted, fontSize: 12 },
    stakeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    stakeBlock: { gap: 2 },
    stakeLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    stakeValue: { color: colors.text, fontSize: 15, fontWeight: '700' },
    checkBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 9999,
      minWidth: 104,
      alignItems: 'center',
    },
    fundBtn: { backgroundColor: colors.warning },
    checkBtnText: { color: '#FFF', fontWeight: '700', fontSize: 13 },

    // Empty
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 28,
      gap: 12,
      alignItems: 'center',
      marginTop: 40,
    },
    emptyIcon: { fontSize: 44, color: colors.primary, marginBottom: 2 },
    emptyTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21 },
    emptyBtn: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 24,
      alignItems: 'center',
      alignSelf: 'stretch',
      marginTop: 6,
    },
    emptyBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

    // FAB (matches Groups)
    fab: {
      position: 'absolute',
      bottom: 32,
      right: 24,
      backgroundColor: colors.primary,
      width: 58,
      height: 58,
      borderRadius: 29,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: colors.primary,
      shadowOpacity: 0.45,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
      elevation: 7,
    },
    fabText: { color: '#FFF', fontSize: 30, fontWeight: '300', lineHeight: 32, marginTop: -2 },
  });

export default SelfBetsScreen;
