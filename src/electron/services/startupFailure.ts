import { app, dialog } from 'electron';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.main');

/** Startup cannot continue with unavailable persistent state. */
export function handleStartupFailure(error: unknown): void {
  log.error('Application initialization failed', error);
  try {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'mLearn could not start',
      `Startup has stopped to protect your data. Your data has not been reset.\n\n`
      + `Data folder: ${getUserDataPath()}\n\n`
      + `Back up this folder before repairing files or restoring a backup. Check that the folder is accessible, then restart mLearn. If the problem persists, include this error when requesting support.\n\n`
      + detail,
    );
  } catch (displayError) {
    log.error('Failed to display startup error', displayError);
  } finally {
    app.quit();
  }
}
