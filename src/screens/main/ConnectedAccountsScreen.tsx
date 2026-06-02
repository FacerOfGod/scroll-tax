import React, { useState, useEffect, useCallback } from 'react';
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
  Linking,
  DeviceEventEmitter,
} from 'react-native';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabaseClient';
import {
  selfBetService,
  PROVIDER_META,
  SelfBetProvider,
  ConnectedAccount,
  ACCOUNT_CONNECTED_EVENT,
} from '../../services/SelfBetService';
import { STRAVA_CLIENT_ID } from '@env';

const PROVIDERS: SelfBetProvider[] = ['github', 'strava', 'chesscom', 'leetcode'];

const ConnectedAccountsScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [openInput, setOpenInput] = useState<SelfBetProvider | null>(null);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [busy, setBusy] = useState<SelfBetProvider | null>(null);

  const loadAccounts = useCallback(async () => {
    const data = await selfBetService.listAccounts();
    setAccounts(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
    // Refresh after an OAuth round-trip completes (handled in AuthContext).
    const sub = DeviceEventEmitter.addListener(ACCOUNT_CONNECTED_EVENT, () => {
      setBusy(null);
      loadAccounts();
    });
    const focusSub = navigation.addListener('focus', loadAccounts);
    return () => {
      sub.remove();
      focusSub();
    };
  }, [loadAccounts, navigation]);

  const connectedFor = (p: SelfBetProvider) => accounts.find(a => a.provider === p);

  const connectUsername = async (provider: SelfBetProvider) => {
    const username = usernameDraft.trim();
    if (!username) {
      Alert.alert('Username required', 'Enter your username to connect.');
      return;
    }
    setBusy(provider);
    const res = await selfBetService.connectAccount(provider, { username });
    setBusy(null);
    if (res.ok) {
      setOpenInput(null);
      setUsernameDraft('');
      loadAccounts();
    } else {
      Alert.alert(
        'Could not connect',
        res.error === 'username_not_found'
          ? `No ${PROVIDER_META[provider].label} user named "${username}".`
          : res.error || 'Try again.',
      );
    }
  };

  const connectOAuth = async (provider: SelfBetProvider) => {
    setBusy(provider);
    try {
      if (provider === 'github') {
        const { data, error } = await supabase.auth.linkIdentity({
          provider: 'github',
          options: {
            redirectTo: 'scrolltax://github-callback',
            skipBrowserRedirect: true,
            scopes: 'read:user',
          },
        });
        if (error || !data?.url) throw error || new Error('No OAuth URL');
        await Linking.openURL(data.url);
      } else if (provider === 'strava') {
        if (!STRAVA_CLIENT_ID) {
          Alert.alert('Not configured', 'STRAVA_CLIENT_ID is missing from the app config.');
          setBusy(null);
          return;
        }
        const url =
          'https://www.strava.com/oauth/mobile/authorize' +
          `?client_id=${STRAVA_CLIENT_ID}` +
          '&redirect_uri=scrolltax://strava-callback' +
          '&response_type=code&approval_prompt=auto&scope=activity:read';
        await Linking.openURL(url);
      }
      // busy is cleared by the ACCOUNT_CONNECTED_EVENT listener on return.
    } catch (e: any) {
      setBusy(null);
      Alert.alert('Connection failed', e?.message || 'Could not start the connection.');
    }
  };

  const disconnect = (provider: SelfBetProvider) => {
    Alert.alert('Disconnect', `Disconnect your ${PROVIDER_META[provider].label} account?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await selfBetService.disconnectAccount(provider);
          loadAccounts();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>{'<'}</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.title}>Connected Accounts</Text>
        </View>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Link an account to bet on your own progress. No API keys — connect with one tap (GitHub,
          Strava) or your public username (Chess.com, LeetCode).
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          PROVIDERS.map(provider => {
            const meta = PROVIDER_META[provider];
            const acct = connectedFor(provider);
            const isBusy = busy === provider;
            return (
              <View key={provider} style={styles.card}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardIcon}>{meta.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{meta.label}</Text>
                    <Text style={styles.cardSub}>
                      {acct
                        ? `@${acct.external_username ?? 'connected'} · ${meta.metricNoun}`
                        : `Bet on your ${meta.metricNoun}`}
                    </Text>
                  </View>
                  {acct ? (
                    <TouchableOpacity style={styles.disconnectBtn} onPress={() => disconnect(provider)}>
                      <Text style={styles.disconnectText}>Disconnect</Text>
                    </TouchableOpacity>
                  ) : isBusy ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <TouchableOpacity
                      style={styles.connectBtn}
                      onPress={() =>
                        meta.connect === 'oauth'
                          ? connectOAuth(provider)
                          : (setOpenInput(openInput === provider ? null : provider), setUsernameDraft(''))
                      }
                    >
                      <Text style={styles.connectText}>
                        {meta.connect === 'oauth' ? 'Connect' : openInput === provider ? 'Cancel' : 'Add username'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {openInput === provider && !acct && (
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      placeholder={`${meta.label} username`}
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={usernameDraft}
                      onChangeText={setUsernameDraft}
                      onSubmitEditing={() => connectUsername(provider)}
                      returnKeyType="done"
                    />
                    <TouchableOpacity
                      style={styles.saveBtn}
                      onPress={() => connectUsername(provider)}
                      disabled={isBusy}
                    >
                      {isBusy ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.saveText}>Link</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
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
    titleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    title: { fontSize: 20, fontWeight: '700', color: colors.text },
    content: { padding: 24, paddingBottom: 40, gap: 14 },
    intro: { color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 4 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    cardIcon: { fontSize: 22, color: colors.primary, width: 28, textAlign: 'center' },
    cardLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
    cardSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    connectBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 9999,
    },
    connectText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
    disconnectBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 9999,
    },
    disconnectText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    inputRow: { flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'center' },
    input: {
      flex: 1,
      backgroundColor: colors.background,
      height: 48,
      borderRadius: 12,
      paddingHorizontal: 14,
      color: colors.text,
      fontSize: 15,
      borderWidth: 1,
      borderColor: colors.border,
    },
    saveBtn: {
      backgroundColor: colors.primary,
      height: 48,
      paddingHorizontal: 20,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  });

export default ConnectedAccountsScreen;
