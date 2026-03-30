import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

function readRequiredFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

describe('generic app activity naming', () => {
  it('keeps generic plugin bus files free of Discord-specific naming', () => {
    const appSideFiles = [
      'src/shared/plugins/appActivity.ts',
      'src/shared/pluginBus.ts',
      'src/electron/services/pluginBus.ts',
      'src/electron/services/pluginIPC.ts',
      'src/electron/preload.ts',
      'src/shared/bridges/types.ts',
      'src/shared/bridges/electronBridge.ts',
      'src/shared/bridges/capacitorBridge.ts',
      'src/shared/global.d.ts',
    ];

    for (const relativePath of appSideFiles) {
      expect(readRequiredFile(relativePath)).not.toMatch(/discord/i);
    }
  });
});
