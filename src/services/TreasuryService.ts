import { supabase } from './supabaseClient';
import { xrplService } from './XrplService';
import { TREASURY_ADDRESS as _TREASURY_ADDRESS } from '@env';
import { dropsToXrpString } from '../utils/penaltySplit';

// Client side of the custodial treasury (Phase 2). Deposits go on-chain from the
// user's own wallet to the treasury, then a server function verifies the tx and
// credits the internal ledger. Payouts are a privileged server operation and are
// deliberately NOT exposed here — the client can never move treasury funds.
export const TREASURY_ADDRESS: string = _TREASURY_ADDRESS;

class TreasuryService {
  get address(): string {
    return TREASURY_ADDRESS;
  }

  /**
   * Deposit a stake into a group's treasury: send XRP on-chain from the user's
   * wallet, then have the server verify the tx and credit the ledger.
   * Returns the on-chain tx hash and the user's new held balance (in drops).
   */
  async deposit(seed: string, groupId: string, amountXrp: string) {
    if (!TREASURY_ADDRESS) {
      throw new Error('Treasury address is not configured (TREASURY_ADDRESS).');
    }
    const tx = await xrplService.sendXrp(seed, TREASURY_ADDRESS, amountXrp);
    const txHash = (tx as any)?.result?.hash;
    if (!txHash) {
      throw new Error('Deposit transaction did not return a hash.');
    }

    const { data, error } = await supabase.functions.invoke('treasury', {
      body: { action: 'confirm_deposit', group_id: groupId, tx_hash: txHash },
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error ?? 'deposit_confirmation_failed');

    return { txHash, balanceDrops: (data.balance_drops as number) ?? 0 };
  }

  /** The signed-in user's held balance for a group, in drops. */
  async getBalanceDrops(groupId: string): Promise<number> {
    const { data, error } = await supabase.functions.invoke('treasury', {
      body: { action: 'balance', group_id: groupId },
    });
    if (error) throw error;
    return (data?.balance_drops as number) ?? 0;
  }

  /** Convenience: held balance as an XRP display string. */
  async getBalanceXrp(groupId: string): Promise<string> {
    return dropsToXrpString(await this.getBalanceDrops(groupId));
  }
}

export const treasuryService = new TreasuryService();
