import React, {useEffect} from 'react';
import {NavigationContainer, DefaultTheme, DarkTheme} from '@react-navigation/native';
import {createStackNavigator, CardStyleInterpolators} from '@react-navigation/stack';
import {Linking} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import MainTabs from './MainTabs';
import CreateGroupScreen from '../screens/main/CreateGroupScreen';
import GroupDashboardScreen from '../screens/main/GroupDashboardScreen';
import CreateSelfBetScreen from '../screens/main/CreateSelfBetScreen';
import ConnectedAccountsScreen from '../screens/main/ConnectedAccountsScreen';
import WalletBackupScreen from '../screens/main/WalletBackupScreen';
import {useAuth, AuthProvider} from '../services/AuthContext';
import {View, ActivityIndicator} from 'react-native';
import {ThemeProvider, useTheme} from '../context/ThemeContext';
import {MonitoringProvider} from '../context/MonitoringContext';
import AnimatedBackground from '../components/AnimatedBackground';

export const PENDING_INVITE_KEY = 'pendingJoinGroupId';

const linking = {
  prefixes: ['scrolltax://', 'https://apbjggxmtjgocafwzxza.supabase.co'],
  config: {
    screens: {
      GroupDashboard: 'join/:groupId',
    },
  },
};

const Stack = createStackNavigator();

const NavigationContent = () => {
  const {user, isLoading} = useAuth();
  const {colors, isDark} = useTheme();

  // Transparent navigation surfaces so the animated background shows through.
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: 'transparent',
      card: 'transparent',
    },
  };

  // Capture deep links when user is not authenticated — save for after login
  useEffect(() => {
    if (user || isLoading) return;

    const handleUrl = (url: string) => {
      const joinMatch = url.match(/scrolltax:\/\/join\/(.+)/);
      if (joinMatch) AsyncStorage.setItem(PENDING_INVITE_KEY, joinMatch[1].trim());

      const joinGroupMatch = url.match(/\/join-group\?.*group_id=([^&]+)/);
      if (joinGroupMatch) AsyncStorage.setItem(PENDING_INVITE_KEY, joinGroupMatch[1].trim());
    };

    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });
    const sub = Linking.addEventListener('url', ({url}) => handleUrl(url));
    return () => sub.remove();
  }, [user, isLoading]);

  // Handle deep links when user IS already logged in
  useEffect(() => {
    if (!user || isLoading) return;

    const handleUrl = (url: string) => {
      const joinGroupMatch = url.match(/\/join-group\?.*group_id=([^&]+)/);
      if (joinGroupMatch) AsyncStorage.setItem(PENDING_INVITE_KEY, joinGroupMatch[1].trim());
    };

    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });
    const sub = Linking.addEventListener('url', ({url}) => handleUrl(url));
    return () => sub.remove();
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
        <AnimatedBackground />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{flex: 1}}>
      <AnimatedBackground />
      <NavigationContainer linking={linking} theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: {backgroundColor: 'transparent'},
          cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
          cardOverlayEnabled: false,
          cardOverlay: () => null,
          gestureEnabled: false,
          transitionSpec: {
            open: {animation: 'timing', config: {duration: 400}},
            close: {animation: 'timing', config: {duration: 800}},
          },
        }}>
        {user ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="GroupDashboard" component={GroupDashboardScreen} />
            <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
            <Stack.Screen name="CreateSelfBet" component={CreateSelfBetScreen} />
            <Stack.Screen name="ConnectedAccounts" component={ConnectedAccountsScreen} />
            <Stack.Screen name="WalletBackup" component={WalletBackupScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </>
        )}
      </Stack.Navigator>
      </NavigationContainer>
    </View>
  );
};

const RootNavigator = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MonitoringProvider>
          <NavigationContent />
        </MonitoringProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default RootNavigator;
