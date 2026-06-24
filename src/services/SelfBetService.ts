import { supabase } from './supabaseClient';
import { xrplService } from './XrplService';
import { TREASURY_ADDRESS } from '@env';

// Emitted (via DeviceEventEmitter) after an OAuth round-trip finishes connecting
// an account, so the Connected Accounts screen can refresh itself.
export const ACCOUNT_CONNECTED_EVENT = 'selfbet:accountConnected';

export type SelfBetProvider = 'github' | 'strava' | 'chesscom' | 'leetcode';
export type SelfBetStatus = 'active' | 'won' | 'lost';

export interface ConnectedAccount {
  provider: SelfBetProvider;
  external_username: string | null;
  connected_at: string;
}

// Custody lifecycle of an XRP stake held in the treasury (Gate 0C). 'none' = a token
// bet. 'pending' = awaiting the escrow deposit. 'held' = funded. 'forfeited'/'refunded'
// = settled loss/win.
export type EscrowStatus =
  | 'none' | 'pending' | 'held' | 'settling' | 'refunded' | 'forfeited';

export interface SelfBet {
  id: string;
  provider: SelfBetProvider;
  metric: string;            // commits | runs | wins | solves
  target_count: number;
  baseline: number;
  period_start: string;
  period_end: string;
  stake_amount: number;
  stake_type: 'xrp' | 'tokens';
  wallet_address: string | null;
  status: SelfBetStatus;
  final_value: number | null;
  settled_at: string | null;
  created_at: string;
  escrow_status?: EscrowStatus;
}

export interface BetProgress {
  ok: boolean;
  settled: boolean;
  status: SelfBetStatus;
  current?: number;
  baseline?: number;
  progress?: number;
  target?: number;
  period_end?: string;
  won?: boolean;
  escrow_status?: EscrowStatus;
  // Set when an XRP bet can't settle because its escrow deposit isn't funded yet.
  awaiting_deposit?: boolean;
  // Outcome of the on-chain refund of a won XRP bet (server-driven from the treasury).
  refund?: { ok: boolean; pending?: boolean; tx_hash?: string; error?: string };
  error?: string;
}

export interface CreateBetResult {
  ok: boolean;
  bet_id?: string;
  // For an XRP bet the device must escrow the stake into the treasury before it counts.
  needs_deposit?: boolean;
  treasury_address?: string;
  amount_drops?: number;
  error?: string;
}

export interface DepositResult {
  ok: boolean;
  escrow_status?: EscrowStatus;
  already_processed?: boolean;
  error?: string;
}

// UI metadata: how each provider is connected and labelled.
export const PROVIDER_META: Record<SelfBetProvider, {
  label: string;
  icon: string;
  metricNoun: string;       // e.g. "commits"
  connect: 'oauth' | 'username';
}> = {
  github:   { label: 'GitHub',   icon: '⌥', metricNoun: 'commits', connect: 'oauth' },
  strava:   { label: 'Strava',   icon: '⛰', metricNoun: 'runs',    connect: 'oauth' },
  chesscom: { label: 'Chess.com', icon: '♞', metricNoun: 'wins',   connect: 'username' },
  leetcode: { label: 'LeetCode', icon: '⌗', metricNoun: 'solves',  connect: 'username' },
};

interface ConnectPayload {
  username?: string;        // chesscom / leetcode
  provider_token?: string;  // github (from linkIdentity)
  code?: string;            // strava (OAuth code)
}

class SelfBetService {
  /** Invoke an edge function and always return its JSON body, even on a non-2xx status. */
  private async invokeFn(name: string, body: any): Promise<any> {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      try {
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') return await ctx.json();
      } catch { /* fall through */ }
      return { ok: false, error: error.message };
    }
    return data;
  }

  async listAccounts(): Promise<ConnectedAccount[]> {
    const { data, error } = await supabase
      .from('connected_accounts')
      .select('provider, external_username, connected_at');
    if (error) {
      console.error('listAccounts error:', error.message);
      return [];
    }
    return (data ?? []) as ConnectedAccount[];
  }

  async connectAccount(
    provider: SelfBetProvider,
    payload: ConnectPayload,
  ): Promise<{ ok: boolean; username?: string; error?: string }> {
    return await this.invokeFn('connect-account', { provider, ...payload });
  }

  async disconnectAccount(provider: SelfBetProvider): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase
      .from('connected_accounts')
      .delete()
      .eq('provider', provider);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async createSelfBet(params: {
    provider: SelfBetProvider;
    target: number;
    periodDays: number;
    stakeAmount: number;
    stakeType: 'xrp' | 'tokens';
    walletAddress?: string | null;
  }): Promise<CreateBetResult> {
    return await this.invokeFn('self-bet', {
      action: 'create',
      provider: params.provider,
      target: params.target,
      period_days: params.periodDays,
      stake_amount: params.stakeAmount,
      stake_type: params.stakeType,
      wallet_address: params.walletAddress ?? null,
    });
  }

  /**
   * Escrow an XRP stake: send it on-chain from the user's wallet to the treasury,
   * then have the server verify the tx and mark the bet funded (escrow → held).
   * Mirrors the group-stake deposit flow in TreasuryService.
   */
  async depositEscrow(
    seed: string, betId: string, amountXrp: string,
  ): Promise<DepositResult> {
    if (!TREASURY_ADDRESS) {
      return { ok: false, error: 'treasury_not_configured' };
    }
    let txHash: string | undefined;
    try {
      const tx = await xrplService.sendXrp(seed, TREASURY_ADDRESS, amountXrp);
      txHash = (tx as any)?.result?.hash;
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'deposit_send_failed' };
    }
    if (!txHash) return { ok: false, error: 'deposit_tx_no_hash' };

    return await this.invokeFn('self-bet', {
      action: 'confirm_deposit', bet_id: betId, tx_hash: txHash,
    });
  }

  async listMyBets(): Promise<SelfBet[]> {
    const { data, error } = await supabase
      .from('self_bets')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('listMyBets error:', error.message);
      return [];
    }
    return (data ?? []) as SelfBet[];
  }

  async getProgress(betId: string): Promise<BetProgress> {
    return await this.invokeFn('self-bet', { action: 'progress', bet_id: betId });
  }

  async settleBet(betId: string): Promise<BetProgress> {
    return await this.invokeFn('self-bet', { action: 'settle', bet_id: betId });
  }
}

export const selfBetService = new SelfBetService();
