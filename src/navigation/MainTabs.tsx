import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/main/DashboardScreen';
import GroupsScreen from '../screens/main/GroupsScreen';
import SelfBetsScreen from '../screens/main/SelfBetsScreen';
import DistractionSettingsScreen from '../screens/main/DistractionSettingsScreen';
import CryptoGuideScreen from '../screens/main/CryptoGuideScreen';
import BottomTabBar from './BottomTabBar';
import {PermissionsProvider} from '../context/PermissionsContext';

const Tab = createBottomTabNavigator();

const MainTabs = () => (
  <PermissionsProvider>
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{headerShown: false, sceneStyle: {backgroundColor: 'transparent'}}}
      tabBar={props => <BottomTabBar {...props} />}>
      <Tab.Screen name="Groups" component={GroupsScreen} />
      <Tab.Screen name="SelfBets" component={SelfBetsScreen} />
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="CryptoGuide" component={CryptoGuideScreen} />
      <Tab.Screen name="DistractionSettings" component={DistractionSettingsScreen} />
    </Tab.Navigator>
  </PermissionsProvider>
);

export default MainTabs;
