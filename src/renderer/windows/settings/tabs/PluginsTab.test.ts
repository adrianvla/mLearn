// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { PluginInstallResult, PluginState } from '../../../../shared/plugins/types';

const translations: Record<string, string> = {
  'mlearn.Settings.Plugins.Title': 'Plugins',
  'mlearn.Settings.Plugins.Description': 'Manage installed plugins and their permissions.',
  'mlearn.Settings.Plugins.Loading': 'Loading plugins...',
  'mlearn.Settings.Plugins.Empty.Title': 'No plugins installed',
  'mlearn.Settings.Plugins.Empty.Description': 'Install a plugin package to extend mLearn.',
  'mlearn.Settings.Plugins.Install': 'Install plugin',
  'mlearn.Settings.Plugins.Enable': 'Enable',
  'mlearn.Settings.Plugins.Disable': 'Disable',
  'mlearn.Settings.Plugins.Uninstall': 'Uninstall',
  'mlearn.Settings.Plugins.GrantPermissions': 'Grant permissions',
  'mlearn.Settings.Plugins.Permissions': 'Permissions',
  'mlearn.Settings.Plugins.Capabilities': 'Capabilities',
  'mlearn.Settings.Plugins.Status.active': 'Active',
  'mlearn.Settings.Plugins.Status.disabled': 'Disabled',
  'mlearn.Settings.Plugins.Status.pending': 'Pending',
  'mlearn.Settings.Plugins.Status.error': 'Error',
};

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

const mockPluginGetList = vi.fn<() => Promise<PluginState[]>>();
const mockPluginEnable = vi.fn<(pluginId: string) => Promise<PluginState | null>>();
const mockPluginDisable = vi.fn<(pluginId: string) => Promise<PluginState | null>>();
const mockPluginGrantPermissions = vi.fn<(pluginId: string) => Promise<PluginState | null>>();
const mockPluginSelectAndInstall = vi.fn<() => Promise<PluginInstallResult>>();
const mockPluginUninstall = vi.fn<(pluginId: string) => Promise<boolean>>();

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    plugins: {
      pluginGetList: mockPluginGetList,
      pluginEnable: mockPluginEnable,
      pluginDisable: mockPluginDisable,
      pluginGrantPermissions: mockPluginGrantPermissions,
      pluginSelectAndInstall: mockPluginSelectAndInstall,
      pluginUninstall: mockPluginUninstall,
      onPluginList: vi.fn(() => () => undefined),
      onPluginStatusUpdate: vi.fn(() => () => undefined),
      onPluginInstallResult: vi.fn(() => () => undefined),
    },
  }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PluginsTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockPluginGetList.mockReset();
    mockPluginEnable.mockReset();
    mockPluginDisable.mockReset();
    mockPluginGrantPermissions.mockReset();
    mockPluginSelectAndInstall.mockReset();
    mockPluginUninstall.mockReset();
  });

  afterEach(() => {
    container.remove();
  });

  async function renderPluginsTab() {
    const { PluginsTab } = await import('./PluginsTab');
    const dispose = render(() => PluginsTab({}), container);
    return { dispose };
  }

  it('shows loading, then empty state, and starts install flow', async () => {
    const pendingPlugins = deferred<PluginState[]>();
    mockPluginGetList.mockReturnValue(pendingPlugins.promise);
    mockPluginSelectAndInstall.mockResolvedValue({ success: true, pluginId: 'demo.plugin' });

    const { dispose } = await renderPluginsTab();

    expect(container.textContent).toContain('Loading plugins...');

    pendingPlugins.resolve([]);
    await flushPromises();

    expect(container.textContent).toContain('No plugins installed');

    const installButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Install plugin'),
    );

    expect(installButton).toBeTruthy();
    installButton!.click();
    await flushPromises();

    expect(mockPluginSelectAndInstall).toHaveBeenCalledOnce();
    dispose();
  });

  it('renders plugin cards and supports permission, enable, disable, and uninstall actions', async () => {
    const lockedPlugin: PluginState = {
      id: 'locked.plugin',
      name: 'Locked Plugin',
      version: '1.2.3',
      description: 'Needs permission approval.',
      author: 'Plugin Dev',
      capabilities: ['integration'],
      permissions: ['kv-store'],
      status: 'disabled',
      pluginPath: '/plugins/locked.plugin',
      permissionsGranted: false,
    };

    const activePlugin: PluginState = {
      id: 'active.plugin',
      name: 'Active Plugin',
      version: '2.0.0',
      description: 'Already running.',
      author: 'Plugin Dev',
      capabilities: ['ui-panel'],
      permissions: [],
      status: 'active',
      pluginPath: '/plugins/active.plugin',
      permissionsGranted: true,
    };

    mockPluginGetList.mockResolvedValue([lockedPlugin, activePlugin]);
    mockPluginGrantPermissions.mockResolvedValue({
      ...lockedPlugin,
      permissionsGranted: true,
    });
    mockPluginEnable.mockResolvedValue({
      ...lockedPlugin,
      permissionsGranted: true,
      status: 'active',
    });
    mockPluginDisable.mockResolvedValue({
      ...activePlugin,
      status: 'disabled',
    });
    mockPluginUninstall.mockResolvedValue(true);

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    expect(container.textContent).toContain('Locked Plugin');
    expect(container.textContent).toContain('Active Plugin');

    let lockedCard = container.querySelector('[data-plugin-id="locked.plugin"]') as HTMLDivElement;
    let activeCard = container.querySelector('[data-plugin-id="active.plugin"]') as HTMLDivElement;

    expect(lockedCard).toBeTruthy();
    expect(activeCard).toBeTruthy();

    const grantButton = Array.from(lockedCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Grant permissions'),
    );
    expect(grantButton).toBeTruthy();
    grantButton!.click();
    await flushPromises();

    expect(mockPluginGrantPermissions).toHaveBeenCalledWith('locked.plugin');
    lockedCard = container.querySelector('[data-plugin-id="locked.plugin"]') as HTMLDivElement;
    expect(lockedCard.textContent).not.toContain('Grant permissions');

    const enableButton = Array.from(lockedCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Enable'),
    );
    expect(enableButton).toBeTruthy();
    enableButton!.click();
    await flushPromises();

    expect(mockPluginEnable).toHaveBeenCalledWith('locked.plugin');
    lockedCard = container.querySelector('[data-plugin-id="locked.plugin"]') as HTMLDivElement;
    expect(lockedCard.textContent).toContain('Disable');

    const disableButton = Array.from(activeCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Disable'),
    );
    expect(disableButton).toBeTruthy();
    disableButton!.click();
    await flushPromises();

    expect(mockPluginDisable).toHaveBeenCalledWith('active.plugin');
    activeCard = container.querySelector('[data-plugin-id="active.plugin"]') as HTMLDivElement;
    expect(activeCard.textContent).toContain('Enable');

    const uninstallButton = Array.from(activeCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Uninstall'),
    );
    expect(uninstallButton).toBeTruthy();
    uninstallButton!.click();
    await flushPromises();

    expect(mockPluginUninstall).toHaveBeenCalledWith('active.plugin');
    expect(container.querySelector('[data-plugin-id="active.plugin"]')).toBeNull();
    dispose();
  });

  it('announces inline errors with alert semantics', async () => {
    mockPluginGetList.mockRejectedValue(new Error('Failed to load plugins'));

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain('Failed to load plugins');

    dispose();
  });
});
