/**
 * Migration Signals
 * Shared signals for coordinating migration notifications between components
 * Extracted to avoid circular dependencies between WindowWrapper and FlashcardContext
 */

import { createSignal } from 'solid-js';

// Signal to track if the migration listener in MigrationHandler is ready
const [migrationListenerReady, setMigrationListenerReady] = createSignal(false);

export { migrationListenerReady, setMigrationListenerReady };
