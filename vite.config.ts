import { defineConfig } from 'vite';
import { resolve } from 'path';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  base: './', // Ensure relative paths for Electron
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/html/main.html'),
        welcome: resolve(__dirname, 'src/html/welcome.html'),
        flashcards: resolve(__dirname, 'src/html/flashcards.html'),
        settings: resolve(__dirname, 'src/html/settings.html'),
        'word-db-editor': resolve(__dirname, 'src/html/word-db-editor.html'),
        'kanji-grid': resolve(__dirname, 'src/html/kanji-grid.html'),
        licenses: resolve(__dirname, 'src/html/licenses.html'),
        'connect-qr': resolve(__dirname, 'src/html/connect-qr.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  // CSS handling
  css: {
    devSourcemap: true,
  },
});
