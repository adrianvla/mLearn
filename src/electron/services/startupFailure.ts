import { app, dialog } from 'electron';
import { getUserDataPath } from '../utils/platform';
import { getLogger } from '../../shared/utils/logger';
import { Guardian } from './guardian';

const log = getLogger('electron.main');

/** Startup cannot continue with unavailable persistent state. */
export function handleStartupFailure(error: unknown): void {
  log.error('Application initialization failed', error);
  try {
    const detail = error instanceof Error ? error.message : String(error);
    const folder = getUserDataPath();
    const guardian = new Guardian(folder);
    const latest = detail.includes('Guardian') ? guardian.newestVerifiedRecoveryPoint() : undefined;
    const message = `Startup has stopped to protect your data.\n\nData folder: ${folder}\n\n${detail}`;
    if (latest) {
      const choice = dialog.showMessageBoxSync({
        type: 'error', title: 'mLearn data protection', message,
        detail: `A verified recovery point is available: ${latest}. Restoring keeps the current files in a quarantine folder.`,
        buttons: ['Quit', 'Restore recovery point and restart'], defaultId: 0, cancelId: 0,
      });
      if (choice === 1) {
        try {
          guardian.restore(latest);
          app.relaunch();
        } catch (restoreError) {
          log.error('Guardian recovery failed', restoreError);
          dialog.showErrorBox('Recovery could not finish', `The profile was preserved.\n\n${String(restoreError)}\n\nData folder: ${folder}`);
        }
      }
    } else {
      dialog.showErrorBox('mLearn could not start', `${message}\n\nBack up this folder before repairing files. The app has not reset your data. Restart after resolving the problem.`);
    }
  } catch (displayError) {
    log.error('Failed to display startup error', displayError);
  } finally {
    app.quit();
  }
}
