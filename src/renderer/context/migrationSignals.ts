/**
 * Migration Signals
 * Shared signals for coordinating migration notifications between components
 * Extracted to avoid circular dependencies between WindowWrapper and FlashcardContext
 */

import { createSignal } from 'solid-js';

export interface FlashcardMigrationNotification {
	occurred: boolean;
	backupPath: string | null;
	fromVersion: number | null;
}

// Signal to track if the migration listener in MigrationHandler is ready
const [migrationListenerReady, setMigrationListenerReady] = createSignal(false);
const [pendingFlashcardMigration, setPendingFlashcardMigration] = createSignal<FlashcardMigrationNotification | null>(null);

export function queuePendingFlashcardMigration(info: FlashcardMigrationNotification): void {
	setPendingFlashcardMigration(info);
}

export function consumePendingFlashcardMigration(): FlashcardMigrationNotification | null {
	const info = pendingFlashcardMigration();
	if (info) {
		setPendingFlashcardMigration(null);
	}
	return info;
}

export { migrationListenerReady, setMigrationListenerReady };
