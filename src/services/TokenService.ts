import { supabase } from './supabaseClient';

class TokenService {
  /**
   * Ensure the signed-in user has a profile row (with the server-controlled
   * starting balance). Provisioning is server-side: a trigger creates the row on
   * sign-up and this RPC self-heals any session whose row is missing. Clients can
   * never write `tokens` directly. The userId arg is advisory — the RPC acts on
   * auth.uid().
   */
  async ensureProfile(_userId: string): Promise<void> {
    const { error } = await supabase.rpc('ensure_profile');
    if (error) console.warn('TokenService.ensureProfile error:', error.message);
  }

  /** Returns the current token balance for the user, or 0 on error. */
  async getBalance(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('tokens')
      .eq('user_id', userId)
      .single();
    if (error || !data) return 0;
    return data.tokens as number;
  }

  /**
   * Atomically deduct tokens from the signed-in user. Throws if the balance is
   * insufficient. The server-side adjust_tokens RPC enforces the guard in a
   * single statement, eliminating the read-then-write race. The userId arg is
   * advisory — the RPC always acts on auth.uid().
   */
  async deductTokens(_userId: string, amount: number): Promise<void> {
    const { error } = await supabase.rpc('adjust_tokens', { p_delta: -amount });
    if (error) {
      if (error.message?.includes('insufficient')) {
        throw new Error(`Insufficient tokens for this stake (need ${amount}).`);
      }
      throw new Error(error.message);
    }
  }

  // NOTE: there is intentionally no client-side credit method. Token credits
  // (penalty redistribution, self-bet wins, the atomic group-join stake) all
  // happen inside SECURITY DEFINER RPCs — adjust_tokens rejects positive deltas
  // so a client can never mint tokens.
}

export const tokenService = new TokenService();
