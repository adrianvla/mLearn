import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface TempDir {
  tmpDir: string;
  cleanup: () => void;
}

export function createTempDir(prefix = 'mlearn-test-'): TempDir {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    tmpDir: dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
      }
    },
  };
}

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}
