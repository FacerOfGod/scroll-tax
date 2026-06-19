/**
 * XrplService.sendXrp — retry vs. fatal classification.
 *
 * The money-path contract: transient result codes get re-submitted with fresh
 * autofill; fatal codes (and tesSUCCESS) resolve immediately with no extra
 * submission. A bug here means either lost retries or, worse, double-sends.
 *
 * `xrpl` is fully mocked so no real network/native code runs. The mock fns are
 * created inside the factory (jest hoists jest.mock above module scope) and shared
 * by every Client instance, so the singleton's `client` exposes them to assertions.
 */
jest.mock('xrpl', () => {
  const submitAndWait = jest.fn();
  const autofill = jest.fn(async (tx: unknown) => tx);
  const connect = jest.fn(async () => {});
  const disconnect = jest.fn(async () => {});
  const isConnected = jest.fn(() => true);
  return {
    Client: jest.fn().mockImplementation(() => ({
      autofill,
      submitAndWait,
      connect,
      disconnect,
      isConnected,
      getXrpBalance: jest.fn(),
      request: jest.fn(),
    })),
    Wallet: {
      fromSeed: jest.fn(() => ({ address: 'rSender', sign: () => ({ tx_blob: 'BLOB' }) })),
      generate: jest.fn(() => ({ address: 'rGen', seed: 'sGen', publicKey: 'PUB' })),
    },
    xrpToDrops: (x: string) => String(Math.round(Number(x) * 1e6)),
    dropsToXrp: (d: string) => String(Number(d) / 1e6),
  };
});

import { xrplService } from '../XrplService';

const submitAndWait = () => xrplService.client.submitAndWait as unknown as jest.Mock;
const result = (code: string) => ({ result: { meta: { TransactionResult: code } } });

beforeEach(() => {
  submitAndWait().mockReset();
  (xrplService.client.isConnected as unknown as jest.Mock).mockReturnValue(true);
  // Make exponential backoff instant so the suite stays fast.
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
});

afterEach(() => (global.setTimeout as unknown as jest.Mock).mockRestore?.());

test('resolves immediately on tesSUCCESS (single submission)', async () => {
  submitAndWait().mockResolvedValueOnce(result('tesSUCCESS'));
  const tx = await xrplService.sendXrp('sSeed', 'rDest', '1');
  expect(tx.result.meta.TransactionResult).toBe('tesSUCCESS');
  expect(submitAndWait()).toHaveBeenCalledTimes(1);
});

test('retries a transient code then succeeds', async () => {
  submitAndWait()
    .mockResolvedValueOnce(result('telINSUF_FEE_P'))
    .mockResolvedValueOnce(result('tesSUCCESS'));
  const tx = await xrplService.sendXrp('sSeed', 'rDest', '1', 3);
  expect(tx.result.meta.TransactionResult).toBe('tesSUCCESS');
  expect(submitAndWait()).toHaveBeenCalledTimes(2);
});

test('throws immediately on a fatal code without retrying', async () => {
  submitAndWait().mockResolvedValue(result('tecUNFUNDED_PAYMENT'));
  await expect(xrplService.sendXrp('sSeed', 'rDest', '1', 3)).rejects.toThrow(
    'tecUNFUNDED_PAYMENT',
  );
  expect(submitAndWait()).toHaveBeenCalledTimes(1);
});

test('gives up after maxRetries on a persistently transient code', async () => {
  submitAndWait().mockResolvedValue(result('tooBusy'));
  await expect(xrplService.sendXrp('sSeed', 'rDest', '1', 2)).rejects.toThrow('tooBusy');
  // initial attempt + 2 retries
  expect(submitAndWait()).toHaveBeenCalledTimes(3);
});
