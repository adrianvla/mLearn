/**
 * Storage Diagnostics Suite
 */

import fs from 'fs';
import path from 'path';

import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { loadSettings, saveSettings } from '../../settings';
import { getUserDataPath } from '../../../utils/platform';

const TEST_PREFIX = '__mlearn_diag_test_';

function testPath(file: string): string {
  return path.join(getUserDataPath(), file);
}

registerDiagnosticSuite({
  name: SUITE_NAMES.STORAGE,
  tests: [
    {
      name: 'settings-read-write',
      timeoutMs: 5_000,
      async fn() {
        const original = loadSettings();
        const testValue = !original.blur_words;
        try {
          await saveSettings({ ...original, blur_words: testValue });
          const reloaded = loadSettings();
          if (reloaded.blur_words !== testValue) {
            throw new Error('Settings round-trip failed');
          }
        } finally {
          await saveSettings(original);
        }
      },
    },
    {
      name: 'flashcards-read-write',
      timeoutMs: 5_000,
      async fn() {
        // Test the filesystem in a disposable location. A diagnostic must
        // never overwrite canonical learner data, even briefly.
        const flashcardsPath = testPath(`${TEST_PREFIX}flashcards.json`);
        const testData = { __diag_test: true, timestamp: Date.now() };
        try {
          fs.writeFileSync(flashcardsPath, JSON.stringify(testData));
          const reloaded = JSON.parse(fs.readFileSync(flashcardsPath, 'utf-8'));
          if (reloaded.__diag_test !== true) throw new Error('Flashcards round-trip failed');
        } finally {
          fs.rmSync(flashcardsPath, { force: true });
        }
      },
    },
    {
      name: 'kv-store-rw',
      timeoutMs: 5_000,
      async fn() {
        const kvPath = testPath('kvStore.json');
        const backupPath = testPath('kvStore.json.diag_backup');
        let original: string | null = null;
        if (fs.existsSync(kvPath)) {
          original = fs.readFileSync(kvPath, 'utf-8');
          fs.writeFileSync(backupPath, original);
        }
        const testData: Record<string, unknown> = { [`${TEST_PREFIX}key`]: 'value' };
        fs.writeFileSync(kvPath, JSON.stringify(testData));
        const reloaded = JSON.parse(fs.readFileSync(kvPath, 'utf-8'));
        if (reloaded[`${TEST_PREFIX}key`] !== 'value') {
          throw new Error('KV store round-trip failed');
        }
        if (original !== null) {
          fs.writeFileSync(kvPath, original);
          fs.unlinkSync(backupPath);
        } else {
          fs.unlinkSync(kvPath);
        }
      },
    },
    {
      name: 'media-stats-rw',
      timeoutMs: 5_000,
      async fn() {
        const statsPath = testPath('mediaStats.json');
        const backupPath = testPath('mediaStats.json.diag_backup');
        let original: string | null = null;
        if (fs.existsSync(statsPath)) {
          original = fs.readFileSync(statsPath, 'utf-8');
          fs.writeFileSync(backupPath, original);
        }
        const testData = { [`${TEST_PREFIX}entry`]: { time: 1 } };
        fs.writeFileSync(statsPath, JSON.stringify(testData));
        const reloaded = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
        if (!reloaded[`${TEST_PREFIX}entry`]) {
          throw new Error('Media stats round-trip failed');
        }
        if (original !== null) {
          fs.writeFileSync(statsPath, original);
          fs.unlinkSync(backupPath);
        } else {
          fs.unlinkSync(statsPath);
        }
      },
    },
    {
      name: 'user-data-writable',
      timeoutMs: 5_000,
      fn() {
        const testFile = testPath(`${TEST_PREFIX}write_test`);
        fs.writeFileSync(testFile, 'ok');
        const content = fs.readFileSync(testFile, 'utf-8');
        fs.unlinkSync(testFile);
        if (content !== 'ok') {
          throw new Error('User data directory is not writable');
        }
      },
    },
  ],
});
