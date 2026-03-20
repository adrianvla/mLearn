import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  define: {
    global: 'globalThis',
    'process.env': {},
    __PLATFORM__: JSON.stringify('electron'),
  },
  test: {
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/electron/**/*.test.ts',
            'src/shared/utils/**/*.test.ts',
            'test/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: [
            'src/renderer/**/*.test.ts',
            'src/shared/bridges/**/*.test.ts',
            'src/shared/backends/**/*.test.ts',
            'src/shared/platform.test.ts',
          ],
        },
      },
    ],
  },
});
