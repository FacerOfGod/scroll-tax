import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Share,
  SafeAreaView,
  RefreshControl,
  Animated,
} from 'react-native';
import { groupService } from '../../services/GroupService';
import { xrplService } from '../../services/XrplService';
import { tokenService } from '../../services/TokenService';
import { ScrollDetectionService } from '../../services/ScrollDetectionService';
import { ColorScheme } from '../../theme/colors';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../services/AuthContext';
import { RouteProp, useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { MainStackParamList } from '../../types/navigation';
import * as Keychain from 'react-native-keychain';
import { treasuryService } from '../../services/TreasuryService';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';
import ShareIcon from '../../components/icons/ShareIcon';

type GroupDashboardRouteProp = RouteProp<MainStackParamList, 'GroupDashboard'>;

export default function GroupDashboardScreen() {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const route = useRoute<GroupDashboardRouteProp>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { groupId } = route.params as { groupId: string };
  const [group, setGroup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningLoading, setJoiningLoading] = useState(false);

  const headerAnim  = useEntranceAnimation(0);
  const contentAnim = useRef(new Animated.Value(0)).current;

  // Re-fetch every time this screen comes into focus (catches penalty updates)
  useFocusEffect(
    useCallback(() => {
      loadGroupDetails();
    }, [groupId]),
  );

  // Re-fetch after a penalty fires so the leaderboard updates without manual refresh.
  // 2 s delay gives DashboardScreen's recordPenaltyRpc time to commit before we read.
  useEffect(() => {
    const sub = ScrollDetectionService.onPenalty(() => {
      setTimeout(() => loadGroupDetails(), 2000);
    });
    return () => sub.remove();
  }, [groupId]);

  const loadGroupDetails = async () => {
    const { data, error } = await groupService.fetchGroupDetails(groupId);
    if (!error && data) {
      // For treasury-backed XRP groups, show each member's actual held balance
      // from the treasury ledger (drops → XRP) rather than the legacy
      // group_members.staked_amount field.
      if (treasuryService.address && data.stake_type === 'xrp' && Array.isArray(data.members)) {
        const balances = await groupService.getTreasuryBalances(groupId);
        data.members = data.members.map((m: any) =>
          balances[m.user_id] !== undefined
            ? { ...m, staked_amount: balances[m.user_id] / 1e6 }
            : m,
        );
      }
      setGroup(data);
      // Push monitoring settings to the native service so detection works even if
      // the user created the group and landed here without returning to Dashboard.
      if (data.status === 'active' && data.banned_apps?.length > 0) {
        // Push banned apps only — do NOT override thresholdSeconds here.
        // DashboardScreen sets it to 30 s on focus; overriding with the
        // group's penalty_trigger_time_minutes (30 min) would make testing impossible.
        ScrollDetectionService.updateSettings({ bannedApps: data.banned_apps });
      }
      // Animate content in after data arrives so the view is always mounted first
      contentAnim.setValue(0);
      Animated.timing(contentAnim, {
        toValue: 1,
        duration: 380,
        useNativeDriver: true,
      }).start();
    } else {
      Alert.alert('Error', 'Could not load group details');
      navigation.goBack();
    }
    setLoading(false);
    setRefreshing(false);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadGroupDetails();
  };

  const isUserMember = group?.members?.some((m: any) => m.user_id === user?.id);
  const isCreator = user?.id === group?.creator_id;

  const handleJoin = async () => {
    const hasAccess = await ScrollDetectionService.hasUsageAccess();
    if (!hasAccess) {
      Alert.alert(
        'Permission Required',
        'ScrollTax needs App Usage Access to monitor your screen time. Grant it before joining a group.',
        [
          { text: 'Open Settings', onPress: () => ScrollDetectionService.openUsageAccessSettings() },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    const depositAmount = String(group.min_deposit);
    const isTokenGroup = group?.stake_type === 'tokens';

    if (!isTokenGroup) {
      // ── XRP staking path ──────────────────────────────────────────────────
      if (!user?.address) {
        Alert.alert('Wallet Error', 'No XRPL wallet found.');
        return;
      }
      if (!group?.wallet_address) {
        Alert.alert('Group Error', 'This group does not have an XRPL wallet address configured.');
        return;
      }

      setJoiningLoading(true);
      try {
        const credentials = await Keychain.getGenericPassword({ service: `xrpl-${user.id}` });
        if (!credentials) {
          Alert.alert('Wallet Error', 'Could not retrieve your wallet. Please sign out and back in.');
          setJoiningLoading(false);
          return;
        }

        const seed = credentials.password;

        Alert.alert(
          'Confirm Stake',
          `Send ${depositAmount} XRP to join "${group.name}" on XRPL Testnet?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setJoiningLoading(false) },
            {
              text: 'Stake XRP',
              onPress: async () => {
                try {
                  if (treasuryService.address) {
                    // Treasury path: become a member first (confirm_deposit
                    // requires membership), then deposit the stake into the
                    // custodial treasury (on-chain send + server-verified credit).
                    const { error } = await groupService.joinGroup(groupId, user.address || null);
                    if (error) throw error;
                    await treasuryService.deposit(seed, groupId, depositAmount);
                  } else {
                    // Legacy path: send to the group's wallet, then record membership.
                    await xrplService.sendXrp(seed, group.wallet_address, depositAmount);
                    const { error } = await groupService.joinGroup(groupId, user.address || null);
                    if (error) throw error;
                  }
                  Alert.alert('Joined!', `You've staked ${depositAmount} XRP. Welcome to "${group.name}".`);
                  loadGroupDetails();
                } catch (xrplError: any) {
                  Alert.alert('Transaction Failed', xrplError?.message || 'Could not complete your stake.');
                } finally {
                  setJoiningLoading(false);
                }
              },
            },
          ],
        );
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Something went wrong.');
        setJoiningLoading(false);
      }
    } else {
      // ── Token staking path ────────────────────────────────────────────────
      setJoiningLoading(true);
      try {
        const balance = await tokenService.getBalance(user!.id);
        const required = parseFloat(depositAmount);

        if (balance < required) {
          Alert.alert('Insufficient Tokens', `You have ${balance} tokens but need ${required}.`);
          setJoiningLoading(false);
          return;
        }

        Alert.alert(
          'Confirm Stake',
          `Spend ${depositAmount} Tokens to join "${group.name}"?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setJoiningLoading(false) },
            {
              text: 'Stake Tokens',
              onPress: async () => {
                try {
                  // join_group debits the token stake and creates the membership
                  // atomically server-side — no separate deduct/refund dance.
                  const { error } = await groupService.joinGroup(groupId, user?.address || null);
                  if (error) {
                    const code = (error as Error).message;
                    Alert.alert(
                      'Error',
                      code === 'insufficient_tokens'
                        ? `Insufficient tokens for this stake (need ${required}).`
                        : code,
                    );
                  } else {
                    Alert.alert('Joined!', `You've staked ${depositAmount} Tokens. Welcome to "${group.name}".`);
                    loadGroupDetails();
                  }
                } catch (tokenError: any) {
                  Alert.alert('Failed', tokenError?.message || 'Could not stake tokens.');
                } finally {
                  setJoiningLoading(false);
                }
              },
            },
          ],
        );
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Something went wrong.');
        setJoiningLoading(false);
      }
    }
  };

  const handleDeleteGroup = () => {
    Alert.alert(
      'Delete Group',
      'Permanently delete this group? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await groupService.deleteGroup(groupId);
            if (error) {
              Alert.alert('Delete Failed', (error as Error).message || 'Could not delete group.');
            } else {
              navigation.goBack();
            }
          },
        },
      ],
    );
  };

  const handleEndGroup = () => {
    const useTreasury = !!treasuryService.address && group?.stake_type !== 'tokens';
    Alert.alert(
      'End Group',
      useTreasury
        ? 'End this group and pay each member their remaining staked balance back to their wallet?'
        : 'Mark this group as ended? Remaining balances should be manually redistributed from your XRPL wallet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Group',
          style: 'destructive',
          onPress: async () => {
            if (useTreasury) {
              const res = await groupService.settleGroup(groupId);
              if (!res.ok) {
                Alert.alert(
                  'Settlement Incomplete',
                  res.error ||
                    'Some payouts did not complete; the group is still active. Please retry.',
                );
              } else {
                Alert.alert('Group Ended', 'Remaining balances were paid back to members.');
                navigation.goBack();
              }
            } else {
              const { error } = await groupService.endGroup(groupId);
              if (error) {
                Alert.alert('Error', 'Could not end group.');
              } else {
                Alert.alert('Group Ended', 'The group has been marked as ended.');
                navigation.goBack();
              }
            }
          },
        },
      ],
    );
  };

  const handleShare = async () => {
    const inviteUrl = `https://apbjggxmtjgocafwzxza.supabase.co/functions/v1/join-group?group_id=${groupId}`;
    await Share.share({
      message: `Join me in "${group?.name}" on ScrollTax!\n\n${inviteUrl}`,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!group) return null;

  const sortedMembers = [...(group.members || [])].sort(
    (a, b) => (a.penalties_incurred || 0) - (b.penalties_incurred || 0),
  );

  const renderMember = ({ item, index }: { item: any; index: number }) => {
    const isMe = item.user_id === user?.id;
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    return (
      <View style={[styles.memberCard, isMe && styles.memberCardMe]}>
        <View style={styles.memberLeft}>
          <Text style={styles.memberRank}>{medal}</Text>
          <View>
            <Text style={styles.memberId}>{isMe ? 'You' : `Member ${item.user_id.split('-')[0]}`}</Text>
            {item.wallet_address ? (
              <Text style={styles.memberAddress} numberOfLines={1} ellipsizeMode="middle">
                {item.wallet_address}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.memberStats}>
          <Text style={styles.stakedText}>{item.staked_amount ?? 0} {group.stake_type === 'tokens' ? 'Tokens' : 'XRP'} staked</Text>
          {(item.penalties_incurred ?? 0) > 0 && (
            <Text style={styles.penaltyText}>−{item.penalties_incurred} {group.stake_type === 'tokens' ? 'Tokens' : 'XRP'} penalties</Text>
          )}
        </View>
      </View>
    );
  };

  const isActive = group.status === 'active';

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View
        style={[
          styles.headerBar,
          { opacity: headerAnim.opacity, transform: [{ translateY: headerAnim.translateY }] },
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backButton}>{'<'}</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap} pointerEvents="none">
          <Text style={styles.headerTitle} numberOfLines={1}>{group.name}</Text>
        </View>
        <View style={[styles.statusBadge, !isActive && styles.statusBadgeEnded]}>
          <Text style={[styles.statusBadgeText, !isActive && styles.statusBadgeTextEnded]}>
            {group.status.toUpperCase()}
          </Text>
        </View>
      </Animated.View>

      <Animated.View style={{ flex: 1, opacity: contentAnim }}>
        <FlatList
          data={sortedMembers}
          keyExtractor={(item) => item.id}
          renderItem={renderMember}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={() => (
            <>
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{group.min_deposit}</Text>
                  <Text style={styles.statLabel}>Min Deposit</Text>
                  <Text style={styles.statUnit}>{group.stake_type === 'tokens' ? 'Tokens' : 'XRP'}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{group.penalty_amount}</Text>
                  <Text style={styles.statLabel}>Per Penalty</Text>
                  <Text style={styles.statUnit}>{group.stake_type === 'tokens' ? 'Tokens' : 'XRP'}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{group.duration_days}</Text>
                  <Text style={styles.statLabel}>Duration</Text>
                  <Text style={styles.statUnit}>days</Text>
                </View>
              </View>

              {group.banned_apps?.length > 0 && (
                <View style={styles.appsBox}>
                  <Text style={styles.appsLabel}>Monitored Apps</Text>
                  <View style={styles.appsRow}>
                    {(group.banned_apps as string[]).map((pkg: string) => {
                      const friendly: Record<string, string> = {
                        'com.zhiliaoapp.musically': 'TikTok',
                        'com.instagram.android': 'Instagram',
                        'com.google.android.youtube': 'YouTube',
                        'com.whatsapp': 'WhatsApp',
                      };
                      return (
                        <View key={pkg} style={styles.appChip}>
                          <Text style={styles.appChipText}>{friendly[pkg] ?? pkg}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              <Text style={styles.leaderboardTitle}>
                Leaderboard · {sortedMembers.length} {sortedMembers.length === 1 ? 'member' : 'members'}
              </Text>
            </>
          )}
        />
      </Animated.View>

      {(isUserMember || !isUserMember || isCreator) && (
        <View style={styles.bottomBar}>
          {isUserMember && isActive && (
            <TouchableOpacity
              style={styles.shareButton}
              onPress={handleShare}
              activeOpacity={0.6}
            >
              <ShareIcon size={16} color={colors.textMuted} />
              <Text style={styles.shareButtonText}>Share</Text>
            </TouchableOpacity>
          )}

          {!isUserMember && isActive && (
            <TouchableOpacity
              style={[styles.actionButton, styles.joinButton, joiningLoading && { opacity: 0.7 }]}
              onPress={handleJoin}
              disabled={joiningLoading}
              activeOpacity={0.82}
            >
              {joiningLoading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.actionButtonText}>
                  Stake {group.min_deposit} {group.stake_type === 'tokens' ? 'Tokens' : 'XRP'} & Join
                </Text>
              )}
            </TouchableOpacity>
          )}

          {isCreator && (
            <View style={styles.bottomBarRight}>
              <TouchableOpacity
                style={styles.ghostButton}
                onPress={handleDeleteGroup}
                activeOpacity={0.6}
              >
                <Text style={[styles.ghostButtonText, { color: colors.error }]}>Delete</Text>
              </TouchableOpacity>

              {isActive && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={handleEndGroup}
                  activeOpacity={0.82}
                >
                  <Text style={styles.actionButtonText}>End Group</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 10,
  },
  backButton: {
    color: colors.textMuted,
    fontSize: 16,
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 12,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  statusBadge: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.4)',
  },
  statusBadgeEnded: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
    letterSpacing: 1,
  },
  statusBadgeTextEnded: {
    color: colors.textMuted,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  statUnit: {
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  walletBox: {
    backgroundColor: 'rgba(255, 83, 0, 0.08)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.2)',
    marginBottom: 16,
    gap: 4,
  },
  walletLabel: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  walletAddress: {
    fontSize: 13,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  leaderboardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  memberCard: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memberCardMe: {
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  memberRank: {
    fontSize: 20,
    width: 30,
    textAlign: 'center',
  },
  memberId: {
    fontWeight: '700',
    fontSize: 15,
    color: colors.text,
  },
  memberAddress: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: 'monospace',
    maxWidth: 120,
    marginTop: 2,
  },
  memberStats: {
    alignItems: 'flex-end',
    gap: 2,
  },
  stakedText: {
    fontSize: 13,
    color: colors.secondary,
    fontWeight: '600',
  },
  penaltyText: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  bottomBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  shareButtonText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
  ghostButton: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  actionButton: {
    backgroundColor: colors.primary,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  joinButton: {
    flex: 1,
  },
  dangerButton: {
    backgroundColor: colors.error,
    shadowColor: colors.error,
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  appsBox: {
    backgroundColor: 'rgba(48, 209, 88, 0.06)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.25)',
    marginBottom: 16,
    gap: 8,
  },
  appsLabel: {
    fontSize: 11,
    color: colors.secondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  appsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  appChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.3)',
  },
  appChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.secondary,
  },
});
