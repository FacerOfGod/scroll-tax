import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Colors } from '../../theme/colors';

// ─── Diagram: Blockchain Chain ────────────────────────────────────────────────

const BlockchainDiagram = () => (
  <View style={diag.wrap}>
    {['Block 1', 'Block 2', 'Block 3'].map((label, i) => (
      <View key={label} style={diag.blockRow}>
        <View style={diag.block}>
          <Text style={diag.blockNum}>#{i + 1}</Text>
          <Text style={diag.blockLabel}>{label}</Text>
          <View style={diag.blockHashRow}>
            <Text style={diag.hashLabel}>Hash</Text>
            <Text style={diag.hashValue}>A3F…{i + 1}C</Text>
          </View>
          {i > 0 && (
            <View style={diag.blockHashRow}>
              <Text style={diag.hashLabel}>Prev</Text>
              <Text style={diag.hashValue}>A3F…{i}C</Text>
            </View>
          )}
          <View style={diag.blockHashRow}>
            <Text style={diag.hashLabel}>Txs</Text>
            <Text style={diag.hashValue}>{(i + 1) * 12}</Text>
          </View>
        </View>
        {i < 2 && (
          <View style={diag.arrowCol}>
            <View style={diag.arrowLine} />
            <Text style={diag.arrowHead}>▶</Text>
          </View>
        )}
      </View>
    ))}
  </View>
);

// ─── Diagram: Transaction Flow ────────────────────────────────────────────────

const TxFlowDiagram = () => (
  <View style={diag.wrap}>
    <View style={diag.flowRow}>
      {/* Sender */}
      <View style={diag.flowNode}>
        <View style={diag.nodeCircle}>
          <Text style={diag.nodeIcon}>👤</Text>
        </View>
        <Text style={diag.nodeLabel}>You</Text>
        <Text style={diag.nodeSub}>Sender</Text>
      </View>

      <View style={diag.flowArrow}>
        <View style={diag.flowLine} />
        <Text style={diag.flowArrowLabel}>signs tx</Text>
        <View style={diag.flowArrowHead} />
      </View>

      {/* Network */}
      <View style={diag.flowNode}>
        <View style={[diag.nodeCircle, diag.nodeCircleAlt]}>
          <Text style={diag.nodeIcon}>🌐</Text>
        </View>
        <Text style={diag.nodeLabel}>Network</Text>
        <Text style={diag.nodeSub}>Validators</Text>
      </View>

      <View style={diag.flowArrow}>
        <View style={diag.flowLine} />
        <Text style={diag.flowArrowLabel}>confirms</Text>
        <View style={diag.flowArrowHead} />
      </View>

      {/* Receiver */}
      <View style={diag.flowNode}>
        <View style={diag.nodeCircle}>
          <Text style={diag.nodeIcon}>👤</Text>
        </View>
        <Text style={diag.nodeLabel}>Them</Text>
        <Text style={diag.nodeSub}>Receiver</Text>
      </View>
    </View>

    <View style={diag.flowTimeline}>
      <View style={diag.timelineDot} />
      <View style={diag.timelineBar} />
      <View style={[diag.timelineDot, { backgroundColor: Colors.primary }]} />
      <View style={diag.timelineBar} />
      <View style={[diag.timelineDot, { backgroundColor: Colors.secondary }]} />
    </View>
    <View style={diag.flowTimestamps}>
      <Text style={diag.tsLabel}>0s</Text>
      <Text style={diag.tsLabel}>~2s</Text>
      <Text style={diag.tsLabel}>~4s</Text>
    </View>
  </View>
);

// ─── Diagram: Keys & Wallet ───────────────────────────────────────────────────

const KeysDiagram = () => (
  <View style={diag.wrap}>
    <View style={diag.keysRow}>
      {/* Private key */}
      <View style={diag.keyCard}>
        <Text style={diag.keyIcon}>🔑</Text>
        <Text style={diag.keyTitle}>Private Key</Text>
        <Text style={diag.keyMono}>sEdV…9k2r</Text>
        <Text style={diag.keyDesc}>Secret. Never share. Used to sign transactions.</Text>
        <View style={[diag.keyBadge, { backgroundColor: 'rgba(255,69,58,0.15)', borderColor: 'rgba(255,69,58,0.3)' }]}>
          <Text style={[diag.keyBadgeText, { color: Colors.error }]}>PRIVATE</Text>
        </View>
      </View>

      <View style={diag.keysArrow}>
        <Text style={diag.keysArrowText}>⟶{'\n'}derives</Text>
      </View>

      {/* Public key / address */}
      <View style={diag.keyCard}>
        <Text style={diag.keyIcon}>📬</Text>
        <Text style={diag.keyTitle}>Address</Text>
        <Text style={diag.keyMono}>rABC…xyz</Text>
        <Text style={diag.keyDesc}>Safe to share. This is where people send XRP to you.</Text>
        <View style={[diag.keyBadge, { backgroundColor: 'rgba(48,209,88,0.15)', borderColor: 'rgba(48,209,88,0.3)' }]}>
          <Text style={[diag.keyBadgeText, { color: Colors.secondary }]}>PUBLIC</Text>
        </View>
      </View>
    </View>
  </View>
);

// ─── Diagram: XRPL Validator Network ─────────────────────────────────────────

const ValidatorDiagram = () => {
  const nodes = [
    { label: 'Validator A', x: 0 },
    { label: 'Validator B', x: 1 },
    { label: 'Validator C', x: 2 },
    { label: 'Validator D', x: 3 },
  ];
  const connections = [[0, 1], [1, 2], [2, 3], [0, 2], [1, 3]];

  return (
    <View style={diag.wrap}>
      <View style={diag.validatorGrid}>
        {/* Top row: A and B */}
        <View style={diag.vRow}>
          {[0, 1].map(i => (
            <View key={i} style={diag.vNode}>
              <View style={diag.vCircle}>
                <Text style={diag.vLetter}>{['A', 'B'][i]}</Text>
              </View>
              <Text style={diag.vLabel}>{nodes[i].label}</Text>
            </View>
          ))}
        </View>
        {/* Cross lines */}
        <View style={diag.vCrossLines}>
          <View style={diag.vLine} />
          <View style={[diag.vLine, { transform: [{ rotate: '-25deg' }] }]} />
        </View>
        {/* Bottom row: C and D */}
        <View style={diag.vRow}>
          {[2, 3].map(i => (
            <View key={i} style={diag.vNode}>
              <View style={diag.vCircle}>
                <Text style={diag.vLetter}>{['C', 'D'][i - 2]}</Text>
              </View>
              <Text style={diag.vLabel}>{nodes[i].label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={diag.consensusTag}>
        <Text style={diag.consensusText}>All agree → Block confirmed ✓</Text>
      </View>
    </View>
  );
};

// ─── Diagram: Ledger Hardware Wallet ─────────────────────────────────────────

const HardwareWalletDiagram = () => (
  <View style={diag.wrap}>
    <View style={diag.hwRow}>
      {/* Device */}
      <View style={diag.hwDevice}>
        <View style={diag.hwScreen}>
          <Text style={diag.hwScreenText}>Confirm?</Text>
          <Text style={diag.hwScreenSub}>Send 5 XRP</Text>
        </View>
        <View style={diag.hwButtons}>
          <View style={diag.hwBtn}><Text style={diag.hwBtnTxt}>✗</Text></View>
          <View style={[diag.hwBtn, { backgroundColor: Colors.primary }]}><Text style={diag.hwBtnTxt}>✓</Text></View>
        </View>
        <Text style={diag.hwLabel}>Ledger Nano X</Text>
      </View>

      <View style={diag.hwArrow}>
        <View style={diag.hwArrowLine} />
        <Text style={diag.hwArrowLabel}>BLE</Text>
        <View style={diag.hwArrowHead} />
      </View>

      {/* Phone */}
      <View style={diag.hwPhone}>
        <View style={diag.hwPhoneScreen}>
          <Text style={diag.hwPhoneIcon}>📱</Text>
          <Text style={diag.hwPhoneApp}>ScrollTax</Text>
        </View>
        <Text style={diag.hwLabel}>Your Phone</Text>
      </View>
    </View>
    <Text style={diag.hwCaption}>
      Private key never leaves the device — only the signature does.
    </Text>
  </View>
);

// ─── Section Component ────────────────────────────────────────────────────────

const Section = ({
  number,
  title,
  body,
  diagram,
}: {
  number: string;
  title: string;
  body: string;
  diagram: React.ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <View style={s.section}>
      <TouchableOpacity style={s.sectionHeader} onPress={() => setOpen(o => !o)} activeOpacity={0.7}>
        <View style={s.sectionNumBadge}>
          <Text style={s.sectionNum}>{number}</Text>
        </View>
        <Text style={s.sectionTitle}>{title}</Text>
        <Text style={s.sectionChevron}>{open ? '∨' : '›'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={s.sectionBody}>
          <Text style={s.bodyText}>{body}</Text>
          {diagram}
        </View>
      )}
    </View>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

const CryptoGuideScreen = ({ navigation }: any) => (
  <SafeAreaView style={s.container}>
    <View style={s.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
        <Text style={s.backArrow}>‹</Text>
      </TouchableOpacity>
      <View>
        <Text style={s.headerTitle}>Crypto Guide</Text>
        <Text style={s.headerSub}>Blockchain & XRP from scratch</Text>
      </View>
    </View>

    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

      <Section
        number="01"
        title="What is a Blockchain?"
        body={
          'A blockchain is a shared list of records (called blocks) that are linked together using cryptography. ' +
          'Each block contains a batch of transactions and stores the "fingerprint" (hash) of the block before it — ' +
          'making it impossible to alter history without breaking every block that follows.\n\n' +
          'No single company controls it. Thousands of computers worldwide each hold a full copy.'
        }
        diagram={<BlockchainDiagram />}
      />

      <Section
        number="02"
        title="How a Transaction Works"
        body={
          'When you send crypto, you create a transaction, sign it with your private key, and broadcast it to the network. ' +
          'Validators (or miners) check that the signature is valid and that you have enough funds. ' +
          'Once enough validators agree, the transaction is added to the next block permanently.\n\n' +
          'On XRP Ledger this takes about 3–5 seconds.'
        }
        diagram={<TxFlowDiagram />}
      />

      <Section
        number="03"
        title="Keys & Your Wallet"
        body={
          'Your "wallet" does not store coins — coins live on the blockchain. What your wallet stores is a private key: ' +
          'a secret number that proves you own your address and lets you authorise transactions.\n\n' +
          'Your address (public key) is derived from the private key using one-way maths — ' +
          'so anyone can verify your transactions, but no one can reverse-engineer your private key from your address.'
        }
        diagram={<KeysDiagram />}
      />

      <Section
        number="04"
        title="XRP & The XRPL"
        body={
          'XRP is the native currency of the XRP Ledger (XRPL), created by Ripple in 2012. ' +
          'Unlike Bitcoin, XRPL does not use energy-intensive mining. Instead it uses a consensus protocol ' +
          'where a set of trusted validators vote on the next valid ledger state.\n\n' +
          'XRP transactions are fast (~4s), cheap (fraction of a cent fee), and eco-friendly. ' +
          'ScrollTax uses the XRPL Testnet — a free sandbox where XRP has no real value.'
        }
        diagram={<ValidatorDiagram />}
      />

      <Section
        number="05"
        title="Hardware Wallets (Ledger)"
        body={
          'A hardware wallet is a physical device that stores your private key offline. ' +
          'When you make a transaction, the unsigned data is sent to the device over Bluetooth, ' +
          'you confirm it on the device screen, and only the signature comes back to the app — ' +
          'your private key never touches your phone or the internet.\n\n' +
          'This makes it the most secure way to hold crypto, even if your phone is compromised.'
        }
        diagram={<HardwareWalletDiagram />}
      />

      <View style={s.footer}>
        <Text style={s.footerText}>
          ScrollTax runs on XRPL Testnet. Testnet XRP is free and has no real-world value — perfect for learning.
        </Text>
      </View>
    </ScrollView>
  </SafeAreaView>
);

export default CryptoGuideScreen;

// ─── Diagram Styles ───────────────────────────────────────────────────────────

const diag = StyleSheet.create({
  wrap: {
    marginTop: 16,
    alignItems: 'center',
  },

  // Blockchain
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  block: {
    width: 88,
    backgroundColor: 'rgba(255, 83, 0, 0.08)',
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    padding: 10,
  },
  blockNum: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  blockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 6,
  },
  blockHashRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  hashLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  hashValue: {
    fontSize: 9,
    color: Colors.primary,
    fontFamily: 'monospace',
  },
  arrowCol: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  arrowLine: {
    width: 12,
    height: 1.5,
    backgroundColor: Colors.primary,
  },
  arrowHead: {
    fontSize: 12,
    color: Colors.primary,
    marginLeft: -2,
  },

  // Transaction flow
  flowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  flowNode: {
    alignItems: 'center',
    width: 64,
  },
  nodeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 83, 0, 0.12)',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  nodeCircleAlt: {
    backgroundColor: 'rgba(255, 83, 0, 0.06)',
    borderStyle: 'dashed',
  },
  nodeIcon: {
    fontSize: 18,
  },
  nodeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text,
  },
  nodeSub: {
    fontSize: 9,
    color: Colors.textMuted,
    marginTop: 1,
  },
  flowArrow: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  flowLine: {
    width: '100%',
    height: 1.5,
    backgroundColor: Colors.primary,
    opacity: 0.5,
  },
  flowArrowLabel: {
    fontSize: 8,
    color: Colors.primary,
    fontWeight: '600',
    marginVertical: 2,
    letterSpacing: 0.3,
  },
  flowArrowHead: {
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: Colors.primary,
  },
  flowTimeline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    width: '80%',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.textMuted,
  },
  timelineBar: {
    flex: 1,
    height: 1.5,
    backgroundColor: 'rgba(255, 83, 0, 0.3)',
  },
  flowTimestamps: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '80%',
    marginTop: 4,
  },
  tsLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '600',
  },

  // Keys
  keysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  keyCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 83, 0, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.25)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  keyIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  keyTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  keyMono: {
    fontSize: 10,
    color: Colors.primary,
    fontFamily: 'monospace',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  keyDesc: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 14,
    marginBottom: 8,
  },
  keyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  keyBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  keysArrow: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  keysArrowText: {
    fontSize: 12,
    color: Colors.primary,
    textAlign: 'center',
    fontWeight: '700',
    lineHeight: 18,
  },

  // Validators
  validatorGrid: {
    alignItems: 'center',
    width: '100%',
  },
  vRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  vNode: {
    alignItems: 'center',
    flex: 1,
  },
  vCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 83, 0, 0.12)',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  vLetter: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.primary,
  },
  vLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  vCrossLines: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    marginVertical: 6,
  },
  vLine: {
    width: 80,
    height: 1.5,
    backgroundColor: 'rgba(255, 83, 0, 0.4)',
    borderRadius: 1,
  },
  consensusTag: {
    marginTop: 12,
    backgroundColor: 'rgba(48,209,88,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(48,209,88,0.3)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  consensusText: {
    fontSize: 11,
    color: Colors.secondary,
    fontWeight: '700',
  },

  // Hardware wallet
  hwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    justifyContent: 'center',
  },
  hwDevice: {
    width: 90,
    backgroundColor: 'rgba(255, 83, 0, 0.08)',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
  },
  hwScreen: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: 8,
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  hwScreenText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.text,
  },
  hwScreenSub: {
    fontSize: 9,
    color: Colors.primary,
    marginTop: 2,
    fontWeight: '600',
  },
  hwButtons: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  hwBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(42, 42, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hwBtnTxt: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  hwLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  hwArrow: {
    alignItems: 'center',
    width: 50,
  },
  hwArrowLine: {
    width: '100%',
    height: 1.5,
    backgroundColor: Colors.primary,
    opacity: 0.5,
  },
  hwArrowLabel: {
    fontSize: 9,
    color: Colors.primary,
    fontWeight: '700',
    marginVertical: 3,
  },
  hwArrowHead: {
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: Colors.primary,
    alignSelf: 'flex-end',
  },
  hwPhone: {
    width: 80,
    backgroundColor: 'rgba(255, 83, 0, 0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 83, 0, 0.4)',
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
  },
  hwPhoneScreen: {
    alignItems: 'center',
    marginBottom: 6,
  },
  hwPhoneIcon: {
    fontSize: 24,
  },
  hwPhoneApp: {
    fontSize: 9,
    color: Colors.primary,
    fontWeight: '700',
    marginTop: 2,
  },
  hwCaption: {
    marginTop: 12,
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 15,
    paddingHorizontal: 8,
  },
});

// ─── Screen Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(42, 42, 42, 0.5)',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 83, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 26,
    color: Colors.primary,
    fontWeight: '300',
    lineHeight: 30,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.4,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 12,
  },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(42, 42, 42, 0.6)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  sectionNumBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 83, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionNum: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: 0.3,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  sectionChevron: {
    fontSize: 18,
    color: Colors.textMuted,
    fontWeight: '300',
  },
  sectionBody: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(42, 42, 42, 0.4)',
  },
  bodyText: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 20,
    marginTop: 14,
  },
  footer: {
    marginTop: 8,
    padding: 16,
    backgroundColor: 'rgba(255, 83, 0, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 83, 0, 0.2)',
    borderRadius: 14,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
