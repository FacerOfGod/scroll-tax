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

  /** Deduct tokens. Throws if the user has insufficient balance. */
  async deductTokens(userId: string, amount: number): Promise<void> {
    const current = await this.getBalance(userId);
    if (current < amount) {
      throw new Error(`Insufficient tokens. You have ${current} but need ${amount}.`);
    }
    const { error } = await supabase
      .from('user_profiles')
      .update({ tokens: current - amount })
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  /** Add tokens to a user's balance. */
  async addTokens(userId: string, amount: number): Promise<void> {
    const current = await this.getBalance(userId);
    const { error } = await supabase
      .from('user_profiles')
      .update({ tokens: current + amount })
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  /**
   * Deduct a penalty from the offender and split it equally among other members.
   * If there are no other members, tokens are simply burned (deducted with no recipient).
   */
  async redistributePenalty(
    fromUserId: string,
    toUserIds: string[],
    penaltyAmount: number,
  ): Promise<void> {
    await this.deductTokens(fromUserId, penaltyAmount);

    if (toUserIds.length === 0) return;

    const share = Math.floor((penaltyAmount / toUserIds.length) * 1e6) / 1e6;
    await Promise.all(toUserIds.map(uid => this.addTokens(uid, share)));
  }
}

export const tokenService = new TokenService();
