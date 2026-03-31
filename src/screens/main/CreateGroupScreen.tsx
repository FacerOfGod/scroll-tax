import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { xrplService } from '../../services/XrplService';
import { useAuth } from '../../services/AuthContext';
import { groupService } from '../../services/GroupService';
import * as Keychain from 'react-native-keychain';

const ALL_APPS = [
  { id: 'com.zhiliaoapp.musically', label: 'TikTok' },
  { id: 'com.instagram.android', label: 'Instagram' },
  { id: 'com.google.android.youtube', label: 'YouTube' },
  { id: 'com.whatsapp', label: 'WhatsApp' },
];

const CreateGroupScreen = ({ navigation }: any) => {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [deposit, setDeposit] = useState('10');
  const [penalty, setPenalty] = useState('0.5');
  const [duration, setDuration] = useState('7');
  const [durationUnit, setDurationUnit] = useState<'days' | 'hours' | 'minutes'>('days');
  const sliderAnim = useRef(new Animated.Value(2)).current;
  const [btnWidth, setBtnWidth] = useState(0);

  const getSliderTarget = (unit: 'days' | 'hours' | 'minutes', width: number) => {
    const index = unit === 'days' ? 0 : unit === 'hours' ? 1 : 2;
    return 2 + index * width;
  };

  const switchUnit = (unit: 'days' | 'hours' | 'minutes') => {
    setDurationUnit(unit);
    setDuration(unit === 'days' ? '7' : unit === 'hours' ? '24' : '30');
    Animated.spring(sliderAnim, {
      toValue: getSliderTarget(unit, btnWidth),
      useNativeDriver: false,
      speed: 10,
      bounciness: 4,
    }).start();
  };
  const [stakeType, setStakeType] = useState<'xrp' | 'tokens'>('xrp');
  const [selectedApps, setSelectedApps] = useState<string[]>(ALL_APPS.map(a => a.id));
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'sending' | 'saving'>('idle');

  const toggleApp = (appId: string) => {
    setSelectedApps(prev =>
      prev.includes(appId) ? prev.filter(id => id !== appId) : [...prev, appId],
    );
  };

  const handleCreateGroup = async () => {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter a group name.');
      return;
    }
    if (!deposit || parseFloat(deposit) <= 0) {
      Alert.alert('Invalid Deposit', 'Please enter a valid deposit amount.');
      return;
    }
    if (!user?.address) {
      Alert.alert('Wallet Error', 'No XRPL wallet found. Please sign out and sign back in.');
      return;
    }

    setLoading(true);
    setStep('sending');

    try {
      // Get seed from Keychain
      const credentials = await Keychain.getGenericPassword({
        service: `xrpl-${user.id}`,
      });

      if (!credentials) {
        Alert.alert('Wallet Error', 'Could not retrieve your wallet. Please sign out and sign back in.');
        setLoading(false);
        setStep('idle');
        return;
      }

      const seed = credentials.password;

      // For XRP groups: send a self-transfer to mark the initial stake on testnet.
      // For token groups: no on-chain transaction needed.
      if (stakeType === 'xrp') {
        try {
          await xrplService.sendXrp(seed, user.address, deposit);
        } catch (xrplError: any) {
          // On testnet a self-transfer may be rejected by some nodes.
          // Log and continue — the Supabase record is the source of truth for the demo.
          console.warn('XRPL self-transfer note:', xrplError?.message);
        }
      }

      setStep('saving');

      const { data, error } = await groupService.createGroup({
        name: name.trim(),
        creator_id: user.id,
        wallet_address: user.address,
        min_deposit: parseFloat(deposit),
        duration_days: durationUnit === 'hours'
          ? (parseFloat(duration) || 1) / 24
          : durationUnit === 'minutes'
          ? (parseFloat(duration) || 1) / 1440
          : parseInt(duration, 10) || 7,
        penalty_amount: parseFloat(penalty),
        penalty_trigger_time_minutes: 30,
        banned_apps: selectedApps,
        stake_type: stakeType,
      });

      if (error || !data?.id) {
        Alert.alert('Database Error', (error as Error)?.message || 'Could not save group.');
      } else {
        navigation.replace('GroupDashboard', { groupId: data.id });
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Something went wrong.');
      console.error(e);
    } finally {
      setLoading(false);
      setStep('idle');
    }
  };

  const getButtonLabel = () => {
    if (step === 'sending') return 'Broadcasting to Testnet...';
    if (step === 'saving') return 'Saving Group...';
    return 'Initialize Group';
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.back}>{'<'}</Text>
            </TouchableOpacity>
            <View style={styles.titleWrap} pointerEvents="none">
              <Text style={styles.title}>New Group</Text>
            </View>
            <View style={{ width: 56 }} />
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Group Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Deep Work Warriors"
                placeholderTextColor={Colors.textMuted}
                value={name}
                onChangeText={setName}
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Stake Currency</Text>
              <View style={styles.stakeTypeRow}>
                {(['xrp', 'tokens'] as const).map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.stakeTypeBtn, stakeType === type && styles.stakeTypeBtnActive]}
                    onPress={() => setStakeType(type)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.stakeTypeBtnText, stakeType === type && styles.stakeTypeBtnTextActive]}>
                      {type === 'xrp' ? '⬡  XRP' : '◈  Tokens'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>Min Deposit ({stakeType === 'xrp' ? 'XRP' : 'Tokens'})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="10"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  value={deposit}
                  onChangeText={setDeposit}
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Duration</Text>
                  <View style={styles.unitToggle}>
                    <Animated.View style={[styles.unitSlider, { width: btnWidth, left: sliderAnim }]} />
                    <TouchableOpacity
                      style={styles.unitBtn}
                      onLayout={e => {
                        const w = e.nativeEvent.layout.width;
                        setBtnWidth(w);
                        sliderAnim.setValue(getSliderTarget(durationUnit, w));
                      }}
                      onPress={() => switchUnit('days')}
                    >
                      <Text style={[styles.unitBtnText, durationUnit === 'days' && styles.unitBtnTextActive]}>D</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.unitBtn} onPress={() => switchUnit('hours')}>
                      <Text style={[styles.unitBtnText, durationUnit === 'hours' && styles.unitBtnTextActive]}>H</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.unitBtn} onPress={() => switchUnit('minutes')}>
                      <Text style={[styles.unitBtnText, durationUnit === 'minutes' && styles.unitBtnTextActive]}>M</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.inputWithSuffix}>
                  <TextInput
                    style={[styles.input, { flex: 1, borderWidth: 0 }]}
                    placeholder={durationUnit === 'days' ? '7' : durationUnit === 'hours' ? '24' : '30'}
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    value={duration}
                    onChangeText={setDuration}
                  />
                  <View style={styles.unitSuffix}>
                    <Text style={styles.unitSuffixText}>{durationUnit === 'days' ? 'days' : durationUnit === 'hours' ? 'hours' : 'minutes'}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Penalty ({stakeType === 'xrp' ? 'XRP' : 'Tokens'})</Text>
              <TextInput
                style={styles.input}
                placeholder="0.5"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                value={penalty}
                onChangeText={setPenalty}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Monitored Apps</Text>
              <View style={styles.appsGrid}>
                {ALL_APPS.map(app => {
                  const selected = selectedApps.includes(app.id);
                  return (
                    <TouchableOpacity
                      key={app.id}
                      style={[styles.appChip, selected && styles.appChipSelected]}
                      onPress={() => toggleApp(app.id)}
                    >
                      <Text style={[styles.appChipText, selected && styles.appChipTextSelected]}>
                        {app.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>How it works</Text>
              <Text style={styles.infoText}>
                <Text style={{ fontWeight: '700' }}>Solo group:</Text>{' '}Penalties go to the developers.{'\n'}
                <Text style={{ fontWeight: '700' }}>Group challenge:</Text>{' '}Penalties are redistributed to members who stayed within their limit.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.createButton, loading && styles.createButtonDisabled]}
              onPress={handleCreateGroup}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="#FFF" size="small" />
                  <Text style={[styles.createButtonText, { marginLeft: 10 }]}>{getButtonLabel()}</Text>
                </View>
              ) : (
                <Text style={styles.createButtonText}>Initialize Group</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  back: {
    color: Colors.textMuted,
    fontSize: 16,
  },
  titleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  form: {
    gap: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-end',
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginLeft: 4,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 4,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    position: 'relative',
    padding: 2,
  },
  unitSlider: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    backgroundColor: Colors.primary,
    borderRadius: 6,
  },
  unitBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    zIndex: 1,
  },
  unitBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  unitBtnTextActive: {
    color: '#FFFFFF',
  },
  inputWithSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    height: 56,
    overflow: 'hidden',
  },
  unitSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 14,
    gap: 4,
  },
  unitSuffixText: {
    fontSize: 15,
    color: Colors.textMuted,
  },
  input: {
    backgroundColor: Colors.surface,
    height: 56,
    borderRadius: 14,
    paddingHorizontal: 16,
    color: Colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoBox: {
    backgroundColor: 'rgba(255, 83, 0, 0.08)',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.25)',
    gap: 8,
  },
  infoTitle: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  infoText: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  addressRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 83, 0, 0.2)',
    paddingTop: 8,
    gap: 4,
  },
  addressLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  addressValue: {
    fontSize: 13,
    color: Colors.primary,
    fontFamily: 'monospace',
  },
  createButton: {
    backgroundColor: Colors.primary,
    height: 58,
    borderRadius: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stakeTypeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  stakeTypeBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stakeTypeBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  stakeTypeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  stakeTypeBtnTextActive: {
    color: '#FFFFFF',
  },
  appsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  appChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  appChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  appChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  appChipTextSelected: {
    color: '#FFFFFF',
  },
});

export default CreateGroupScreen;
