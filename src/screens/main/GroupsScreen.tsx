import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
  Animated,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useAuth } from '../../services/AuthContext';
import { groupService } from '../../services/GroupService';
import { StackNavigationProp } from '@react-navigation/stack';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { MainStackParamList } from '../../types/navigation';
import { Colors } from '../../theme/colors';
import { useEntranceAnimation } from '../../hooks/useEntranceAnimation';

type NavigationProp = StackNavigationProp<MainStackParamList, 'Groups'>;

export default function GroupsScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const isFocused = useIsFocused();
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  const headerAnim = useEntranceAnimation(0);
  const listAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (user && isFocused) {
      loadGroups();
    }
  }, [user, isFocused]);

  // Fade list in after data loads
  useEffect(() => {
    if (!loading) {
      Animated.timing(listAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  }, [loading]);

  const loadGroups = async () => {
    setLoading(true);
    listAnim.setValue(0);
    const { data, error } = await groupService.fetchGroups(user!.id);
    if (!error && data) {
      const formatted = data.map((item: any) => ({
        ...(item.groups as any),
        myStakedAmount: item.staked_amount,
        myPenalties: item.penalties_incurred,
      }));
      formatted.sort((a: any, b: any) => {
        if (a.status === b.status) return 0;
        return a.status === 'active' ? -1 : 1;
      });
      setGroups(formatted);
    }
    setLoading(false);
    setRefreshing(false);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadGroups();
  };

  const handleJoinWithCode = async () => {
    const code = inviteCode.trim();
    if (!code) return;
    setJoinModalVisible(false);
    setInviteCode('');
    const { data, error } = await groupService.fetchGroups(user!.id);
    // Navigate to group dashboard if the invite code matches a group id
    const matched = (data as any[])?.find((m: any) => m.groups?.id === code || m.groups?.invite_code === code);
    if (matched) {
      navigation.navigate('GroupDashboard', { groupId: matched.groups.id });
    } else {
      Alert.alert('Invalid Code', 'No group found with that invite code. Ask your group admin for the correct link.');
    }
  };

  const activeGroups = groups.filter((g: any) => g.status === 'active');
  const endedGroups  = groups.filter((g: any) => g.status !== 'active');

  const getTimeLeft = (createdAt: string, durationDays: number) => {
    const endMs = new Date(createdAt).getTime() + durationDays * 24 * 60 * 60 * 1000;
    const diffMs = endMs - Date.now();
    if (diffMs <= 0) return 'Ending soon';
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
  };

  const renderGroupItem = (item: any) => {
    const isActive = item.status === 'active';
    return (
      <TouchableOpacity
        key={item.id}
        style={styles.groupCard}
        onPress={() => navigation.navigate('GroupDashboard', { groupId: item.id })}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <Text style={styles.groupName}>{item.name}</Text>
          <View style={[styles.statusPill, !isActive && styles.statusPillEnded]}>
            <Text style={[styles.statusText, !isActive && styles.statusTextEnded]}>
              {isActive && item.created_at ? getTimeLeft(item.created_at, item.duration_days) : item.status}
            </Text>
          </View>
        </View>

        <View style={styles.cardStats}>
          <View style={styles.cardStat}>
            <Text style={styles.cardStatValue}>{item.myStakedAmount ?? 0}</Text>
            <Text style={styles.cardStatLabel}>Staked XRP</Text>
          </View>
          <View style={styles.cardStatDivider} />
          <View style={styles.cardStat}>
            <Text style={[styles.cardStatValue, (item.myPenalties ?? 0) > 0 && { color: Colors.error }]}>
              {item.myPenalties ?? 0}
            </Text>
            <Text style={styles.cardStatLabel}>Penalties XRP</Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View
        style={[
          styles.header,
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
          <Text style={styles.headerTitle}>My Groups</Text>
        </View>
        <View style={{ width: 56 }} />
      </Animated.View>

      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <Animated.ScrollView
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
          style={{ opacity: listAnim }}
        >
          {groups.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>◉◉</Text>
              <Text style={styles.emptyTitle}>No Groups Yet</Text>
              <Text style={styles.emptyText}>
                Join an existing group with an invite code, or create your own to start holding each other accountable.
              </Text>
              <View style={styles.emptyActions}>
                <TouchableOpacity
                  style={styles.emptyBtnPrimary}
                  onPress={() => navigation.navigate('CreateGroup')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyBtnPrimaryText}>Create a Group</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.emptyBtnSecondary}
                  onPress={() => setJoinModalVisible(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyBtnSecondaryText}>Join with Code</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              {activeGroups.length > 0 && (
                <>
                  <Text style={styles.sectionHeader}>Active</Text>
                  {activeGroups.map(renderGroupItem)}
                </>
              )}
              {endedGroups.length > 0 && (
                <>
                  <Text style={[styles.sectionHeader, styles.sectionHeaderMuted]}>Ended</Text>
                  {endedGroups.map(renderGroupItem)}
                </>
              )}
            </>
          )}
        </Animated.ScrollView>
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateGroup')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal
        visible={joinModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setJoinModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Join a Group</Text>
            <Text style={styles.modalSubtitle}>Enter the invite code shared by your group admin.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Invite code"
              placeholderTextColor={Colors.textMuted}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => { setJoinModalVisible(false); setInviteCode(''); }}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtnJoin, !inviteCode.trim() && styles.modalBtnDisabled]}
                onPress={handleJoinWithCode}
                disabled={!inviteCode.trim()}
              >
                <Text style={styles.modalBtnJoinText}>Join</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(42, 42, 42, 0.5)',
  },
  backButton: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  groupCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 12,
  },
  groupName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
    marginRight: 8,
    letterSpacing: -0.2,
  },
  statusPill: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.35)',
  },
  statusPillEnded: {
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.secondary,
    textTransform: 'capitalize',
    letterSpacing: 0.3,
  },
  statusTextEnded: {
    color: Colors.textMuted,
  },
  cardStats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(42, 42, 42, 0.5)',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  cardStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  cardStatValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primary,
  },
  cardStatLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  cardStatDivider: {
    width: 1,
    backgroundColor: 'rgba(42, 42, 42, 0.5)',
    marginHorizontal: 4,
  },
  cardArrow: {
    fontSize: 26,
    color: Colors.textMuted,
    alignSelf: 'center',
    marginLeft: 'auto',
    paddingRight: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    color: Colors.primary,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    backgroundColor: Colors.primary,
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 7,
  },
  fabText: {
    color: '#FFF',
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 32,
    marginTop: -2,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  sectionHeaderMuted: {
    color: Colors.textMuted,
    marginTop: 20,
  },
  emptyActions: {
    marginTop: 8,
    gap: 12,
    width: '100%',
  },
  emptyBtnPrimary: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyBtnPrimaryText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyBtnSecondary: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyBtnSecondaryText: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
  },
  modalInput: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: 'rgba(42,42,42,0.6)',
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalBtnCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(42,42,42,0.6)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnCancelText: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
  modalBtnJoin: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalBtnDisabled: {
    opacity: 0.4,
  },
  modalBtnJoinText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
