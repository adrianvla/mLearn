import { defineConfig, Plugin } from 'vite';
import { resolve } from 'path';
import { renameSync, existsSync, unlinkSync, cpSync } from 'fs';
import solidPlugin from 'vite-plugin-solid';
import { PYTHON_BACKEND_PORT } from './src/shared/constants';

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

function appManualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/');
  if (
    normalized.includes('/src/renderer/') ||
    normalized.includes('/src/shared/')
  ) {
    return 'app';
  }
  return undefined;
}

export default defineConfig(({ mode }) => {
  const isCapacitor = mode === 'capacitor';
  const input: Record<string, string> = isCapacitor
    ? {
        mobile: resolve(__dirname, 'src/html/mobile.html'),
      }
    : {
        main: resolve(__dirname, 'src/html/main.html'),
        welcome: resolve(__dirname, 'src/html/welcome.html'),
        flashcards: resolve(__dirname, 'src/html/flashcards.html'),
        settings: resolve(__dirname, 'src/html/settings.html'),
        statistics: resolve(__dirname, 'src/html/statistics.html'),
        'word-db-editor': resolve(__dirname, 'src/html/word-db-editor.html'),
        'character-grid': resolve(__dirname, 'src/html/character-grid.html'),
        licenses: resolve(__dirname, 'src/html/licenses.html'),
        'connect-qr': resolve(__dirname, 'src/html/connect-qr.html'),
        'conversation-agent': resolve(__dirname, 'src/html/conversation-agent.html'),
        'word-definition': resolve(__dirname, 'src/html/word-definition.html'),
        'plugin-host': resolve(__dirname, 'src/html/plugin-host.html'),
        'word-sync': resolve(__dirname, 'src/html/word-sync.html'),
        'level-study': resolve(__dirname, 'src/html/level-study.html'),
        overlay: resolve(__dirname, 'src/html/overlay.html'),
        diagnostics: resolve(__dirname, 'src/html/diagnostics.html'),
      };

  return {
    plugins: [solidPlugin(), ...(isCapacitor ? [capacitorHtmlPlugin()] : [])],
    base: './', // Ensure relative paths for Electron / Capacitor
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        '/tokenize': `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
        '/translate': `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
        '/ocr': `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
        '/llm': `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
        '/voice': {
          target: `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
          ws: true,
        },
        '/control': `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
        '/health': `http://127.0.0.1:${PYTHON_BACKEND_PORT}`,
      },
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    define: {
      global: 'globalThis',
      'process.env': {},
      __PLATFORM__: JSON.stringify(isCapacitor ? 'capacitor' : 'electron'),
    },
    optimizeDeps: {
      include: ['buffer', 'process'],
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
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
        input,
        external: isCapacitor ? ['electron'] : [],
        output: {
          manualChunks: appManualChunks,
        },
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
