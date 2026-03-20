import { createRoot } from 'solid-js';

let migrationListenerReady: () => boolean;
let setMigrationListenerReady: (v: boolean) => void;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./migrationSignals');
  migrationListenerReady = mod.migrationListenerReady;
  setMigrationListenerReady = mod.setMigrationListenerReady;
});

it('migrationListenerReady is a function', () => {
  expect(typeof migrationListenerReady).toBe('function');
});

it('setMigrationListenerReady is a function', () => {
  expect(typeof setMigrationListenerReady).toBe('function');
});

it('initial value is false', () => {
  createRoot((dispose) => {
    expect(migrationListenerReady()).toBe(false);
    dispose();
  });
});

it('can be set to true', () => {
  createRoot((dispose) => {
    setMigrationListenerReady(true);
    expect(migrationListenerReady()).toBe(true);
    dispose();
  });
});

it('can be set back to false', () => {
  createRoot((dispose) => {
    setMigrationListenerReady(true);
    setMigrationListenerReady(false);
    expect(migrationListenerReady()).toBe(false);
    dispose();
  });
});
