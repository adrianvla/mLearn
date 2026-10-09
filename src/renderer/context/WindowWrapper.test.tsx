// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { getBridge } from '../../shared/bridges';

const testSettings = {
  language: 'de',
  frequencyProviderSelections: { de: 'corpus' },
  frequencyLevelSystemSelections: { de: 'cefr' },
  cloudAuthStatus: 'signed-out',
  cloudAuthActiveGroupId: '',
  llmProvider: 'cloud',
  builtinModel: 'selected.gguf',
};
let settingsLoading = false;
let desktopEnvironment = false;
let libraryError: string | null = null;
const retryLibraryLoad = vi.fn();

const languageProviderMock = vi.fn((props: {
  language?: string;
  frequencyProviderSelections?: Record<string, string>;
  frequencyLevelSystemSelections?: Record<string, string>;
  children?: JSX.Element;
}) => <>{props.children}</>);
const activeGroupGateMock = vi.fn((_props?: { showSwitchTrigger?: boolean }) => <div data-testid="active-group-gate" />);
const pluginAdapterMock = vi.fn(() => vi.fn());
const policyScopeMock = vi.fn();

vi.mock('../components/common/KnowledgeProjection/KnowledgeInspectorHost', () => ({
  KnowledgeInspectorHost: () => <div data-testid="knowledge-inspector-host" />,
}));

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
  useLanguage: () => ({ langData: {} }),
}));

vi.mock('./FlashcardContext', () => ({
  FlashcardProvider: (props: { children?: JSX.Element }) => <>{props.children}</>,
  useFlashcards: () => ({ libraryLoadError: () => libraryError, retryLibraryLoad }),
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
  isElectron: () => desktopEnvironment,
  getOS: () => 'mac',
  getPlatform: () => 'web',
}));

vi.mock('../services/activityHubRuntime', () => ({
  activityHub: {},
  setActivityPolicyScope: policyScopeMock,
}));

vi.mock('../services/electronPluginActivityAdapter', () => ({
  createElectronPluginActivityAdapter: pluginAdapterMock,
}));

vi.mock('../services/managementAnalyticsAdapter', () => ({
  createManagementAnalyticsAdapter: () => ({ start: vi.fn(), updateScope: vi.fn(), flush: vi.fn(), stop: vi.fn() }),
}));

describe('WindowWrapper', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    settingsLoading = false;
    desktopEnvironment = false;
    libraryError = null;
    retryLibraryLoad.mockClear();
    testSettings.llmProvider = 'cloud';
    languageProviderMock.mockClear();
    activeGroupGateMock.mockClear();
    pluginAdapterMock.mockClear();
    policyScopeMock.mockClear();
  });

  afterEach(() => {
    container.remove();
  });

  it('reserves a separate native-controls strip before the bounded standalone content', async () => {
    desktopEnvironment = true;
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper {...{ reserveNativeControls: true }}><main data-testid="standalone-content">Graph</main></WindowWrapper>, container);
    try {
      const layout = container.querySelector('.window-layout-with-native-controls');
      const strip = layout?.querySelector('.window-native-controls-strip');
      const content = layout?.querySelector('.window-content-below-native-controls');
      expect(layout).not.toBeNull();
      expect(strip).toBeDefined();
      expect(strip).not.toBeNull();
      expect(content?.querySelector('[data-testid="standalone-content"]')).not.toBeNull();
      expect(strip?.nextElementSibling).toBe(content);
      expect(container.querySelector('.window-chrome-inset-provider')?.getAttribute('style')).toContain('--window-controls-block-start-inset: 28px');
    } finally { dispose(); }
  });

  it('leaves content that already owns its chrome outside the optional reserved layout', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper><main>Shell</main></WindowWrapper>, container);
    try { expect(container.querySelector('.window-layout-with-native-controls')).toBeNull(); }
    finally { dispose(); }
  });

  it('shows a protected-library recovery dialog with one working retry action', async () => {
    libraryError = 'unreadable';
    const { LibraryLoadGuard } = await import('./WindowWrapper');
    const dispose = render(() => <LibraryLoadGuard />, container);
    try {
      const alert = document.querySelector('[role="alert"]');
      expect(alert?.textContent).toBe('mlearn.LibraryRecovery.Description');
      const retry = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'mlearn.Global.TryAgain');
      expect(retry).toBeDefined();
      retry!.click();
      expect(retryLibraryLoad).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.querySelector('.modal-close')).toBeNull();
    } finally { dispose(); }
  });

  it('keeps Settings recovery tools reachable with a library failure notice', async () => {
    libraryError = 'unreadable';
    const { LibraryLoadGuard } = await import('./WindowWrapper');
    const dispose = render(() => <><LibraryLoadGuard recoveryAccess /><button>Existing recovery tools</button></>, container);
    try {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('mlearn.LibraryRecovery.Description');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(container.textContent).toContain('Existing recovery tools');
    } finally { dispose(); }
  });

  it('passes the selected learning language from settings into LanguageProvider', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(languageProviderMock).toHaveBeenCalled();
    expect(languageProviderMock.mock.calls[0]?.[0]?.language).toBe('de');
    expect(languageProviderMock.mock.calls[0]?.[0]?.frequencyProviderSelections).toEqual({ de: 'corpus' });
    expect(languageProviderMock.mock.calls[0]?.[0]?.frequencyLevelSystemSelections).toEqual({ de: 'cefr' });

    dispose();
  });

  it('does not mount language-dependent providers before settings have loaded', async () => {
    settingsLoading = true;
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(languageProviderMock).not.toHaveBeenCalled();

    dispose();
  });

  it('does not load the default built-in model before saved settings arrive', async () => {
    settingsLoading = true;
    testSettings.llmProvider = 'builtin';
    const checkModel = vi.spyOn(getBridge().llm, 'llmCheckModel').mockResolvedValue({ ready: true } as never);
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(checkModel).not.toHaveBeenCalled();

    dispose();
    checkModel.mockRestore();
  });

  it('mounts the active group gate once for every window entry', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    expect(activeGroupGateMock).toHaveBeenCalledTimes(1);
    expect(activeGroupGateMock).toHaveBeenCalledWith({ showSwitchTrigger: undefined });

    dispose();
  });

  it('mounts one shared knowledge inspector host after settings load', async () => {
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);
    expect(container.querySelectorAll('[data-testid="knowledge-inspector-host"]')).toHaveLength(1);
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

  it('renders the boot indicator with the shared Spinner instead of a private copy', async () => {
    // The boot screen is on-screen before any palette is applied. It used to
    // ship its own square-dash <svg> and a duplicate `square-dash` keyframe,
    // so its color came from --text-primary — near-black on the hardcoded
    // black overlay, i.e. an invisible loading indicator.
    const { WindowWrapper } = await import('./WindowWrapper');
    const dispose = render(() => <WindowWrapper>content</WindowWrapper>, container);

    const overlay = container.querySelector('.window-loading-overlay');
    expect(overlay).not.toBeNull();
    // The canonical Loader owns the indicator geometry and animation.
    expect(overlay!.querySelector('.loader-spinner-square-bar')).not.toBeNull();
    expect(overlay!.querySelector('.window-loading-spinner-dash')).toBeNull();
    dispose();
  });
});
