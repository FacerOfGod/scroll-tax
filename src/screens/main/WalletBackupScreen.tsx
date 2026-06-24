import React, { useState } from 'react';
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
import Clipboard from '@react-native-clipboard/clipboard';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../services/AuthContext';
import { xrplService } from '../../services/XrplService';
import { supabase } from '../../services/supabaseClient';

// Wallet backup & recovery (Gate 0F). XRPL seeds live ONLY in the device Keychain, so
// without a backup a lost/reset device means lost funds. This screen lets the user
// reveal their secret recovery key to store it safely, and restore a wallet from a
// previously-saved key on a new device.
const WalletBackupScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { user } = useAuth();

  const [seed, setSeed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);

  const [importSeed, setImportSeed] = useState('');
  const [importing, setImporting] = useState(false);

  const reveal = async () => {
    if (!user) return;
    setRevealing(true);
    try {
      const creds = await Keychain.getGenericPassword({ service: `xrpl-${user.id}` });
      if (!creds) {
        Alert.alert('No key found', 'No wallet key is stored on this device.');
        return;
      }
      setSeed(creds.password);
    } catch {
      Alert.alert('Could not read key', 'Try again.');
    } finally {
      setRevealing(false);
    }
  };

  const copySeed = () => {
    if (!seed) return;
    Clipboard.setString(seed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const restore = async () => {
    if (!user) return;
    const candidate = importSeed.trim();
    if (!candidate) {
      return Alert.alert('Enter a key', 'Paste the recovery key you saved.');
    }
    const derived = xrplService.walletFromSeed(candidate);
    if (!derived) {
      return Alert.alert('Invalid key', 'That is not a valid XRPL recovery key.');
    }
    if (derived.address === user.address) {
      return Alert.alert('Already active', 'That key already matches this device\'s wallet.');
    }

    Alert.alert(
      'Replace this device\'s wallet?',
      `This switches the app to wallet ${derived.address}. Make sure you've backed up the current wallet's key first — it won't be recoverable on this device afterward.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setImporting(true);
            try {
              await Keychain.setGenericPassword(derived.address, candidate, {
                service: `xrpl-${user.id}`,
              });
              const { error } = await supabase.auth.updateUser({ data: { address: derived.address } });
              if (error) throw error;
              setImportSeed('');
              Alert.alert(
                'Wallet restored',
                'Your wallet was restored on this device. If the address doesn\'t update everywhere, sign out and back in.',
                [{ text: 'OK', onPress: () => navigation.goBack() }],
              );
            } catch (e: any) {
              Alert.alert('Restore failed', e?.message ?? 'Try again.');
            } finally {
              setImporting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={styles.hitSlop}>
              <Text style={styles.back}>{'<'}</Text>
            </TouchableOpacity>
            <View style={styles.titleWrap} pointerEvents="none">
              <Text style={styles.title}>Wallet Backup</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          {/* ── Back up ── */}
          <View style={styles.section}>
            <Text style={styles.label}>Recovery key</Text>
            <Text style={styles.hint}>
              Your wallet's secret key lives only on this device. Save it somewhere safe and
              offline — it's the only way to recover your funds if you lose or reset this phone.
            </Text>

            {seed ? (
              <>
                <View style={styles.seedBox}>
                  <Text style={styles.seedText} selectable>{seed}</Text>
                </View>
                <View style={styles.warnBox}>
                  <Text style={styles.warnText}>
                    ⚠  Anyone with this key controls your funds. Never share it or enter it on a
                    website. ScrollTax support will never ask for it.
                  </Text>
                </View>
                <TouchableOpacity style={styles.secondaryBtn} onPress={copySeed} activeOpacity={0.7}>
                  <Text style={styles.secondaryBtnText}>{copied ? 'Copied' : 'Copy key'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setSeed(null)} activeOpacity={0.7}>
                  <Text style={styles.ghostBtnText}>Hide</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, revealing && styles.btnDisabled]}
                onPress={reveal}
                disabled={revealing}
              >
                {revealing ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Reveal recovery key</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* ── Restore ── */}
          <View style={styles.section}>
            <Text style={styles.label}>Restore a wallet</Text>
            <Text style={styles.hint}>
              Paste a recovery key you saved earlier to use that wallet on this device. This
              replaces the wallet currently on this device.
            </Text>
            <TextInput
              style={styles.input}
              value={importSeed}
              onChangeText={setImportSeed}
              placeholder="sEd…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.primaryBtn, importing && styles.btnDisabled]}
              onPress={restore}
              disabled={importing}
            >
              {importing ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Restore wallet</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },
    content: { padding: 24, paddingBottom: 40 },
    hitSlop: { top: 10, bottom: 10, left: 10, right: 10 },
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
    headerSpacer: { width: 56 },
    section: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 20,
      gap: 12,
      marginBottom: 18,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    hint: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
    seedBox: {
      backgroundColor: colors.background,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    seedText: { color: colors.text, fontSize: 15, fontFamily: 'monospace', letterSpacing: 0.5 },
    warnBox: {
      backgroundColor: 'rgba(255, 83, 0, 0.08)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(255, 83, 0, 0.25)',
      padding: 14,
    },
    warnText: { color: colors.primary, fontSize: 12.5, lineHeight: 18 },
    input: {
      backgroundColor: colors.background,
      minHeight: 52,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 15,
      borderWidth: 1,
      borderColor: colors.border,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      height: 54,
      borderRadius: 9999,
      justifyContent: 'center',
      alignItems: 'center',
    },
    primaryBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
    btnDisabled: { opacity: 0.7 },
    secondaryBtn: {
      height: 48,
      borderRadius: 9999,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    secondaryBtnText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
    ghostBtn: { height: 40, justifyContent: 'center', alignItems: 'center' },
    ghostBtnText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  });

export default WalletBackupScreen;
