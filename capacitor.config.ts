import type { CapacitorConfig } from '@capacitor/cli';

// The Android app wraps the same Vite build as the website (dist/): one codebase, see CLAUDE.md.
const config: CapacitorConfig = {
  appId: 'com.mcaldera.plexus',
  appName: 'Plexus',
  webDir: 'dist',
  backgroundColor: '#030712',
  plugins: {
    // Light status bar icons over the dark page.
    SystemBars: { style: 'DARK' },
  },
  android: {
    // chrome://inspect on the laptop can debug the WebView of a debug build.
    webContentsDebuggingEnabled: true,
  },
};

export default config;
