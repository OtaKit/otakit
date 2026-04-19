import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.otakit.demo',
  appName: 'OtaKit Demo',
  webDir: 'out',
  plugins: {
    OtaKit: {
      appId: '4fdd60d6-4775-4ad5-8c61-1cb4012901ab',
      runtimeVersion: 'demo-shell-v1',
      updateMode: 'immediate',
      immediateUpdateOnRuntimeChange: true,
      autoSplashscreen: true,
      autoSplashscreenTimeout: 4000,
      appReadyTimeout: 10000,
    },
    SplashScreen: {
      launchAutoHide: false,
    },
  },
};

export default config;
