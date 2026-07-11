// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const testSettings = {
  language: 'de',
  cloudAuthStatus: 'signed-out',
  cloudAuthActiveGroupId: '',
};
let settingsLoading = false;

const languageProviderMock = vi.fn((props: { language?: string; children?: JSX.Element }) => <>{props.children}</>);
const activeGroupGateMock = vi.fn((_props?: { showSwitchTrigger?: boolean }) => <div data-testid="active-group-gate" />);
const pluginAdapterMock = vi.fn(() => vi.fn());
const policyScopeMock = vi.fn();

vi.mock('./SettingsContext', () => ({
  SettingsProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useSettings: () => ({
    settings: testSettings,
    isLoading: () => settingsLoading,
    isCloudReLoginModalOpen: () => false,
    closeCloudReLoginModal: vi.fn(),
    isRuntimeRestartRequired: () => false,
    restartAppForRuntimeSettings: vi.fn(),
    managedPolicy: () => null,
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

vi.mock('../components/cloud/ActiveGroupSelector', () => ({
  ActiveGroupGate: (props: { showSwitchTrigger?: boolean }) => activeGroupGateMock(props),
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

vi.mock('../services/activityHubRuntime', () => ({
  activityHub: {},
  setActivityPolicyScope: policyScopeMock,
}));

vi.mock('../services/electronPluginActivityAdapter', () => ({
  createElectronPluginActivityAdapter: pluginAdapterMock,
}));

describe('WindowWrapper', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    settingsLoading = false;
    languageProviderMock.mockClear();
    activeGroupGateMock.mockClear();
    pluginAdapterMock.mockClear();
    policyScopeMock.mockClear();
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

  it('does not mount language-dependent providers before settings have loaded', async () => {
    settingsLoading = true;
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(languageProviderMock).not.toHaveBeenCalled();

    dispose();
  });

  it('mounts the active group gate once for every window entry', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(activeGroupGateMock).toHaveBeenCalledTimes(1);
    expect(activeGroupGateMock).toHaveBeenCalledWith({ showSwitchTrigger: undefined });

    dispose();
  });

  it('mounts exactly one plugin activity adapter per window wrapper', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(pluginAdapterMock).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('exposes the optional switch trigger only when a primary surface requests it', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper showActiveGroupSwitch>content</WindowWrapper>, container);

    expect(activeGroupGateMock).toHaveBeenCalledWith({ showSwitchTrigger: true });
    dispose();
  });
});
