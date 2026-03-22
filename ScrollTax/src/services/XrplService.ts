import { Client, Wallet, xrpToDrops, dropsToXrp } from 'xrpl';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// @ts-ignore
global.Buffer = Buffer;

const TESTNET_URL = 'wss://s.altnet.rippletest.net:51233';

// XRPL uses seconds since Jan 1, 2000 — Unix epoch starts Jan 1, 1970
const RIPPLE_EPOCH_OFFSET = 946684800;

class XrplService {
  private client: Client;

  constructor() {
    this.client = new Client(TESTNET_URL);
  }

  private async ensureConnected() {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }
  }

  async disconnect() {
    if (this.client.isConnected()) {
      await this.client.disconnect();
    }
  }

  /**
   * Generates a new XRPL wallet locally.
   * Seed is stored securely in Android Keychain by the caller.
   */
  generateWallet() {
    const wallet = Wallet.generate();
    return {
      address: wallet.address,
      seed: wallet.seed!,
      publicKey: wallet.publicKey,
    };
  }

  /**
   * Fund a wallet from the Testnet faucet (Testnet only).
   * Returns the funded wallet with the new balance.
   */
  async fundTestnetWallet(seed: string): Promise<{ balance: number }> {
    await this.ensureConnected();
    const wallet = Wallet.fromSeed(seed);
    const result = await this.client.fundWallet(wallet);
    return { balance: result.balance };
  }

  /**
   * Get XRP balance for an address.
   * Returns '0' if the account hasn't been funded yet (actNotFound).
   */
  async getBalance(address: string): Promise<string> {
    try {
      await this.ensureConnected();
      const balance = await this.client.getXrpBalance(address);
      return balance;
    } catch (error: any) {
      // Account not yet funded on testnet
      if (error?.data?.error === 'actNotFound' || error?.message?.includes('actNotFound')) {
        return '0';
      }
      console.error('Error fetching balance:', error);
      return '0';
    }
  }

  /**
   * Send XRP from one wallet to another.
   * Used for group deposits and penalty payments.
   */
  async sendXrp(seed: string, destination: string, amount: string): Promise<any> {
    await this.ensureConnected();
    const wallet = Wallet.fromSeed(seed);

    const prepared = await this.client.autofill({
      TransactionType: 'Payment',
      Account: wallet.address,
      Amount: xrpToDrops(amount),
      Destination: destination,
    });

    const signed = wallet.sign(prepared);
    const tx = await this.client.submitAndWait(signed.tx_blob);

    if ((tx.result.meta as any)?.TransactionResult !== 'tesSUCCESS') {
      throw new Error(`Transaction failed: ${(tx.result.meta as any)?.TransactionResult}`);
    }

    return tx;
  }

  /**
   * Get recent transaction history for an address.
   */
  async getTransactionHistory(address: string): Promise<any[]> {
    try {
      await this.ensureConnected();
      const response = await this.client.request({
        command: 'account_tx',
        account: address,
        limit: 20,
      });
      return response.result.transactions;
    } catch (error) {
      console.error('Error fetching tx history:', error);
      return [];
    }
  }

  /**
   * Converts a drops string to XRP display string.
   */
  dropsToXrp(drops: string): string {
    return dropsToXrp(drops);
  }
}

export const xrplService = new XrplService();
