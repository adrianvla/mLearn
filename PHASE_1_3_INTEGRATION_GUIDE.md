# Phase 1.3: Japanese Data Migration - Integration Guide

## Overview

Phase 1.3 integrates the language metadata migration into the app's initialization flow. This ensures all existing Japanese flashcards and settings are automatically migrated to include language metadata when the app loads.

## Integration Points

### 1. SettingsContext Integration

**File**: `src/renderer/context/SettingsContext.tsx`

**Location**: In the `loadSettings()` function, after settings are received:

```typescript
const loadSettings = () => {
  const bridge = getBridge();
  console.log('[SettingsContext] Loading settings...');
  
  ipcCleanups.push(bridge.settings.onSettings((loadedSettings) => {
    console.log('[SettingsContext] Settings received');
    
    // ✅ ADD THIS: Migrate settings if needed
    const migratedSettings = migrateSettingsIfNeeded(loadedSettings);
    
    const mergedSettings = pendingSettingsSnapshot
      ? { ...migratedSettings, ...pendingSettingsSnapshot }
      : migratedSettings;

    setSettings(reconcile(mergedSettings));
    // ... rest of function
  }));
};
```

**Import**:
```typescript
import { migrateSettingsIfNeeded } from '@renderer/services/languageMigrationService';
```

### 2. FlashcardContext Integration

**File**: `src/renderer/context/FlashcardContext.tsx`

**Location**: In the `onFlashcards()` callback, after flashcards are received:

```typescript
ipcCleanups.push(bridge.flashcards.onFlashcards((loadedStore) => {
  console.log('[FlashcardContext] Flashcards received');
  
  // ✅ ADD THIS: Migrate flashcards if needed
  const language = (settings.language || 'ja') as LanguageCode;
  const migratedStore = migrateFlashcardStoreIfNeeded(loadedStore, language);
  
  const checked = ensureStoreFields(migratedStore);
  setStore(reconcile(checked));
  refreshQueue();
  setIsLoading(false);
}));
```

**Import**:
```typescript
import { migrateFlashcardStoreIfNeeded } from '@renderer/services/languageMigrationService';
import type { LanguageCode } from '@shared/language-abstraction';
```

### 3. WindowWrapper Integration (Optional)

**File**: `src/renderer/components/WindowWrapper.tsx`

**Location**: In the initialization effect, after all contexts are loaded:

```typescript
createEffect(() => {
  if (settingsContext.hasLoaded && flashcardContext.hasLoaded) {
    // ✅ ADD THIS: Log migration status for debugging
    logMigrationStatus(settingsContext.settings, flashcardContext.store);
  }
});
```

**Import**:
```typescript
import { logMigrationStatus } from '@renderer/services/languageMigrationService';
```

## Migration Flow

```
App Startup
    ↓
SettingsContext loads settings
    ↓
migrateSettingsIfNeeded() called
    ↓
Settings have language metadata ✅
    ↓
FlashcardContext loads flashcards
    ↓
migrateFlashcardStoreIfNeeded() called
    ↓
Flashcards have language metadata ✅
    ↓
App ready to use
```

## What Gets Migrated

### Settings Migration
- Adds `languageMetadataRegistry` to settings
- Stores current language settings in registry
- Preserves all existing settings values
- Non-destructive (existing data unchanged)

### Flashcard Store Migration
- Adds `languageMetadata` to each flashcard's `extra` field
- Sets language to current learning language (default: 'ja')
- Updates store metadata with migration version
- Non-destructive (existing data unchanged)

## Migration Checks

The migration service includes checks to prevent duplicate migrations:

```typescript
// Check if settings already migrated
if (hasSettingsBeenMigrated(settings)) {
  return settings; // Skip migration
}

// Check if store already migrated
if (hasFlashcardStoreBeenMigrated(store)) {
  return store; // Skip migration
}
```

## Error Handling

If migration fails:
1. Error is logged to console
2. Original data is returned unchanged
3. App continues to function normally
4. User can retry by restarting app

```typescript
try {
  const migratedSettings = performLanguageMetadataMigration(...);
  return migratedSettings;
} catch (error) {
  console.error('[LanguageMigration] Migration failed:', error);
  return settings; // Return original
}
```

## Debugging

### Check Migration Status

```typescript
import { logMigrationStatus } from '@renderer/services/languageMigrationService';

// In console or component
logMigrationStatus(settings, store);
```

Output:
```
[LanguageMigration] Status Report:
  - Settings migrated: true
  - Store migrated: true
  - Migration completed: true
  - Migration in progress: false
  - Current language: ja
  - Flashcard count: 1234
```

### Check Individual Flashcard

```typescript
import { getFlashcardLanguageMetadata } from '@shared/language-metadata-schema';

const card = store.flashcards[cardId];
const metadata = getFlashcardLanguageMetadata(card.content.extra);
console.log(metadata);
// Output: { language: 'ja', proficiencyFramework: 'jlpt', ... }
```

## Testing

### Unit Tests

```typescript
import { migrateSettingsIfNeeded, migrateFlashcardStoreIfNeeded } from '@renderer/services/languageMigrationService';
import { hasSettingsBeenMigrated, hasFlashcardStoreBeenMigrated } from '@shared/language-migration';

describe('Language Migration', () => {
  it('should migrate settings on first load', () => {
    const settings = { ...DEFAULT_SETTINGS };
    const migrated = migrateSettingsIfNeeded(settings);
    expect(hasSettingsBeenMigrated(migrated)).toBe(true);
  });

  it('should not duplicate migration', () => {
    const settings = { ...DEFAULT_SETTINGS };
    const migrated1 = migrateSettingsIfNeeded(settings);
    const migrated2 = migrateSettingsIfNeeded(migrated1);
    expect(migrated1).toEqual(migrated2);
  });

  it('should migrate flashcard store', () => {
    const store = { flashcards: {}, wordStatsMap: {}, ... };
    const migrated = migrateFlashcardStoreIfNeeded(store, 'ja');
    expect(hasFlashcardStoreBeenMigrated(migrated)).toBe(true);
  });
});
```

### Integration Tests

1. Start app with existing Japanese flashcards
2. Check console for migration logs
3. Verify flashcards have language metadata
4. Verify settings have language metadata registry
5. Restart app and verify no duplicate migration

### Manual Testing

1. **First Load**: 
   - Start app with existing data
   - Check console for `[LanguageMigration]` logs
   - Verify migration completed

2. **Subsequent Loads**:
   - Restart app
   - Check console for `already migrated` message
   - Verify no duplicate migration

3. **New Data**:
   - Create new flashcard
   - Verify it has language metadata
   - Check `extra.languageMetadata` field

## Performance Impact

- **First Load**: ~50-100ms for migration (one-time)
- **Subsequent Loads**: <1ms (migration skipped)
- **Per-Flashcard**: <1ms (metadata lookup)
- **Overall**: Negligible impact on app performance

## Rollback (if needed)

If migration causes issues, rollback utilities are available:

```typescript
import { rollbackSettingsLanguageMetadata, rollbackFlashcardStoreLanguageMetadata } from '@shared/language-migration';

// Remove language metadata (for testing)
const original = rollbackSettingsLanguageMetadata(migratedSettings);
const originalStore = rollbackFlashcardStoreLanguageMetadata(migratedStore);
```

## Verification Checklist

- [ ] Migration service created (`src/renderer/services/languageMigrationService.ts`)
- [ ] SettingsContext updated to call `migrateSettingsIfNeeded()`
- [ ] FlashcardContext updated to call `migrateFlashcardStoreIfNeeded()`
- [ ] WindowWrapper updated to log migration status (optional)
- [ ] TypeScript compilation passes
- [ ] App starts without errors
- [ ] Console shows migration logs on first load
- [ ] Console shows "already migrated" on subsequent loads
- [ ] Existing flashcards have language metadata
- [ ] New flashcards have language metadata
- [ ] Settings have language metadata registry

## Next Steps

After Phase 1.3 is complete:
1. Phase 1.4: Add German language support to metadata configuration
2. Phase 2: Implement trait-based NLP backend abstraction
3. Phase 3: Implement dictionary backend abstraction
4. Phase 4: Implement proficiency framework configuration
5. Phase 5: Implement German language support

## References

- `src/renderer/services/languageMigrationService.ts` - Migration service
- `src/shared/language-migration.ts` - Migration logic
- `src/shared/language-metadata-schema.ts` - Metadata schema
- `PHASE_1_IMPLEMENTATION.md` - Phase 1 overview
