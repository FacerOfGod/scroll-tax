// Stub for LocalNotificationService after removing react-native-push-notification
// This avoids build errors while removing Firebase dependencies.

class LocalNotificationService {
  configure = () => {
    console.log('LocalNotificationService: Notifications disabled (Firebase removed)');
  };

  showNotification = (title: string, message: string) => {
    console.log(`LocalNotificationService [MOCK]: ${title} - ${message}`);
  };
}

export const localNotificationService = new LocalNotificationService();
