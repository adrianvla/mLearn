import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.kikan.mlearn',
  appName: 'mLearn',
  webDir: 'dist-mobile',
  plugins: {
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'LIGHT',
    },
    SplashScreen: {
      launchShowDuration: 1000,
      launchAutoHide: true,
      backgroundColor: '#000000',
      showSpinner: false,
    },
  },
  server: {
    // Live reload during development (override with --livereload flag)
    androidScheme: 'https',
  },
};

export default config;
