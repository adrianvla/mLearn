import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  loadAuthToken,
  saveAuthToken,
  clearAuthToken,
  getAuthToken,
} from './authTokenCache';

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

describe('authTokenCache', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => { delete mockStorage[key]; });
  });

  describe('loadAuthToken', () => {
    it('returns empty string by default when no storage value', async () => {
      const result = await loadAuthToken();
      expect(result).toBe('');
    });

    it('returns stored token when available', async () => {
      mockStorage['mlearn-extension-auth-token'] = 'test-token-123';
      const result = await loadAuthToken();
      expect(result).toBe('test-token-123');
    });

    it('returns empty string for non-string stored value', async () => {
      mockStorage['mlearn-extension-auth-token'] = 42;
      const result = await loadAuthToken();
      expect(result).toBe('');
    });
  });

  describe('saveAuthToken', () => {
    it('stores the token in chrome.storage', async () => {
      await saveAuthToken('my-auth-token');
      expect(mockStorage['mlearn-extension-auth-token']).toBe('my-auth-token');
    });

    it('updates getAuthToken return value', async () => {
      await saveAuthToken('my-auth-token');
      expect(getAuthToken()).toBe('my-auth-token');
    });
  });

  describe('clearAuthToken', () => {
    it('clears the token from storage', async () => {
      mockStorage['mlearn-extension-auth-token'] = 'token-to-clear';
      await clearAuthToken();
      expect(mockStorage['mlearn-extension-auth-token']).toBe('');
    });

    it('updates getAuthToken to return empty string', async () => {
      await saveAuthToken('token-before-clear');
      expect(getAuthToken()).toBe('token-before-clear');
      await clearAuthToken();
      expect(getAuthToken()).toBe('');
    });
  });

  describe('getAuthToken', () => {
    it('returns empty string before any load or save', () => {
      expect(getAuthToken()).toBe('');
    });

    it('returns the value set by saveAuthToken', async () => {
      await saveAuthToken('fresh-token');
      expect(getAuthToken()).toBe('fresh-token');
    });
  });
});
