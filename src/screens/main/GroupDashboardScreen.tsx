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
import { Colors } from '../../theme/colors';
import { useAuth } from '../../services/AuthContext';
import { RouteProp, useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { MainStackParamList } from '../../types/navigation';
import * as Keychain from 'react-native-keychain';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';

type GroupDashboardRouteProp = RouteProp<MainStackParamList, 'GroupDashboard'>;

export default function GroupDashboardScreen() {
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

  const loadGroupDetails = async () => {
    const { data, error } = await groupService.fetchGroupDetails(groupId);
    if (!error && data) {
      setGroup(data);
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
      const depositAmount = String(group.min_deposit);

      Alert.alert(
        'Confirm Stake',
        `Send ${depositAmount} XRP to join "${group.name}" on XRPL Testnet?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setJoiningLoading(false) },
          {
            text: 'Stake XRP',
            onPress: async () => {
              try {
                await xrplService.sendXrp(seed, group.wallet_address, depositAmount);

                const { error } = await groupService.joinGroup(
                  groupId,
                  user.id,
                  user.address || null,
                  parseFloat(depositAmount),
                );

                if (error) {
                  Alert.alert('Error', (error as Error).message);
                } else {
                  Alert.alert('Joined!', `You've staked ${depositAmount} XRP. Welcome to "${group.name}".`);
                  loadGroupDetails();
                }
              } catch (xrplError: any) {
                Alert.alert('Transaction Failed', xrplError?.message || 'Could not send XRP.');
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
    Alert.alert(
      'End Group',
      'Mark this group as ended? Remaining balances should be manually redistributed from your XRPL wallet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Group',
          style: 'destructive',
          onPress: async () => {
            const { error } = await groupService.endGroup(groupId);
            if (error) {
              Alert.alert('Error', 'Could not end group.');
            } else {
              Alert.alert('Group Ended', 'The group has been marked as ended.');
              navigation.goBack();
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
        <ActivityIndicator size="large" color={Colors.primary} />
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
          <Text style={styles.stakedText}>{item.staked_amount ?? 0} XRP staked</Text>
          {(item.penalties_incurred ?? 0) > 0 && (
            <Text style={styles.penaltyText}>−{item.penalties_incurred} XRP penalties</Text>
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={() => (
            <>
              <Text style={styles.groupName}>{group.name}</Text>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{group.min_deposit}</Text>
                  <Text style={styles.statLabel}>Min Deposit</Text>
                  <Text style={styles.statUnit}>XRP</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{group.penalty_amount}</Text>
                  <Text style={styles.statLabel}>Per Penalty</Text>
                  <Text style={styles.statUnit}>XRP</Text>
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
          ListFooterComponent={() => (
            <View style={styles.footer}>
              {isUserMember && isActive && (
                <TouchableOpacity
                  style={styles.shareButton}
                  onPress={handleShare}
                  activeOpacity={0.82}
                >
                  <Text style={styles.shareButtonText}>Share Invite Link</Text>
                </TouchableOpacity>
              )}

              {!isUserMember && isActive && (
                <TouchableOpacity
                  style={[styles.actionButton, joiningLoading && { opacity: 0.7 }]}
                  onPress={handleJoin}
                  disabled={joiningLoading}
                  activeOpacity={0.82}
                >
                  {joiningLoading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.actionButtonText}>
                      Stake {group.min_deposit} XRP & Join
                    </Text>
                  )}
                </TouchableOpacity>
              )}

              {isCreator && isActive && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.dangerButton]}
                  onPress={handleEndGroup}
                  activeOpacity={0.82}
                >
                  <Text style={styles.actionButtonText}>End Group & Distribute Funds</Text>
                </TouchableOpacity>
              )}

              {isCreator && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.deleteButton]}
                  onPress={handleDeleteGroup}
                  activeOpacity={0.82}
                >
                  <Text style={[styles.actionButtonText, { color: Colors.error }]}>Delete Group</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(42, 42, 42, 0.5)',
  },
  backButton: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '600',
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
    color: Colors.secondary,
    letterSpacing: 1,
  },
  statusBadgeTextEnded: {
    color: Colors.textMuted,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  groupName: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  statUnit: {
    fontSize: 10,
    color: Colors.textMuted,
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
    color: Colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  walletAddress: {
    fontSize: 13,
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  leaderboardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  memberCard: {
    backgroundColor: Colors.surface,
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  memberCardMe: {
    borderColor: 'rgba(255, 83, 0, 0.4)',
    backgroundColor: 'rgba(255, 83, 0, 0.06)',
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
    color: Colors.text,
  },
  memberAddress: {
    fontSize: 11,
    color: Colors.textMuted,
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
    color: Colors.secondary,
    fontWeight: '600',
  },
  penaltyText: {
    fontSize: 12,
    color: Colors.error,
    fontWeight: '600',
  },
  footer: {
    gap: 12,
    marginTop: 16,
  },
  shareButton: {
    backgroundColor: 'rgba(255, 83, 0, 0.1)',
    padding: 12,
    borderRadius: 9999,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.4)',
  },
  shareButtonText: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  actionButton: {
    backgroundColor: Colors.primary,
    padding: 12,
    borderRadius: 9999,
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  dangerButton: {
    backgroundColor: Colors.error,
    shadowColor: Colors.error,
  },
  deleteButton: {
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
    shadowOpacity: 0,
    elevation: 0,
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 17,
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
    color: Colors.secondary,
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
    color: Colors.secondary,
  },
});
