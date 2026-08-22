// jest.setup.ts
import '@testing-library/react-native/extend-expect';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => {
  const mockStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    getAllKeys: jest.fn(),
    clear: jest.fn(),
    multiGet: jest.fn(),
    multiSet: jest.fn(),
    multiRemove: jest.fn(),
  };
  return mockStorage;
});

// Mock Expo modules
jest.mock('expo-constants', () => ({
  Constants: {
    expoConfig: {},
    manifest: {},
    platform: 'ios',
    isDevice: false,
  },
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelNotificationAsync: jest.fn(),
  cancelAllNotificationsAsync: jest.fn(),
  getScheduledNotificationsAsync: jest.fn(),
}));

// Mock React Native modules
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => {
  class MockEmitter {
    subscribe() {
      return { remove: jest.fn() };
    }
  }
  return jest.fn(() => new MockEmitter());
});
