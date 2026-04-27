// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const testSettings = {
  language: 'de',
};

const languageProviderMock = vi.fn((props: { language?: string; children?: JSX.Element }) => <>{props.children}</>);

vi.mock('./SettingsContext', () => ({
  SettingsProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useSettings: () => ({
    settings: testSettings,
    isLoading: () => false,
    isCloudReLoginModalOpen: () => false,
    closeCloudReLoginModal: vi.fn(),
  }),
}));

vi.mock('./LanguageContext', () => ({
  LanguageProvider: (props: { language?: string; children?: JSX.Element }) => languageProviderMock(props),
}));

vi.mock('./FlashcardContext', () => ({
  FlashcardProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

vi.mock('./ServerContext', () => ({
  ServerProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useServer: () => ({
    statusMessage: () => '',
  }),
}));

vi.mock('./LocalizationContext', () => ({
  LocalizationProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useLocalization: () => ({
    t: (key: string) => key,
    isLoaded: () => true,
  }),
}));

vi.mock('./ResponsiveContext', () => ({
  ResponsiveProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

vi.mock('./LowPowerGateContext', () => ({
  LowPowerGateProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
}));

vi.mock('../components/common/Feedback/Toast', () => ({
  ToastContainer: () => <div />,
  showToast: vi.fn(),
}));

vi.mock('../components/utils/WindowDragRegion', () => ({
  WindowDragRegion: () => <div />,
}));

vi.mock('../components/cloud/CloudReLoginModal', () => ({
  CloudReLoginModal: () => <div />,
}));

vi.mock('../components/flashcard', () => ({
  FlashcardCreationChoiceModal: () => <div />,
}));

vi.mock('../services/statsService', () => ({
  getLocalStorageMigrationInfo: () => ({ occurred: false, migratedWordCount: 0 }),
  resetLocalStorageMigrationInfo: vi.fn(),
}));

vi.mock('./migrationSignals', () => ({
  consumePendingFlashcardMigration: vi.fn(() => undefined),
  setMigrationListenerReady: vi.fn(),
}));

vi.mock('./windowWrapperNotifications', () => ({
  createAnkiCacheToastGate: () => ({
    shouldShow: () => false,
  }),
}));

vi.mock('../../shared/platform', () => ({
  isElectron: () => false,
  getPlatform: () => 'web',
}));

describe('WindowWrapper', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    languageProviderMock.mockClear();
  });

  afterEach(() => {
    container.remove();
  });

  it('passes the selected learning language from settings into LanguageProvider', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(languageProviderMock).toHaveBeenCalled();
    expect(languageProviderMock.mock.calls[0]?.[0]?.language).toBe('de');

    dispose();
  });
});
