import { describe, expect, it } from 'vitest';
import { appManualChunks } from '../vite.config';

describe('appManualChunks', () => {
  it('keeps Electron window entrypoints out of the shared app chunk', () => {
    expect(appManualChunks('/repo/src/renderer/windows/main/index.tsx')).toBeUndefined();
    expect(appManualChunks('/repo/src/renderer/windows/welcome/index.tsx?import')).toBeUndefined();
    expect(appManualChunks('C:\\repo\\src\\renderer\\windows\\settings\\index.tsx')).toBeUndefined();
  });

  it('keeps normal renderer and shared modules in the shared app chunk', () => {
    expect(appManualChunks('/repo/src/renderer/components/common/Button.tsx')).toBe('app');
    expect(appManualChunks('/repo/src/shared/types.ts')).toBe('app');
  });
});
