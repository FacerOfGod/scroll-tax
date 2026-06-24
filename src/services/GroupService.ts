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
  stake_type: 'xrp' | 'tokens';
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

      // Add the creator as a member automatically. The join RPC reads the stake
      // (min_deposit) from the group itself and exempts the creator from a token
      // debit, so no amount is passed from the client.
      if (data) {
        await this.joinGroup(data.id, details.wallet_address);
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error creating group:', error);
      return { data: null, error };
    }
  }

  /**
   * Join (or auto-add the creator to) a group. Membership is created server-side
   * by the join_group RPC: it sets staked_amount authoritatively from the group's
   * min_deposit (never client-supplied) and, for a token group, debits the stake
   * in the same transaction. The signed-in user is taken from auth.uid(), so no
   * userId is passed. On failure the RPC returns an error code
   * (insufficient_tokens / already_member / rejoin_not_allowed / …).
   */
  async joinGroup(groupId: string, walletAddress: string | null) {
    try {
      const { data, error } = await supabase.rpc('join_group', {
        p_group_id: groupId,
        p_wallet: walletAddress,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'join_failed');
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
        .eq('user_id', userId);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching groups:', error);
      return { data: null, error };
    }
  }

  async fetchGroupDetails(groupId: string) {
    try {
      // Members + creator can read the group row directly (invite-only RLS).
      let { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();

      if (groupError) throw groupError;

      // A prospective joiner (not yet a member) is hidden by RLS — fall back to
      // the narrow by-id lookup that returns only the joinable fields.
      if (!groupData) {
        const { data: joinData, error: joinError } = await supabase
          .rpc('get_group_for_join', { p_group_id: groupId });
        if (joinError) throw joinError;
        groupData = Array.isArray(joinData) ? joinData[0] : joinData;
        if (!groupData) throw new Error('group_not_found');
      }

      // Returns the full list for members; [] for a prospective joiner (RLS).
      const { data: membersData, error: membersError } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId);

      if (membersError) throw membersError;

      return { data: { ...groupData, members: membersData ?? [] }, error: null };
    } catch (error) {
      console.error('Error fetching group details:', error);
      return { data: null, error };
    }
  }

  // Penalties are recorded exclusively through recordPenaltyRpc() →
  // record_penalty (SECURITY DEFINER), which reads the penalty amount from the
  // group server-side and updates staked_amount / penalties_incurred. Clients can
  // no longer write those columns directly, so there is no client-side variant.

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

  async getGroupMemberIds(groupId: string): Promise<string[]> {
    const { data } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);
    return (data ?? []).map((m: any) => m.user_id as string);
  }

  async deleteGroup(groupId: string) {
    try {
      // Delete members first so foreign key constraints don't block the group delete
      await supabase.from('group_members').delete().eq('group_id', groupId);

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

  // Map of user_id -> held balance (drops) for a group's treasury ledger.
  // Readable by active group members (see treasury_ledger RLS policy).
  async getTreasuryBalances(groupId: string): Promise<Record<string, number>> {
    try {
      const { data, error } = await supabase
        .from('treasury_ledger')
        .select('user_id, balance_drops')
        .eq('group_id', groupId);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of data ?? []) map[(r as any).user_id] = Number((r as any).balance_drops);
      return map;
    } catch (err) {
      console.warn('getTreasuryBalances error:', err);
      return {};
    }
  }

  // Treasury-backed group end: the edge function pays each member's remaining
  // held balance back to their wallet on-chain, then marks the group ended.
  async settleGroup(groupId: string): Promise<{ ok: boolean; error?: string; payouts?: any[] }> {
    try {
      const { data, error } = await supabase.functions.invoke('treasury', {
        body: { action: 'settle_group', group_id: groupId },
      });
      if (error) throw error;
      return data as { ok: boolean; error?: string; payouts?: any[] };
    } catch (err: any) {
      console.error('settleGroup error:', err);
      return { ok: false, error: err?.message ?? 'unknown' };
    }
  }

  async getActiveGroupForUser(userId: string) {
    try {
      const { data, error } = await supabase
        .from('group_members')
        .select(`
          group_id,
          status,
          groups (id, wallet_address, penalty_amount, name, banned_apps, penalty_trigger_time_minutes, status, stake_type)
        `)
        .eq('user_id', userId);

      if (error) throw error;

      // Exclude left memberships and only return groups that are still active
      const active = (data ?? []).find(
        (m: any) => m.groups?.status === 'active' && m.status !== 'left',
      ) ?? null;
      return { data: active, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async recordPenaltyRpc(
    groupId: string,
    appPackage: string,
    txHash?: string,
  ): Promise<{ ok: boolean; error?: string; amount?: number }> {
    try {
      const { data, error } = await supabase.rpc('record_penalty', {
        p_group_id:    groupId,
        p_app_package: appPackage,
        p_tx_hash:     txHash ?? null,
      });
      if (error) throw error;
      return data as { ok: boolean; error?: string; amount?: number };
    } catch (err: any) {
      console.error('recordPenaltyRpc error:', err);
      return { ok: false, error: err?.message ?? 'unknown' };
    }
  }

  async forfeitStake(groupId: string): Promise<{ ok: boolean; error?: string; amount?: number }> {
    try {
      const { data, error } = await supabase.rpc('forfeit_stake', { p_group_id: groupId });
      if (error) throw error;
      return data as { ok: boolean; error?: string; amount?: number };
    } catch (err: any) {
      console.error('forfeitStake error:', err);
      return { ok: false, error: err?.message ?? 'unknown' };
    }
  }
}

export const groupService = new GroupService();
