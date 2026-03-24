import { createRoot } from 'solid-js';
import { useSync } from './SyncContext';

it('useSync returns an object with status and sync functions when no provider', () => {
  createRoot((dispose) => {
    const ctx = useSync();
    expect(typeof ctx.status).toBe('function');
    expect(typeof ctx.sync).toBe('function');
    dispose();
  });
});

it('useSync status() returns offline when no provider', () => {
  createRoot((dispose) => {
    const ctx = useSync();
    expect(ctx.status()).toBe('offline');
    dispose();
  });
});

it('useSync sync() is callable without throwing when no provider', () => {
  createRoot((dispose) => {
    const ctx = useSync();
    expect(() => ctx.sync()).not.toThrow();
    dispose();
  });
});
