import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlatformBridge } from './types';

const mockElectronBridge: PlatformBridge = {
  settings: {} as PlatformBridge['settings'],
  flashcards: {} as PlatformBridge['flashcards'],
  localization: {} as PlatformBridge['localization'],
  files: {} as PlatformBridge['files'],
  window: {} as PlatformBridge['window'],
  server: {} as PlatformBridge['server'],
  installer: {} as PlatformBridge['installer'],
  llm: {} as PlatformBridge['llm'],
  speech: {} as PlatformBridge['speech'],
  voice: {} as PlatformBridge['voice'],
  mediaStats: {} as PlatformBridge['mediaStats'],
  watchTogether: {} as PlatformBridge['watchTogether'],
  crossWindow: {} as PlatformBridge['crossWindow'],
  license: {} as PlatformBridge['license'],
  migration: {} as PlatformBridge['migration'],
  generic: {} as PlatformBridge['generic'],
  data: {} as PlatformBridge['data'],
  kvStore: {} as PlatformBridge['kvStore'],
};

const mockCapacitorBridge: PlatformBridge = {
  settings: {} as PlatformBridge['settings'],
  flashcards: {} as PlatformBridge['flashcards'],
  localization: {} as PlatformBridge['localization'],
  files: {} as PlatformBridge['files'],
  window: {} as PlatformBridge['window'],
  server: {} as PlatformBridge['server'],
  installer: {} as PlatformBridge['installer'],
  llm: {} as PlatformBridge['llm'],
  speech: {} as PlatformBridge['speech'],
  voice: {} as PlatformBridge['voice'],
  mediaStats: {} as PlatformBridge['mediaStats'],
  watchTogether: {} as PlatformBridge['watchTogether'],
  crossWindow: {} as PlatformBridge['crossWindow'],
  license: {} as PlatformBridge['license'],
  migration: {} as PlatformBridge['migration'],
  generic: {} as PlatformBridge['generic'],
  data: {} as PlatformBridge['data'],
  kvStore: {} as PlatformBridge['kvStore'],
};

vi.mock('../platform', () => ({
  getPlatform: vi.fn(() => 'electron'),
}));

vi.mock('./electronBridge', () => ({
  createElectronBridge: vi.fn(() => mockElectronBridge),
}));

vi.mock('./capacitorBridge', () => ({
  createCapacitorBridge: vi.fn(() => mockCapacitorBridge),
}));

describe('getBridge()', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls createElectronBridge when platform is electron', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('electron');

    const { getBridge } = await import('./index');
    const { createElectronBridge } = await import('./electronBridge');

    getBridge();

    expect(createElectronBridge).toHaveBeenCalledOnce();
  });

  it('returns the electron bridge instance when platform is electron', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('electron');

    const { getBridge } = await import('./index');

    const result = getBridge();

    expect(result).toBe(mockElectronBridge);
  });

  it('calls createCapacitorBridge when platform is capacitor', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('capacitor');

    const { getBridge } = await import('./index');
    const { createCapacitorBridge } = await import('./capacitorBridge');

    getBridge();

    expect(createCapacitorBridge).toHaveBeenCalledOnce();
  });

  it('returns the capacitor bridge instance when platform is capacitor', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('capacitor');

    const { getBridge } = await import('./index');

    const result = getBridge();

    expect(result).toBe(mockCapacitorBridge);
  });

  it('calls createCapacitorBridge when platform is web', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('web');

    const { getBridge } = await import('./index');
    const { createCapacitorBridge } = await import('./capacitorBridge');

    getBridge();

    expect(createCapacitorBridge).toHaveBeenCalledOnce();
  });

  it('returns the capacitor bridge instance when platform is web', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('web');

    const { getBridge } = await import('./index');

    const result = getBridge();

    expect(result).toBe(mockCapacitorBridge);
  });

  it('returns a singleton — second call returns the same instance', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('electron');

    const { getBridge } = await import('./index');

    const first = getBridge();
    const second = getBridge();

    expect(first).toBe(second);
  });

  it('only creates the bridge once for multiple calls (singleton)', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('electron');

    const { getBridge } = await import('./index');
    const { createElectronBridge } = await import('./electronBridge');

    getBridge();
    getBridge();
    getBridge();

    expect(createElectronBridge).toHaveBeenCalledOnce();
  });

  it('does not call createCapacitorBridge when platform is electron', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('electron');

    const { getBridge } = await import('./index');
    const { createCapacitorBridge } = await import('./capacitorBridge');

    getBridge();

    expect(createCapacitorBridge).not.toHaveBeenCalled();
  });

  it('does not call createElectronBridge when platform is capacitor', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('capacitor');

    const { getBridge } = await import('./index');
    const { createElectronBridge } = await import('./electronBridge');

    getBridge();

    expect(createElectronBridge).not.toHaveBeenCalled();
  });

  it('does not call createElectronBridge when platform is web', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('web');

    const { getBridge } = await import('./index');
    const { createElectronBridge } = await import('./electronBridge');

    getBridge();

    expect(createElectronBridge).not.toHaveBeenCalled();
  });

  it('returned bridge has all 18 PlatformBridge keys', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('electron');

    const { getBridge } = await import('./index');

    const result = getBridge();

    const expectedKeys: (keyof PlatformBridge)[] = [
      'settings',
      'flashcards',
      'localization',
      'files',
      'window',
      'server',
      'installer',
      'llm',
      'speech',
      'voice',
      'mediaStats',
      'watchTogether',
      'crossWindow',
      'license',
      'migration',
      'generic',
      'data',
      'kvStore',
    ];

    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }
  });

  it('electron and capacitor bridges are distinct objects', async () => {
    expect(mockElectronBridge).not.toBe(mockCapacitorBridge);
  });

  it('getPlatform is called exactly once per fresh module load', async () => {
    const { getPlatform } = await import('../platform');
    vi.mocked(getPlatform).mockReturnValue('electron');

    const { getBridge } = await import('./index');

    getBridge();
    getBridge();

    expect(getPlatform).toHaveBeenCalledOnce();
  });
});
