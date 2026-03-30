import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

function readRequiredFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

describe('generic app activity naming', () => {
  it('keeps app-side activity implementation free of Discord-specific naming', () => {
    const appSideFiles = [
      'src/shared/plugins/appActivity.ts',
      'src/shared/appActivityIpc.ts',
      'src/electron/services/pluginAppActivity.ts',
      'src/electron/services/pluginIPC.ts',
      'src/electron/preload.ts',
      'src/shared/bridges/types.ts',
      'src/shared/bridges/electronBridge.ts',
      'src/shared/bridges/capacitorBridge.ts',
      'src/shared/global.d.ts',
      'src/renderer/windows/main/routes/readerActivityPublisher.ts',
      'src/renderer/windows/main/routes/videoActivityPublisher.ts',
      'src/renderer/windows/flashcards/flashcardsActivityPublisher.ts',
    ];

    for (const relativePath of appSideFiles) {
      expect(readRequiredFile(relativePath)).not.toMatch(/discord/i);
    }
  });
});
