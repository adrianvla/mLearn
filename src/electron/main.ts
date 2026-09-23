/** Minimal entry point: paint the splash before loading application services. */
import './userDataOverride';
import { app } from 'electron';
import { createSplashWindow } from './splashWindow';
import { registerStartupSchemes } from './startupSchemes';

registerStartupSchemes();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    try {
      await createSplashWindow();
      // The first paint has happened before the application service graph loads.
      require('./appMain');
    } catch (error) {
      // Keep the normal startup failure boundary, including Guardian recovery.
      require('./services/startupFailure').handleStartupFailure(error);
    }
  });
}
