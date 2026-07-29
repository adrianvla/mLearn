import type { ParentComponent } from 'solid-js';
import { createEffect, onCleanup, onMount } from 'solid-js';
import { useLanguage } from '@renderer/context/LanguageContext';
import { useLocalization } from '@renderer/context/LocalizationContext';
import { consumePendingFlashcardMigration, setMigrationListenerReady } from '@renderer/context/migrationSignals';
import { getLocalStorageMigrationInfo, resetLocalStorageMigrationInfo } from '@renderer/services/statsService';
import { runZhVariantCleanup } from '@renderer/services/zhVariantCleanup';
import { showToast } from '@renderer/components/common/Feedback/Toast';
import { getLogger } from '@shared/utils/logger';

const log = getLogger('renderer.migrationHandler');

interface FlashcardMigrationInfo {
  occurred: boolean;
  backupPath: string | null;
  fromVersion: number | null;
}

/** Must remain outside FlashcardProvider so its migration listener is ready first. */
export const MigrationHandler: ParentComponent = (props) => {
  const { t } = useLocalization();
  const { langData } = useLanguage();

  createEffect(() => {
    if (!langData.zh?.legacyCodes?.length) return;
    void runZhVariantCleanup(langData).catch((error: unknown) => log.error('Zh variant cleanup failed:', error));
  });

  onMount(() => {
    const processFlashcardMigration = (info: FlashcardMigrationInfo | undefined) => {
      if (!info?.occurred) return;
      showToast({
        variant: 'success',
        title: t('mlearn.Notifications.MigrationComplete'),
        message: info.backupPath
          ? t('mlearn.Notifications.MigrationFlashcards', { version: info.fromVersion ?? '' })
          : t('mlearn.Notifications.MigrationFlashcardsNoBackup', { version: info.fromVersion ?? '' }),
        duration: 10000,
      });
    };

    const lsInfo = getLocalStorageMigrationInfo();
    if (lsInfo.occurred) {
      showToast({
        variant: 'info',
        title: t('mlearn.Notifications.MigrationComplete'),
        message: t('mlearn.Notifications.MigrationWordStatuses', { count: lsInfo.migratedWordCount }),
        duration: 8000,
      });
      resetLocalStorageMigrationInfo();
    }

    const handleFlashcardMigration = (event: Event) => processFlashcardMigration((event as CustomEvent<FlashcardMigrationInfo>).detail);
    window.addEventListener('mlearn-flashcard-migration', handleFlashcardMigration);
    setMigrationListenerReady(true);
    processFlashcardMigration(consumePendingFlashcardMigration() ?? undefined);

    onCleanup(() => {
      setMigrationListenerReady(false);
      window.removeEventListener('mlearn-flashcard-migration', handleFlashcardMigration);
    });
  });

  return props.children;
};
