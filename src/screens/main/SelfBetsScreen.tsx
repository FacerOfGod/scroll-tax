import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import * as Keychain from 'react-native-keychain';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../services/AuthContext';
import { xrplService } from '../../services/XrplService';
import {
  selfBetService,
  PROVIDER_META,
  SelfBet,
  BetProgress,
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

const SelfBetsScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user, refreshTokenBalance } = useAuth();

  const [bets, setBets] = useState<SelfBet[]>([]);
  const [progress, setProgress] = useState<Record<string, BetProgress>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await selfBetService.listMyBets();
    setBets(list);
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

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Settle a bet (wins early if the goal is met, loses if the deadline passed).
  const check = async (bet: SelfBet) => {
    setChecking(bet.id);
    const res = await selfBetService.settleBet(bet.id);
    setChecking(null);

    if (!res.ok) {
      Alert.alert('Check failed', res.error || 'Try again.');
      return;
    }

    if (res.settled) {
      // XRP loss: the device sends the forfeit on-chain itself.
      if (res.xrp_forfeit && user) {
        try {
          const creds = await Keychain.getGenericPassword({ service: `xrpl-${user.id}` });
          if (creds) {
            await xrplService.sendXrp(
              creds.password, res.xrp_forfeit.dest, String(res.xrp_forfeit.amount),
            );
          }
        } catch (e) {
          console.warn('XRP forfeit send failed:', e);
        }
      }
      if (res.status === 'won' && bet.stake_type === 'tokens') await refreshTokenBalance();
      Alert.alert(
        res.status === 'won' ? '🎉 You won!' : 'Bet lost',
        res.status === 'won'
          ? 'Goal reached — your stake is back.'
          : 'The deadline passed without hitting the goal. Stake forfeited.',
      );
    } else {
      const p = res.progress ?? 0;
      Alert.alert('Still going', `${p}/${bet.target_count} ${bet.metric}. ${fmtRemaining(bet.period_end)}.`);
    }
    setProgress(prev => ({ ...prev, [bet.id]: res }));
    load();
  };

  const renderBet = (bet: SelfBet) => {
    const meta = PROVIDER_META[bet.provider];
    const p = progress[bet.id];
    const current = p?.progress ?? (bet.final_value != null ? bet.final_value - bet.baseline : 0);
    const pct = Math.max(0, Math.min(1, current / bet.target_count));
    const statusColor =
      bet.status === 'won' ? colors.secondary : bet.status === 'lost' ? colors.error : colors.primary;

    return (
      <View key={bet.id} style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardIcon}>{meta.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>
              {bet.target_count} {meta.metricNoun}
            </Text>
            <Text style={styles.cardSub}>{meta.label}</Text>
          </View>
          <View style={[styles.badge, { borderColor: statusColor }]}>
            <Text style={[styles.badgeText, { color: statusColor }]}>{bet.status.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: statusColor }]} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            {Math.max(0, Math.floor(current))}/{bet.target_count} {meta.metricNoun}
          </Text>
          <Text style={styles.metaText}>
            {bet.status === 'active' ? fmtRemaining(bet.period_end) : `${bet.stake_amount} ${bet.stake_type === 'xrp' ? 'XRP' : '◈'}`}
          </Text>
        </View>

        <View style={styles.stakeRow}>
          <Text style={styles.stakeLabel}>
            Stake: {bet.stake_amount} {bet.stake_type === 'xrp' ? 'XRP' : 'Tokens'}
          </Text>
          {bet.status === 'active' && (
            <TouchableOpacity
              style={styles.checkBtn}
              onPress={() => check(bet)}
              disabled={checking === bet.id}
            >
              {checking === bet.id ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.checkBtnText}>Check now</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>{'<'}</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.title}>Self Bets</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('ConnectedAccounts')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.headerLink}>Accounts</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('CreateSelfBet')}>
          <Text style={styles.newBtnText}>⊕  New Self Bet</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : bets.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No bets yet</Text>
            <Text style={styles.emptyText}>
              Wager on your own GitHub commits, Strava runs, Chess.com wins or LeetCode solves.
            </Text>
          </View>
        ) : (
          bets.map(renderBet)
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 16,
      marginBottom: 8,
    },
    back: { color: colors.textMuted, fontSize: 16 },
    headerLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    titleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    title: { fontSize: 20, fontWeight: '700', color: colors.text },
    content: { padding: 24, paddingBottom: 40, gap: 14 },
    newBtn: {
      backgroundColor: colors.primary,
      height: 52,
      borderRadius: 9999,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    newBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 12,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardIcon: { fontSize: 22, color: colors.primary, width: 28, textAlign: 'center' },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    cardSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    badge: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    progressTrack: {
      height: 8,
      borderRadius: 9999,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    progressFill: { height: 8, borderRadius: 9999 },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
    metaText: { color: colors.textMuted, fontSize: 12 },
    stakeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    stakeLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
    checkBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 9999,
    },
    checkBtnText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 28,
      gap: 10,
      alignItems: 'center',
      marginTop: 10,
    },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  });

export default SelfBetsScreen;
