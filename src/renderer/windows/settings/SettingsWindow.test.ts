// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

const onOpenSettingsMock = vi.fn<(callback: (section?: string) => void) => () => void>();
let openSettingsHandler: ((section?: string) => void) | undefined;

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'mlearn.Settings.Tabs.General': 'General',
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
      };
      return labels[key] ?? key;
    },
  }),
  WindowWrapper: (props: { children: unknown }) => props.children,
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: {
      onOpenSettings: onOpenSettingsMock,
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
    onOpenSettingsMock.mockReset();
    onOpenSettingsMock.mockImplementation((callback) => {
      openSettingsHandler = callback;
      return () => {
        openSettingsHandler = undefined;
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
});
