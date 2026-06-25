import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Keychain from 'react-native-keychain';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../services/AuthContext';
import {
  selfBetService,
  PROVIDER_META,
  SelfBetProvider,
  ConnectedAccount,
} from '../../services/SelfBetService';

const DAY_PRESETS = [1, 3, 7, 14];
const STAKE_PRESETS = { tokens: [10, 20, 50, 100], xrp: [1, 5, 10, 25] } as const;

const CreateSelfBetScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user, refreshTokenBalance } = useAuth();

  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [provider, setProvider] = useState<SelfBetProvider | null>(null);
  const [target, setTarget] = useState('5');
  const [days, setDays] = useState('7');
  const [stake, setStake] = useState('20');
  const [stakeType, setStakeType] = useState<'tokens' | 'xrp'>('tokens');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    selfBetService.listAccounts().then(data => {
      setAccounts(data);
      if (data.length > 0) setProvider(data[0].provider);
      setLoadingAccounts(false);
    });
  }, []);

  const meta = provider ? PROVIDER_META[provider] : null;

  const handleSubmit = async () => {
    if (!provider) {
      Alert.alert('Pick an account', 'Connect and select an account to bet on.');
      return;
    }
    const targetNum = parseInt(target, 10);
    const daysNum = parseFloat(days);
    const stakeNum = parseFloat(stake);
    if (!(targetNum > 0)) return Alert.alert('Invalid target', 'Enter a goal greater than 0.');
    if (!(daysNum > 0)) return Alert.alert('Invalid duration', 'Enter a duration greater than 0.');
    if (!(stakeNum > 0)) return Alert.alert('Invalid stake', 'Enter a stake greater than 0.');
    if (stakeType === 'xrp' && !user?.address) {
      return Alert.alert('Wallet error', 'No XRPL wallet found. Sign out and back in.');
    }

    setSubmitting(true);
    const res = await selfBetService.createSelfBet({
      provider,
      target: targetNum,
      periodDays: daysNum,
      stakeAmount: stakeNum,
      stakeType,
      walletAddress: stakeType === 'xrp' ? user?.address : null,
    });

    if (!res.ok) {
      setSubmitting(false);
      Alert.alert(
        'Could not place bet',
        res.error === 'insufficient_tokens'
          ? 'You don\'t have enough tokens for this stake.'
          : res.error || 'Try again.',
      );
      return;
    }

    // XRP bets escrow the stake into the treasury now (Gate 0C) — send it on-chain
    // and confirm before the bet counts as funded.
    if (res.needs_deposit && res.bet_id) {
      const creds = user
        ? await Keychain.getGenericPassword({ service: `xrpl-${user.id}` })
        : null;
      if (!creds) {
        setSubmitting(false);
        return Alert.alert(
          'Wallet key missing',
          'The bet was created but not funded. Open it from Self Bets to complete the deposit.',
        );
      }
      const dep = await selfBetService.depositEscrow(creds.password, res.bet_id, String(stakeNum));
      setSubmitting(false);
      if (!dep.ok) {
        return Alert.alert(
          'Deposit failed',
          `${dep.error ?? 'Try again.'}\n\nThe bet was created but isn't funded yet — open it from Self Bets to retry the deposit.`,
        );
      }
      Alert.alert('Bet funded', 'Your XRP stake is escrowed. Hit your goal before the deadline to get it back.');
      navigation.goBack();
      return;
    }

    // Token bet — stake already locked server-side.
    setSubmitting(false);
    await refreshTokenBalance();
    Alert.alert('Bet placed', 'Stake locked. Hit your goal before the deadline to win it back.');
    navigation.goBack();
  };

  if (loadingAccounts) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.back}>{'<'}</Text>
            </TouchableOpacity>
            <View style={styles.titleWrap} pointerEvents="none">
              <Text style={styles.title}>Bet on Yourself</Text>
            </View>
            <View style={{ width: 56 }} />
          </View>

          {accounts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No accounts connected</Text>
              <Text style={styles.emptyText}>
                Connect a GitHub, Strava, Chess.com or LeetCode account to bet on your own progress.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.navigate('ConnectedAccounts')}
              >
                <Text style={styles.primaryBtnText}>Connect an account</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Account</Text>
                <View style={styles.chipRow}>
                  {accounts.map(a => {
                    const m = PROVIDER_META[a.provider];
                    const active = provider === a.provider;
                    return (
                      <TouchableOpacity
                        key={a.provider}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setProvider(a.provider)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {m.icon}  {m.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Goal ({meta?.metricNoun})</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={target}
                  onChangeText={setTarget}
                  placeholder="5"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.hint}>
                  Reach {target || 'N'} {meta?.metricNoun} within the window to win your stake back.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Deadline (days)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={days}
                  onChangeText={setDays}
                  placeholder="7"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.presetRow}>
                  {DAY_PRESETS.map(d => (
                    <TouchableOpacity key={d} style={styles.preset} onPress={() => setDays(String(d))}>
                      <Text style={styles.presetText}>{d}d</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Stake</Text>
                <View style={styles.stakeTypeRow}>
                  {(['tokens', 'xrp'] as const).map(type => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.stakeTypeBtn, stakeType === type && styles.stakeTypeBtnActive]}
                      onPress={() => setStakeType(type)}
                    >
                      <Text style={[styles.stakeTypeBtnText, stakeType === type && styles.stakeTypeBtnTextActive]}>
                        {type === 'xrp' ? '⬡  XRP' : '◈  Tokens'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[styles.input, { marginTop: 10 }]}
                  keyboardType="decimal-pad"
                  value={stake}
                  onChangeText={setStake}
                  placeholder="20"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.presetRow}>
                  {STAKE_PRESETS[stakeType].map(s => (
                    <TouchableOpacity key={s} style={styles.preset} onPress={() => setStake(String(s))}>
                      <Text style={styles.presetText}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Live payoff summary */}
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Goal</Text>
                  <Text style={styles.summaryValue}>
                    {target || '—'} {meta?.metricNoun} in {days || '—'} day{days === '1' ? '' : 's'}
                  </Text>
                </View>
                <View style={styles.summarySep} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>You stake</Text>
                  <Text style={styles.summaryValue}>
                    {stake || '—'} {stakeType === 'xrp' ? 'XRP' : 'Tokens'}
                  </Text>
                </View>
                <View style={styles.summarySep} />
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.secondary }]}>If you win</Text>
                  <Text style={[styles.summaryValue, { color: colors.secondary }]}>Stake back</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.error }]}>If you miss</Text>
                  <Text style={[styles.summaryValue, { color: colors.error }]}>Stake forfeited</Text>
                </View>
                <Text style={styles.summaryFootnote}>
                  {stakeType === 'tokens'
                    ? 'Your stake is locked now and returns to your balance the moment you hit the goal.'
                    : 'Your stake is escrowed to the app treasury now and refunded to your wallet when you hit the goal.'}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Place Bet</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: 24, paddingBottom: 40 },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 8,
      marginBottom: 28,
    },
    back: { color: colors.textMuted, fontSize: 16 },
    titleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    title: { fontSize: 20, fontWeight: '700', color: colors.text },
    form: { gap: 22 },
    inputGroup: { gap: 8 },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      marginLeft: 4,
    },
    hint: { color: colors.textMuted, fontSize: 12, marginLeft: 4 },
    input: {
      backgroundColor: colors.surface,
      height: 56,
      borderRadius: 14,
      paddingHorizontal: 16,
      color: colors.text,
      fontSize: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    chip: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
    chipTextActive: { color: '#FFF' },
    presetRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    preset: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    presetText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    stakeTypeRow: { flexDirection: 'row', gap: 10 },
    stakeTypeBtn: {
      flex: 1,
      height: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stakeTypeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    stakeTypeBtnText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    stakeTypeBtnTextActive: { color: '#FFF' },
    summaryCard: {
      backgroundColor: 'rgba(255, 83, 0, 0.08)',
      padding: 16,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(255, 83, 0, 0.25)',
      gap: 10,
    },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    summaryLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
    summaryValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
    summarySep: { height: 1, backgroundColor: 'rgba(255, 83, 0, 0.18)' },
    summaryFootnote: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 4,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: 'rgba(255, 83, 0, 0.18)',
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      height: 58,
      borderRadius: 9999,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
    },
    primaryBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      gap: 12,
      alignItems: 'center',
      marginTop: 20,
    },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  });

export default CreateSelfBetScreen;
