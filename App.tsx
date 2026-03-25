import React, {useEffect} from 'react';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import RootNavigator from './src/navigation/RootNavigator';
import {localNotificationService} from './src/services/LocalNotificationService';

function App() {
  useEffect(() => {
    localNotificationService.configure();
  }, []);

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <RootNavigator />
    </GestureHandlerRootView>
  );
}

export default App;
