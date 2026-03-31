import React, {useEffect} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator, CardStyleInterpolators} from '@react-navigation/stack';
import {Linking} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import DashboardScreen from '../screens/main/DashboardScreen';
import CreateGroupScreen from '../screens/main/CreateGroupScreen';
import GroupsScreen from '../screens/main/GroupsScreen';
import GroupDashboardScreen from '../screens/main/GroupDashboardScreen';
import DistractionSettingsScreen from '../screens/main/DistractionSettingsScreen';
import LinkTelegramScreen from '../screens/main/LinkTelegramScreen';
import CryptoGuideScreen from '../screens/main/CryptoGuideScreen';
import {useAuth, AuthProvider} from '../services/AuthContext';
import {View, ActivityIndicator} from 'react-native';
import {Colors} from '../theme/colors';

export const PENDING_INVITE_KEY = 'pendingJoinGroupId';

const PENDING_TELEGRAM_KEY = 'pendingTelegramId';
export { PENDING_TELEGRAM_KEY };

export const PENDING_SESSION_KEY = 'pendingSessionJoin';

const linking = {
  prefixes: ['scrolltax://', 'https://apbjggxmtjgocafwzxza.supabase.co'],
  config: {
    screens: {
      GroupDashboard: 'join/:groupId',
      LinkTelegram: 'link',
    },
  },
};

const Stack = createStackNavigator();

const NavigationContent = () => {
  const {user, isLoading} = useAuth();

  // Capture deep links when user is not authenticated — save for after login
  useEffect(() => {
    if (user || isLoading) return;

    const handleUrl = (url: string) => {
      const joinMatch = url.match(/scrolltax:\/\/join\/(.+)/);
      if (joinMatch) AsyncStorage.setItem(PENDING_INVITE_KEY, joinMatch[1].trim());

      const joinGroupMatch = url.match(/\/join-group\?.*group_id=([^&]+)/);
      if (joinGroupMatch) AsyncStorage.setItem(PENDING_INVITE_KEY, joinGroupMatch[1].trim());

      const linkMatch = url.match(/scrolltax:\/\/link\?telegram_id=([^&]+)/);
      if (linkMatch) AsyncStorage.setItem(PENDING_TELEGRAM_KEY, linkMatch[1].trim());

      const sessionMatch = url.match(/scrolltax:\/\/session\?id=([^&]+)/);
      if (sessionMatch) {
        AsyncStorage.setItem(PENDING_SESSION_KEY, sessionMatch[1].trim());
        const tgMatch = url.match(/[?&]telegram_id=([^&]+)/);
        if (tgMatch) AsyncStorage.setItem(PENDING_TELEGRAM_KEY, tgMatch[1].trim());
      }
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

      const linkMatch = url.match(/scrolltax:\/\/link\?telegram_id=([^&]+)/);
      if (linkMatch) AsyncStorage.setItem(PENDING_TELEGRAM_KEY, linkMatch[1].trim());

      const sessionMatch = url.match(/scrolltax:\/\/session\?id=([^&]+)/);
      if (sessionMatch) {
        AsyncStorage.setItem(PENDING_SESSION_KEY, sessionMatch[1].trim());
        const tgMatch = url.match(/[?&]telegram_id=([^&]+)/);
        if (tgMatch) AsyncStorage.setItem(PENDING_TELEGRAM_KEY, tgMatch[1].trim());
      }
    };

    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });
    const sub = Linking.addEventListener('url', ({url}) => handleUrl(url));
    return () => sub.remove();
  }, [user, isLoading]);

  if (isLoading) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background}}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
          gestureEnabled: false,
          transitionSpec: {
            open: {animation: 'timing', config: {duration: 400}},
            close: {animation: 'timing', config: {duration: 800}},
          },
        }}>
        {user ? (
          <>
            <Stack.Screen name="Main" component={DashboardScreen} />
            <Stack.Screen name="Groups" component={GroupsScreen} />
            <Stack.Screen name="GroupDashboard" component={GroupDashboardScreen} />
            <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
            <Stack.Screen name="DistractionSettings" component={DistractionSettingsScreen} />
            <Stack.Screen name="LinkTelegram" component={LinkTelegramScreen} />
            <Stack.Screen name="CryptoGuide" component={CryptoGuideScreen} />
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
  );
};

const RootNavigator = () => {
  return (
    <AuthProvider>
      <NavigationContent />
    </AuthProvider>
  );
};

export default RootNavigator;
