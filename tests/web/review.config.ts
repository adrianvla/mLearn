/// <reference types="node" />
import { defineConfig } from '@playwright/test';

const root = process.env.RUN_TMP;
if (!root) throw new Error('RUN_TMP is required for isolated Review evidence.');
export default defineConfig({
  testDir: '.', testMatch: 'review.spec.ts', workers: 1, timeout: 30_000,
  outputDir: `${root}/review-results`,
  reporter: [['list'], ['json', { outputFile: `${root}/review-interactions.json` }]],
  use: { browserName: 'chromium', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-light', use: { viewport: { width: 1080, height: 900 }, colorScheme: 'light' } },
    { name: 'narrow-light', use: { viewport: { width: 390, height: 740 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { viewport: { width: 1080, height: 900 }, colorScheme: 'dark' } },
    { name: 'narrow-dark', use: { viewport: { width: 390, height: 740 }, colorScheme: 'dark' } },
  ],
});
