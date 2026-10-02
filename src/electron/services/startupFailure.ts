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
      // A schema block can mean an OLDER release latched its refusal into the
      // ledger, which stops THIS release from starting even though it reads the
      // data fine. Continuing re-checks the live data and keeps it; restoring
      // would instead roll progress back to a snapshot, so continue is offered
      // first and is the default. Every other block reason keeps the restore-only
      // choice, because only a restore is then justified.
      const canResume = guardian.canResumeSchemaBlock();
      const resumeButton = 'Continue with current data';
      const restoreButton = 'Restore recovery point and restart';
      const buttons = canResume
        ? ['Quit', resumeButton, restoreButton]
        : ['Quit', restoreButton];
      const resumeIndex = canResume ? 1 : -1;
      const restoreIndex = canResume ? 2 : 1;
      const choice = dialog.showMessageBoxSync({
        type: 'error', title: 'mLearn data protection', message,
        detail: `A verified recovery point is available: ${latest}. Restoring keeps the current files in a quarantine folder.`,
        buttons, defaultId: canResume ? resumeIndex : 0, cancelId: 0,
      });
      if (choice === resumeIndex) {
        try {
          guardian.resumeAfterSchemaBlock();
          app.relaunch();
        } catch (resumeError) {
          log.error('Guardian resume failed', resumeError);
          dialog.showErrorBox('Startup could not continue', `Nothing was changed.\n\n${String(resumeError)}\n\nData folder: ${folder}`);
        }
      } else if (choice === restoreIndex) {
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
