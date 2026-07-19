// @vitest-environment happy-dom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageDataInstallError } from '../../../../shared/types';

const installLanguageDataMock = vi.fn();
const openWindowMock = vi.fn();
const [installing, setInstalling] = createSignal(false);
const [installError, setInstallError] = createSignal<LanguageDataInstallError | null>(null);

const translations: Record<string, string> = {
  'mlearn.LanguageSetup.LanguageUpdateMessage': 'An update is available for your learning language data. Update it here to continue.',
  'mlearn.LanguageSetup.UpdateFailed': 'The language data update failed. Try again.',
  'mlearn.LanguageSetup.UpdateNow': 'Update Now',
  'mlearn.LanguageSetup.UpdateTitle': 'Language Data Update Available',
  'mlearn.LanguageSetup.Updating': 'Updating…',
  'mlearn.LanguageSetup.UpdatingMessage': 'Downloading and installing the latest language data.',
};

vi.mock('../../../context', () => ({
  useServer: () => ({
    error: () => null,
    isConnected: () => true,
    restartBackend: vi.fn(),
    status: () => 'connected',
    statusMessage: () => '',
  }),
  useSettings: () => ({
    isLoading: () => false,
    settings: {
      language: 'de',
      dictionaryTargetLanguages: { de: 'en' },
    },
  }),
  useLanguage: () => ({
    currentLangData: () => ({ name: 'German' }),
    getLanguageDataStatus: () => ({
      language: 'de',
      name: 'German',
      installed: false,
      outdated: true,
      missingRequiredAssets: [],
    }),
    installLanguageData: installLanguageDataMock,
    isLanguageDataInstalling: () => installing(),
    isLoading: () => false,
    languageDataInstallError: () => installError(),
  }),
  useLocalization: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    installer: { startInstall: vi.fn() },
    server: {
      onAnkiConnectionError: () => vi.fn(),
      onServerCriticalError: () => vi.fn(),
    },
    window: {
      closeWindow: vi.fn(),
      openWindow: openWindowMock,
    },
  }),
}));

describe('LoadingOverlay language data update flow', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    installLanguageDataMock.mockReset();
    openWindowMock.mockReset();
    setInstalling(false);
    setInstallError(null);
  });

  afterEach(() => {
    container.remove();
    document.body.replaceChildren();
  });

  it('updates the active language in place without opening the welcome window', async () => {
    const { LoadingOverlay } = await import('./LoadingOverlay');
    const dispose = render(() => <LoadingOverlay />, container);

    expect(document.body.textContent).toContain('Language Data Update Available');
    expect(document.body.textContent).not.toContain('Copy error');

    const updateButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Update Now'));
    updateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(installLanguageDataMock).toHaveBeenCalledWith('de', 'en');
    expect(openWindowMock).not.toHaveBeenCalled();
    dispose();
  });

  it('keeps the update dialog in a disabled loading state while installation runs', async () => {
    setInstalling(true);
    const { LoadingOverlay } = await import('./LoadingOverlay');
    const dispose = render(() => <LoadingOverlay />, container);

    const updateButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Updating'));
    expect(updateButton?.disabled).toBe(true);
    expect(document.body.textContent).toContain('Downloading and installing the latest language data.');
    dispose();
  });

  it('shows the installation error in the same update dialog', async () => {
    setInstallError({
      language: 'de',
      dictionaryTargetLanguage: 'en',
      error: 'Checksum mismatch',
    });
    const { LoadingOverlay } = await import('./LoadingOverlay');
    const dispose = render(() => <LoadingOverlay />, container);

    expect(document.body.textContent).toContain('The language data update failed. Try again.');
    expect(document.body.textContent).toContain('Checksum mismatch');
    expect(document.body.textContent).toContain('Update Now');
    dispose();
  });
});
