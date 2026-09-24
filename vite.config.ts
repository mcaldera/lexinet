import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port and no clearing of its log output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/pipeline/**'] },
  },
  test: { globals: true, environment: 'node', include: ['src/**/*.test.ts'] },
});
