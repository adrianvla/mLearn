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
    maxWorkers: 4,
    setupFiles: ['./test/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
           include: [
             'src/electron/**/*.test.ts',
             'src/shared/settingRequirements.test.ts',
             'src/shared/managementPolicy.test.ts',
             'src/shared/plugins/**/*.test.ts',
             'src/shared/utils/**/*.test.ts',
             'extension/src/**/*.test.ts',
             'test/**/*.test.ts',
           ],
        },
      },
      {
        extends: true,
        test: {
          name: 'examples',
          environment: 'node',
          include: [
            'examples/plugins/**/*.test.ts',
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
            'src/renderer/**/*.test.tsx',
            'src/shared/bridges/**/*.test.ts',
            'src/shared/backends/**/*.test.ts',
            'src/shared/platform.test.ts',
          ],
        },
      },
    ],
  },
});
