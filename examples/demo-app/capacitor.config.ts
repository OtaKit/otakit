import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.otakit.demo',
  appName: 'OtaKit Demo',
  webDir: 'out',
  plugins: {
    OtaKit: {
      appId: '3fc984ea-73ba-4a30-b751-c7f93138945b',
      updateMode: 'immediate',
      appReadyTimeout: 10000,
    },
  },
};

export default config;
