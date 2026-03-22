import { supabase } from './supabaseClient';

export interface GroupDetails {
  name: string;
  creator_id: string;
  wallet_address: string;
  min_deposit: number;
  duration_days: number;
  penalty_amount: number;
  penalty_trigger_time_minutes: number;
  banned_apps: string[];
}

class GroupService {
  async createGroup(details: GroupDetails) {
    try {
      const { data, error } = await supabase
        .from('groups')
        .insert([details])
        .select()
        .single();

      if (error) throw error;

      // Add the creator as a member automatically
      if (data) {
        await this.joinGroup(data.id, details.creator_id, details.wallet_address, details.min_deposit);
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error creating group:', error);
      return { data: null, error };
    }
  }

  async joinGroup(
    groupId: string,
    userId: string,
    walletAddress: string | null,
    stakedAmount: number = 0,
  ) {
    try {
      const { data, error } = await supabase
        .from('group_members')
        .insert([{
          group_id: groupId,
          user_id: userId,
          wallet_address: walletAddress,
          staked_amount: stakedAmount,
        }])
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error joining group:', error);
      return { data: null, error };
    }
  }

  async fetchGroups(userId: string) {
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select(`
          group_id,
          staked_amount,
          penalties_incurred,
          groups (*)
        `)
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching groups:', error);
      return { data: null, error };
    }
  }

  async fetchGroupDetails(groupId: string) {
    try {
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .single();

      if (groupError) throw groupError;

      const { data: membersData, error: membersError } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId);

      if (membersError) throw membersError;

      return { data: { ...groupData, members: membersData }, error: null };
    } catch (error) {
      console.error('Error fetching group details:', error);
      return { data: null, error };
    }
  }

  async recordPenalty(userId: string, groupId: string, amount: number) {
    try {
      const { data: memberData, error: memberFetchError } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .single();

      if (memberFetchError) throw memberFetchError;

      const newStakedAmount = Math.max(0, memberData.staked_amount - amount);
      const newPenalties = (memberData.penalties_incurred || 0) + amount;

      const { data, error } = await supabase
        .from('group_members')
        .update({
          staked_amount: newStakedAmount,
          penalties_incurred: newPenalties,
        })
        .eq('id', memberData.id)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error recording penalty:', error);
      return { data: null, error };
    }
  }

  async getGroupMembers(groupId: string) {
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select('user_id, wallet_address, staked_amount')
        .eq('group_id', groupId);
      if (error) throw error;
      return { data: data ?? [], error: null };
    } catch (error) {
      return { data: [], error };
    }
  }

  async deleteGroup(groupId: string) {
    try {
      const { data, error } = await supabase
        .from('groups')
        .delete()
        .eq('id', groupId)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Delete blocked — check Supabase RLS policies (run pending migrations).');
      }
      return { error: null };
    } catch (error) {
      console.error('Error deleting group:', error);
      return { error };
    }
  }

  async endGroup(groupId: string) {
    try {
      const { data, error } = await supabase
        .from('groups')
        .update({ status: 'ended' })
        .eq('id', groupId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error ending group:', error);
      return { data: null, error };
    }
  }

  async getActiveGroupForUser(userId: string) {
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select(`
          group_id,
          groups (id, wallet_address, penalty_amount, name, banned_apps, penalty_trigger_time_minutes, status)
        `)
        .eq('user_id', userId);

      if (error) throw error;

      // Filter by the group's own status (not the membership row's status,
      // which is never set by joinGroup and defaults to null)
      const active = (data ?? []).find((m: any) => m.groups?.status === 'active') ?? null;
      return { data: active, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
}

export const groupService = new GroupService();
