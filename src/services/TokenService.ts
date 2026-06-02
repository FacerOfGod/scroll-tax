import { supabase } from './supabaseClient';

class TokenService {
  /** Upsert a user_profiles row with 100 tokens if it doesn't exist yet. */
  async ensureProfile(userId: string): Promise<void> {
    const { error } = await supabase
      .from('user_profiles')
      .upsert({ user_id: userId, tokens: 100 }, { onConflict: 'user_id', ignoreDuplicates: true });
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

  /** Atomically add tokens to the signed-in user's balance. */
  async addTokens(_userId: string, amount: number): Promise<void> {
    const { error } = await supabase.rpc('adjust_tokens', { p_delta: amount });
    if (error) throw new Error(error.message);
  }
}

export const tokenService = new TokenService();
