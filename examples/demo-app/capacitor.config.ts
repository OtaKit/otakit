import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.otakit.demo',
  appName: 'OtaKit Demo',
  webDir: 'out',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0f172a',
      showSpinner: true,
      spinnerColor: '#22d3ee',
    },
    OtaKit: {
      appId: '65bb56c1-8279-4a71-a010-7a78ca96e613',
      runtimeVersion: 'demo-shell-v3',
      launchPolicy: 'apply-staged',
      resumePolicy: 'shadow',
      runtimePolicy: 'immediate',
      appReadyTimeout: 10000,
    },
  },
};

export default config;
