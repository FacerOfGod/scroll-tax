import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';
import BleTransport from '@ledgerhq/react-native-hw-transport-ble';
import Xrp from '@ledgerhq/hw-app-xrp';
import { xrpToDrops, encodeForSigning, encode } from 'xrpl';
import { xrplService } from './XrplService';

// @ts-ignore
global.Buffer = Buffer;

// BIP44 XRP derivation path used by Ledger
const XRP_PATH = "44'/144'/0'/0/0";

// Ledger status codes when XRP app is not open on device
const XRP_APP_NOT_OPEN_CODES = ['6e00', '6511', '6d00'];

function derToRawSignature(derHex: string): string {
  const buf = Buffer.from(derHex, 'hex');
  // buf[0] === 0x30 (SEQUENCE), buf[1] === total content length
  let offset = 2;
  // r integer
  const rLen = buf[offset + 1];
  offset += 2;
  // DER pads positive integers with a leading 0x00 — strip it
  const rStart = rLen === 33 ? offset + 1 : offset;
  const rBytes = buf.slice(rStart, offset + rLen);
  offset += rLen;
  // s integer
  const sLen = buf[offset + 1];
  offset += 2;
  const sStart = sLen === 33 ? offset + 1 : offset;
  const sBytes = buf.slice(sStart, offset + sLen);
  // Zero-pad r and s to 32 bytes each and concatenate
  const r = Buffer.alloc(32);
  const s = Buffer.alloc(32);
  rBytes.copy(r, 32 - rBytes.length);
  sBytes.copy(s, 32 - sBytes.length);
  return Buffer.concat([r, s]).toString('hex');
}

function isXrpAppNotOpen(err: any): boolean {
  const msg: string = (err?.message ?? err?.statusCode?.toString(16) ?? '').toLowerCase();
  return XRP_APP_NOT_OPEN_CODES.some(code => msg.includes(code));
}

export interface LedgerDevice {
  id: string;
  name: string;
}

export interface LedgerPaymentParams {
  fromAddress: string;
  publicKey: string;
  destination: string;
  amountXrp: string;
}

class LedgerService {
  private transport: BleTransport | null = null;
  private _connectedDeviceName: string | null = null;

  get connectedDeviceName(): string | null {
    return this._connectedDeviceName;
  }

  isConnected(): boolean {
    return this.transport !== null;
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    const apiLevel = parseInt(Platform.Version as string, 10);

    if (apiLevel >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return (
        result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED &&
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      );
    }
  }

  /**
   * Scans for nearby Ledger devices using Ledger's BLE transport listener.
   * Returns a cleanup function to stop scanning.
   */
  scanDevices(onDeviceFound: (device: LedgerDevice) => void): () => void {
    const subscription = BleTransport.listen((event: any) => {
      if (event.type === 'add' && event.descriptor) {
        const { id, name } = event.descriptor;
        onDeviceFound({ id, name: name ?? `Ledger (${id.slice(0, 6)})` });
      }
    });
    return () => subscription.unsubscribe();
  }

  /**
   * Connects to a Ledger device and opens a transport session.
   * The XRP app must be open on the Ledger before calling this.
   */
  async connect(deviceId: string, deviceName: string): Promise<void> {
    try {
      this.transport = await BleTransport.open(deviceId);
      this._connectedDeviceName = deviceName;
    } catch (err: any) {
      if (isXrpAppNotOpen(err)) {
        throw new Error('Open the XRP app on your Ledger');
      }
      if (err?.message?.toLowerCase().includes('powered off') || err?.message?.toLowerCase().includes('bluetooth')) {
        throw new Error('Bluetooth is turned off');
      }
      throw err;
    }
  }

  /**
   * Retrieves the XRP address and public key from the connected Ledger.
   */
  async getAddress(): Promise<{ address: string; publicKey: string }> {
    if (!this.transport) throw new Error('No Ledger connected');
    try {
      const xrpApp = new Xrp(this.transport);
      const result = await xrpApp.getAddress(XRP_PATH);
      return { address: result.address, publicKey: result.publicKey };
    } catch (err: any) {
      if (isXrpAppNotOpen(err)) {
        throw new Error('Open the XRP app on your Ledger');
      }
      throw err;
    }
  }

  /**
   * Signs and submits an XRP Payment transaction using the connected Ledger.
   * The user must physically confirm the transaction on the Ledger device.
   */
  async signAndSubmitPayment(params: LedgerPaymentParams): Promise<void> {
    if (!this.transport) throw new Error('No Ledger connected');
    const { fromAddress, publicKey, destination, amountXrp } = params;

    await xrplService.ensureConnected();

    // Build unsigned payment transaction
    const unsignedTx: any = {
      TransactionType: 'Payment',
      Account: fromAddress,
      Amount: xrpToDrops(amountXrp),
      Destination: destination,
      SigningPubKey: publicKey.toUpperCase(),
    };

    // Autofill Sequence, Fee, LastLedgerSequence
    const prepared = await xrplService.client.autofill(unsignedTx);

    // Encode canonical signing bytes
    const canonicalHex = encodeForSigning(prepared as any);

    // Sign on Ledger device (user confirms on physical device)
    const xrpApp = new Xrp(this.transport);
    let derHex: string;
    try {
      const sigResult = await xrpApp.signTransaction(XRP_PATH, canonicalHex);
      derHex = sigResult;
    } catch (err: any) {
      if (isXrpAppNotOpen(err)) {
        throw new Error('Open the XRP app on your Ledger');
      }
      throw err;
    }

    // Convert DER signature to XRPL 64-byte raw format
    const rawSig = derToRawSignature(derHex).toUpperCase();

    // Attach signature and encode full transaction
    const signedTx = { ...prepared, TxnSignature: rawSig };
    const txBlob = encode(signedTx as any);

    // Submit and wait for validation
    const result = await xrplService.client.submitAndWait(txBlob);

    if ((result.result.meta as any)?.TransactionResult !== 'tesSUCCESS') {
      throw new Error(`Transaction failed: ${(result.result.meta as any)?.TransactionResult}`);
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.transport?.close();
    } catch {
      // Ignore disconnect errors
    } finally {
      this.transport = null;
      this._connectedDeviceName = null;
    }
  }
}

export const ledgerService = new LedgerService();
