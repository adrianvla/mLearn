import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { renameSync, existsSync, unlinkSync, cpSync } from 'fs';
import solidPlugin from 'vite-plugin-solid';

/**
 * Vite plugin to move the mobile entry HTML to index.html at the output root.
 * Capacitor requires dist-mobile/index.html.
 */
function capacitorHtmlPlugin(): Plugin {
  return {
    name: 'capacitor-html',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist-mobile');
      const nested = resolve(outDir, 'src/html/mobile.html');
      const target = resolve(outDir, 'index.html');
      if (existsSync(nested)) {
        if (existsSync(target)) unlinkSync(target);
        renameSync(nested, target);
        // Clean up empty dirs
        try {
          const { rmdirSync } = require('fs');
          rmdirSync(resolve(outDir, 'src/html'));
          rmdirSync(resolve(outDir, 'src'));
        } catch { /* ignore */ }
      }

      // Copy static assets (icons, fonts, images) so runtime paths resolve
      const assetsSrc = resolve(__dirname, 'src/html/assets');
      const assetsDest = resolve(outDir, 'assets/icons');
      if (existsSync(assetsSrc)) {
        cpSync(resolve(assetsSrc, 'icons'), assetsDest, { recursive: true });
        const imgSrc = resolve(assetsSrc, 'img');
        if (existsSync(imgSrc)) {
          cpSync(imgSrc, resolve(outDir, 'assets/img'), { recursive: true });
        }
        const fontsSrc = resolve(assetsSrc, 'fonts');
        if (existsSync(fontsSrc)) {
          cpSync(fontsSrc, resolve(outDir, 'assets/fonts'), { recursive: true });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isCapacitor = mode === 'capacitor';

  return {
    plugins: [solidPlugin(), ...(isCapacitor ? [capacitorHtmlPlugin()] : [])],
    base: './', // Ensure relative paths for Electron / Capacitor
    server: {
      port: 3000,
      strictPort: true,
    },
    // Define global for browser compatibility (needed for simple-peer)
    define: {
      global: 'globalThis',
      'process.env': {},
      __PLATFORM__: JSON.stringify(isCapacitor ? 'capacitor' : 'electron'),
    },
    optimizeDeps: {
      // Include simple-peer and its dependencies for proper bundling
      include: ['simple-peer', 'buffer', 'process'],
      esbuildOptions: {
        // Node.js global to browser globalThis
        define: {
          global: 'globalThis',
        },
      },
    },
    build: {
      target: 'esnext',
      outDir: isCapacitor ? 'dist-mobile' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: isCapacitor
          ? { mobile: resolve(__dirname, 'src/html/mobile.html') }
          : {
              main: resolve(__dirname, 'src/html/main.html'),
              welcome: resolve(__dirname, 'src/html/welcome.html'),
              flashcards: resolve(__dirname, 'src/html/flashcards.html'),
              settings: resolve(__dirname, 'src/html/settings.html'),
              statistics: resolve(__dirname, 'src/html/statistics.html'),
              'word-db-editor': resolve(__dirname, 'src/html/word-db-editor.html'),
              'kanji-grid': resolve(__dirname, 'src/html/kanji-grid.html'),
              licenses: resolve(__dirname, 'src/html/licenses.html'),
              'connect-qr': resolve(__dirname, 'src/html/connect-qr.html'),
              'conversation-agent': resolve(__dirname, 'src/html/conversation-agent.html'),
            },
        external: isCapacitor ? ['electron'] : [],
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
        // Capacitor: stub out electron imports
        ...(isCapacitor ? { electron: resolve(__dirname, 'src/shared/stubs/electron.ts') } : {}),
      },
    },
    // CSS handling
    css: {
      devSourcemap: true,
    },
  };
});
