import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.otakit.demo',
  appName: 'OtaKit Demo',
  webDir: 'out',
  plugins: {
    OtaKit: {
      appId: 'eb6cc4f5-c898-48a1-b6a4-cf66d24042a5',
      updateMode: 'next-resume',
      appReadyTimeout: 10000,
    },
  },
};

export default config;
