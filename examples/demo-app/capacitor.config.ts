import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.otakit.demo',
  appName: 'OtaKit Demo',
  webDir: 'out',
  plugins: {
    OtaKit: {
      appId: '4fdd60d6-4775-4ad5-8c61-1cb4012901ab',
      runtimeVersion: 'demo-shell-v3',
      launchPolicy: 'apply-staged',
      resumePolicy: 'shadow',
      runtimePolicy: 'immediate',
      appReadyTimeout: 10000,
    },
  },
};

export default config;
