import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';

let migrationListenerReady: () => boolean;
let setMigrationListenerReady: (v: boolean) => void;
let queuePendingFlashcardMigration: (info: { occurred: boolean; backupPath: string | null; fromVersion: number | null }) => void;
let consumePendingFlashcardMigration: () => { occurred: boolean; backupPath: string | null; fromVersion: number | null } | null;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('./migrationSignals');
  migrationListenerReady = mod.migrationListenerReady;
  setMigrationListenerReady = mod.setMigrationListenerReady;
  queuePendingFlashcardMigration = mod.queuePendingFlashcardMigration;
  consumePendingFlashcardMigration = mod.consumePendingFlashcardMigration;
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

it('queues and consumes a pending flashcard migration only once', () => {
  createRoot((dispose) => {
    const info = { occurred: true, backupPath: '/tmp/flashcards.json.bak', fromVersion: 4 };

    queuePendingFlashcardMigration(info);

    expect(consumePendingFlashcardMigration()).toEqual(info);
    expect(consumePendingFlashcardMigration()).toBeNull();
    dispose();
  });
});
