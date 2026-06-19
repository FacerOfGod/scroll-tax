import { Client, Wallet, xrpToDrops, dropsToXrp } from 'xrpl';
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { XRPL_NETWORK } from '@env';

// @ts-ignore
global.Buffer = Buffer;

// Network selection. Defaults to testnet when XRPL_NETWORK is unset or unknown,
// so existing behavior is preserved unless mainnet is explicitly opted into.
const XRPL_ENDPOINTS = {
  testnet: 'wss://s.altnet.rippletest.net:51233',
  mainnet: 'wss://xrplcluster.com',
} as const;

type XrplNetwork = keyof typeof XRPL_ENDPOINTS;

const NETWORK: XrplNetwork = XRPL_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const XRPL_WSS_URL = XRPL_ENDPOINTS[NETWORK];

// Bound every network interaction so a dead/slow node can never hang the app:
//   - requestTimeout  : per round-trip request to rippled
//   - connectionTimeout: how long to wait for the websocket to open
//   - connect retries  : transient connect failures get a few backed-off attempts
const REQUEST_TIMEOUT_MS = 20000;
const CONNECT_TIMEOUT_MS = 15000;
const CONNECT_MAX_RETRIES = 3;

class XrplService {
  client: Client;
  readonly network: XrplNetwork = NETWORK;
  readonly isMainnet: boolean = NETWORK === 'mainnet';

  constructor() {
    this.client = new Client(XRPL_WSS_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      connectionTimeout: CONNECT_TIMEOUT_MS,
    });
  }

  // Connect with bounded retries. connectionTimeout guarantees connect() rejects
  // instead of hanging, so the loop can back off and retry. Connecting is
  // money-safe to retry (it sends no transaction).
  async ensureConnected() {
    if (this.client.isConnected()) return;
    let lastErr: unknown;
    for (let attempt = 0; attempt < CONNECT_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
      try {
        await this.client.connect();
        return;
      } catch (err) {
        lastErr = err;
        // connect() can leave the socket half-open; reset before the next attempt.
        try {
          if (this.client.isConnected()) await this.client.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('XRPL connect failed');
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
    if (this.isMainnet) {
      throw new Error('Testnet faucet is unavailable on mainnet.');
    }
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
      return String(balance);
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
  // Result codes that are transient — a fresh autofill + resubmit may succeed.
  // Fatal codes (insufficient funds, bad destination, etc.) are NOT listed here
  // and will propagate immediately without retry.
  private static RETRYABLE_RESULTS = new Set([
    'telINSUF_FEE_P',  // fee too low (network congestion) — re-autofill recalculates
    'tooBusy',         // rippled server overloaded
    'terQUEUED',       // already queued, try again after a ledger
    'tefPAST_SEQ',     // sequence conflict from parallel submissions — re-autofill fixes
    'terPRE_SEQ',      // sequence gap — wait and retry
  ]);

  async sendXrp(seed: string, destination: string, amount: string, maxRetries = 3): Promise<any> {
    await this.ensureConnected();
    const wallet = Wallet.fromSeed(seed);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s — silent, no user-visible noise
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        await this.ensureConnected();
      }

      try {
        const prepared = await this.client.autofill({
          TransactionType: 'Payment',
          Account: wallet.address,
          Amount: xrpToDrops(amount),
          Destination: destination,
        });

        const signed = wallet.sign(prepared);
        const tx = await this.client.submitAndWait(signed.tx_blob);
        const txResult: string = (tx.result.meta as any)?.TransactionResult;

        if (txResult === 'tesSUCCESS') {
          return tx;
        }

        if (XrplService.RETRYABLE_RESULTS.has(txResult) && attempt < maxRetries) {
          lastError = new Error(`Transaction failed: ${txResult}`);
          continue;
        }

        throw new Error(`Transaction failed: ${txResult}`);
      } catch (err: any) {
        const msg: string = err?.message ?? '';
        // Retry on network/connection errors (not XRPL result codes)
        const isNetworkError =
          msg.includes('connect') || msg.includes('socket') || msg.includes('timeout');
        if (isNetworkError && attempt < maxRetries) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new Error('Transaction failed after retries');
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
    return String(dropsToXrp(drops));
  }
}

export const xrplService = new XrplService();
