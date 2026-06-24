// Tabs rendered inside the bottom bar (nested under the `Main` stack route).
export type MainTabParamList = {
  Home: undefined;
  Groups: undefined;
  SelfBets: undefined;
  DistractionSettings: undefined;
  CryptoGuide: undefined;
};

// Stack routes pushed on top of the tabs (full-screen detail/flow screens).
export type MainStackParamList = {
  Main: undefined;
  GroupDashboard: { groupId: string };
  CreateGroup: undefined;
  CreateSelfBet: undefined;
  ConnectedAccounts: undefined;
  WalletBackup: undefined;
};
