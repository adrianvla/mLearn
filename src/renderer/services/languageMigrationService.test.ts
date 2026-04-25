import type { Settings, FlashcardStore, Flashcard } from '@shared/types';
import {
  migrateSettingsToLanguageMetadata,
  migrateFlashcardStoreToLanguageMetadata,
  hasSettingsBeenMigrated,
  hasFlashcardStoreBeenMigrated,
  performLanguageMetadataMigration,
} from '@shared/language-migration';
import {
  migrateSettingsIfNeeded,
  migrateFlashcardStoreIfNeeded,
} from './languageMigrationService';

const makeSettings = (overrides: Partial<Settings> = {}): Settings =>
  ({ language: 'ja', ...overrides } as Settings);

const makeCard = (id: string): Flashcard =>
  ({
    id,
    content: { front: id, back: id, extra: {} },
  } as unknown as Flashcard);

const makeStore = (overrides: Partial<FlashcardStore> = {}): FlashcardStore =>
  ({
    flashcards: { a: makeCard('a') },
    meta: {},
    ...overrides,
  } as unknown as FlashcardStore);

describe('migrateSettingsToLanguageMetadata', () => {
  it('attaches a languageMetadataRegistry when absent', () => {
    const settings = makeSettings({ language: 'de' });
    const migrated = migrateSettingsToLanguageMetadata(settings);

    expect(hasSettingsBeenMigrated(migrated)).toBe(true);
    const registry = (migrated as any).languageMetadataRegistry;
    expect(registry.schemaVersion).toBe(1);
    expect(registry.languageSettings.de).toBeDefined();
    expect(registry.languageSettings.de.language).toBe('de');
  });

  it('is idempotent when registry already present', () => {
    const first = migrateSettingsToLanguageMetadata(makeSettings());
    const firstRegistry = (first as any).languageMetadataRegistry;
    const second = migrateSettingsToLanguageMetadata(first);
    expect((second as any).languageMetadataRegistry).toBe(firstRegistry);
  });
});

describe('migrateFlashcardStoreToLanguageMetadata', () => {
  it('marks store as migrated and preserves cards', () => {
    const store = makeStore();
    const migrated = migrateFlashcardStoreToLanguageMetadata(store, 'de');

    expect(hasFlashcardStoreBeenMigrated(migrated)).toBe(true);
    expect((migrated.meta as any).languageMigrationVersion).toBe(1);
    expect(Object.keys(migrated.flashcards)).toEqual(['a']);
  });

  it('tolerates a store with missing meta (partial input)', () => {
    const partial = { flashcards: {} } as unknown as FlashcardStore;
    expect(() => migrateFlashcardStoreToLanguageMetadata(partial, 'ja')).not.toThrow();
    const migrated = migrateFlashcardStoreToLanguageMetadata(partial, 'ja');
    expect(hasFlashcardStoreBeenMigrated(migrated)).toBe(true);
  });

  it('tolerates a store with missing flashcards', () => {
    const partial = { meta: {} } as unknown as FlashcardStore;
    expect(() => migrateFlashcardStoreToLanguageMetadata(partial, 'ja')).not.toThrow();
    const migrated = migrateFlashcardStoreToLanguageMetadata(partial, 'ja');
    expect(migrated.flashcards).toEqual({});
  });
});

describe('hasFlashcardStoreBeenMigrated', () => {
  it('returns false when meta is missing entirely', () => {
    const partial = { flashcards: {} } as unknown as FlashcardStore;
    expect(hasFlashcardStoreBeenMigrated(partial)).toBe(false);
  });

  it('returns false when meta lacks languageMigrationVersion', () => {
    expect(hasFlashcardStoreBeenMigrated(makeStore())).toBe(false);
  });

  it('returns true after migration', () => {
    const migrated = migrateFlashcardStoreToLanguageMetadata(makeStore(), 'ja');
    expect(hasFlashcardStoreBeenMigrated(migrated)).toBe(true);
  });
});

describe('performLanguageMetadataMigration', () => {
  it('migrates both settings and store when neither is migrated', () => {
    const { settings, store } = performLanguageMetadataMigration(
      makeSettings(),
      makeStore(),
      'ja',
    );
    expect(hasSettingsBeenMigrated(settings)).toBe(true);
    expect(hasFlashcardStoreBeenMigrated(store)).toBe(true);
  });
});

describe('migrateSettingsIfNeeded (service)', () => {
  it('returns migrated settings with registry attached (regression: dummy-store bug)', () => {
    const settings = makeSettings({ language: 'de' });
    const migrated = migrateSettingsIfNeeded(settings);
    expect(hasSettingsBeenMigrated(migrated)).toBe(true);
  });

  it('returns already-migrated settings unchanged', () => {
    const pre = migrateSettingsToLanguageMetadata(makeSettings());
    const migrated = migrateSettingsIfNeeded(pre);
    expect(migrated).toBe(pre);
  });
});

describe('migrateFlashcardStoreIfNeeded (service)', () => {
  it('migrates a fresh store', () => {
    const migrated = migrateFlashcardStoreIfNeeded(makeStore(), 'ja');
    expect(hasFlashcardStoreBeenMigrated(migrated)).toBe(true);
  });

  it('returns already-migrated store unchanged', () => {
    const pre = migrateFlashcardStoreToLanguageMetadata(makeStore(), 'ja');
    const migrated = migrateFlashcardStoreIfNeeded(pre, 'ja');
    expect(migrated).toBe(pre);
  });
});
