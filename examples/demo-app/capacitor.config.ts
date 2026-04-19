import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.otakit.demo',
  appName: 'OtaKit Demo',
  webDir: 'out',
  plugins: {
    OtaKit: {
      appId: '4fdd60d6-4775-4ad5-8c61-1cb4012901ab',
      runtimeVersion: 'demo-shell-v2',
      updateMode: 'immediate',
      autoSplashscreen: true,
      autoSplashscreenTimeout: 4000,
      autoSplashscreenBackgroundColor: '#000000',
      appReadyTimeout: 10000,
    },
  },
};

export default config;
