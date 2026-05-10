import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  loadHeadlessMode,
  setHeadlessMode,
  getHeadlessMode,
  isHeadlessEnabled,
  toggleHeadlessMode,
} from './headlessState';

const mockStorage: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string) => Promise.resolve({ [key]: mockStorage[key] })),
      set: vi.fn((data: Record<string, unknown>) => {
        Object.assign(mockStorage, data);
        return Promise.resolve();
      }),
    },
  },
});

describe('headlessState', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => { delete mockStorage[key]; });
  });

  describe('loadHeadlessMode', () => {
    it('returns disabled by default when no storage value', async () => {
      const result = await loadHeadlessMode();
      expect(result).toBe('disabled');
    });

    it('returns stored value when available', async () => {
      mockStorage['mlearn-headless-mode'] = 'enabled';
      const result = await loadHeadlessMode();
      expect(result).toBe('enabled');
    });

    it('returns disabled for invalid stored value', async () => {
      mockStorage['mlearn-headless-mode'] = 'invalid';
      const result = await loadHeadlessMode();
      expect(result).toBe('disabled');
    });
  });

  describe('setHeadlessMode', () => {
    it('stores the mode in chrome.storage', async () => {
      await setHeadlessMode('enabled');
      expect(mockStorage['mlearn-headless-mode']).toBe('enabled');
    });

    it('updates getHeadlessMode return value', async () => {
      await setHeadlessMode('enabled');
      expect(getHeadlessMode()).toBe('enabled');
    });
  });

  describe('isHeadlessEnabled', () => {
    it('returns false when mode is disabled', async () => {
      await setHeadlessMode('disabled');
      expect(isHeadlessEnabled()).toBe(false);
    });

    it('returns true when mode is enabled', async () => {
      await setHeadlessMode('enabled');
      expect(isHeadlessEnabled()).toBe(true);
    });
  });

  describe('toggleHeadlessMode', () => {
    it('toggles from disabled to enabled', async () => {
      await setHeadlessMode('disabled');
      const result = await toggleHeadlessMode();
      expect(result).toBe('enabled');
      expect(getHeadlessMode()).toBe('enabled');
    });

    it('toggles from enabled to disabled', async () => {
      await setHeadlessMode('enabled');
      const result = await toggleHeadlessMode();
      expect(result).toBe('disabled');
      expect(getHeadlessMode()).toBe('disabled');
    });
  });
});