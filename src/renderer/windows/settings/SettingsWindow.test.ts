// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

const onOpenSettingsMock = vi.fn<(callback: (section?: string) => void) => () => void>();
const onWindowContextMock = vi.fn<(callback: (context: Record<string, unknown> | null) => void) => () => void>();
const getWindowContextMock = vi.fn();
let openSettingsHandler: ((section?: string) => void) | undefined;
let windowContextHandler: ((context: Record<string, unknown> | null) => void) | undefined;

let mockSettings = { devMode: false };

vi.mock('./EventAuditPanel', () => ({ EventAuditPanel: () => null }));

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSettings: vi.fn(),
  }),
  useLocalization: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'mlearn.Settings.Tabs.General': 'General',
        'mlearn.Settings.Tabs.EventAudit': 'Event journal',
        'mlearn.Settings.Tabs.Behaviour': 'Behaviour',
        'mlearn.Settings.Tabs.Appearance': 'Appearance',
        'mlearn.Settings.Tabs.SRS': 'SRS',
        'mlearn.Settings.Tabs.Reader': 'Reader',
        'mlearn.Settings.Tabs.VideoPlayer': 'Video Player',
        'mlearn.Settings.Tabs.AI': 'AI',
        'mlearn.Settings.Tabs.Connection': 'Connection',
        'mlearn.Settings.Tabs.Plugins': 'Plugins',
        'mlearn.Settings.Tabs.Components': 'Components',
        'mlearn.Settings.Tabs.BrowserExtension': 'Browser Extension',
        'mlearn.Settings.Tabs.About': 'About',
        'mlearn.Settings.SearchPlaceholder': 'Search settings...',
      };
      return labels[key] ?? key;
    },
  }),
  WindowWrapper: (props: { children: unknown }) => props.children,
  SettingsSearchContext: {
    Provider: (props: { children: unknown }) => props.children,
  },
  SettingsTabContext: {
    Provider: (props: { children: unknown }) => props.children,
  },
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: {
      onOpenSettings: onOpenSettingsMock,
      onWindowContext: onWindowContextMock,
      getWindowContext: getWindowContextMock,
    },
  }),
}));

vi.mock('./tabs', () => ({
  GeneralTab: () => 'general tab',
  BehaviourTab: () => 'behaviour tab',
  CustomizationTab: () => 'customization tab',
  SRSTab: () => 'srs tab',
  ReaderTab: () => 'reader tab',
  VideoPlayerTab: () => 'video player tab',
  AITab: () => 'ai tab',
  ConnectionTab: () => 'connection tab',
  PluginsTab: () => 'plugins tab',
  ComponentsTab: () => 'components tab',
  BrowserExtensionTab: () => 'browser extension tab',
  AboutTab: () => 'about tab',
}));

describe('SettingsContent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    openSettingsHandler = undefined;
    windowContextHandler = undefined;
    onOpenSettingsMock.mockReset();
    onWindowContextMock.mockReset();
    getWindowContextMock.mockReset();
    onOpenSettingsMock.mockImplementation((callback) => {
      openSettingsHandler = callback;
      return () => {
        openSettingsHandler = undefined;
      };
    });
    onWindowContextMock.mockImplementation((callback) => {
      windowContextHandler = callback;
      return () => {
        windowContextHandler = undefined;
      };
    });
  });

  afterEach(() => {
    container.remove();
  });

  it('shows plugins tab before about and opens plugin sections on the plugins tab', async () => {
    const { SettingsContent } = await import('./SettingsWindow');
    const dispose = render(() => SettingsContent({}), container);

    const tabs = Array.from(container.querySelectorAll('[role="tab"] .tab-label')).map((tab) => tab.textContent?.trim());
    expect(tabs.indexOf('Plugins')).toBeGreaterThan(-1);
    expect(tabs.indexOf('Plugins')).toBeLessThan(tabs.indexOf('About'));

    openSettingsHandler?.('plugin-permissions');

    expect(container.textContent).toContain('plugins tab');
    const selectedTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selectedTab?.querySelector('.tab-label')?.textContent).toContain('Plugins');

    dispose();
  });

  it('uses a compact navigation control instead of an inline tab rail at narrow widths', async () => {
    const { SettingsContent } = await import('./SettingsWindow');
    const dispose = render(() => SettingsContent({}), container);

    const toggle = container.querySelector<HTMLButtonElement>('[aria-controls="settings-navigation"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    toggle?.click();

    expect(container.querySelector('#settings-navigation')?.classList.contains('tab-list--responsive-sidebar-open')).toBe(true);

    dispose();
  });

  it('reads the section from the window context on mount', async () => {
    const { SettingsContent } = await import('./SettingsWindow');
    const dispose = render(() => SettingsContent({}), container);

    expect(getWindowContextMock).toHaveBeenCalledWith('settings');

    windowContextHandler?.({ section: 'ai' });

    const selectedTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selectedTab?.querySelector('.tab-label')?.textContent).toContain('AI');

    dispose();
  });

  it('switches tabs when the window context is pushed to an already-open window', async () => {
    const { SettingsContent } = await import('./SettingsWindow');
    const dispose = render(() => SettingsContent({}), container);

    windowContextHandler?.({ section: 'appearance' });

    let selectedTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selectedTab?.querySelector('.tab-label')?.textContent).toContain('Appearance');

    windowContextHandler?.({ section: 'about' });

    selectedTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selectedTab?.querySelector('.tab-label')?.textContent).toContain('About');

    windowContextHandler?.(null);

    selectedTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selectedTab?.querySelector('.tab-label')?.textContent).toContain('About');

    dispose();
  });

  it('shows the event journal tab only in dev mode', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { SettingsContent } = await import('./SettingsWindow');

    mockSettings = { devMode: false };
    let dispose = render(() => SettingsContent({}), container);
    expect(Array.from(container.querySelectorAll('[role="tab"] .tab-label')).some((label) => label.textContent?.includes('Event journal'))).toBe(false);
    dispose();

    mockSettings = { devMode: true };
    dispose = render(() => SettingsContent({}), container);
    expect(Array.from(container.querySelectorAll('[role="tab"] .tab-label')).some((label) => label.textContent?.includes('Event journal'))).toBe(true);
    dispose();

    container.remove();
    mockSettings = { devMode: false };
  });
});
