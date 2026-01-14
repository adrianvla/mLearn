import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  root: 'src',
  base: './', // Ensure relative paths for Electron
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
    outDir: '../dist', // Output to dist folder in project root
    emptyOutDir: true,
  },
});
