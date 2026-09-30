/** Chromium scheme declarations must run before app.whenReady(). Keep this import cheap. */
import { protocol } from 'electron';

export function registerLocalMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'local-media',
    privileges: {
      // Chromium needs a standard streaming scheme to retain Range headers.
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false,
    },
  }]);
}

export function registerPluginUiScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'plugin-ui',
    privileges: {
      // Plugin bundles load as ES modules, which Chromium validates against
      // the scheme's CORS privileges before `protocol.handle` is consulted.
      // `standard` + `corsEnabled` declare that scheme as fetchable cross-origin.
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: false,
      bypassCSP: false,
    },
  }]);
}

export function registerFlashcardImageScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'flashcard-image',
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  }]);
}

export function registerFlashcardAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'flashcard-audio',
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  }]);
}

export function registerFlashcardVideoScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'flashcard-video',
    privileges: {
      standard: true,
      corsEnabled: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  }]);
}

export function registerStartupSchemes(): void {
  registerLocalMediaScheme();
  registerPluginUiScheme();
  registerFlashcardImageScheme();
  registerFlashcardAudioScheme();
  registerFlashcardVideoScheme();
}
