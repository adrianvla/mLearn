/// <reference types="node" />
import { defineConfig } from '@playwright/test';

const root = process.env.RUN_TMP;
if (!root) throw new Error('RUN_TMP is required for isolated Material interaction evidence.');

export default defineConfig({
  testDir: '.',
  testMatch: 'material-editor.spec.ts',
  outputDir: `${root}/test-results`,
  reporter: [['list'], ['json', { outputFile: `${root}/interactions.json` }]],
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1080, height: 900 } } },
    { name: 'narrow', use: { viewport: { width: 390, height: 740 } } },
  ],
});
