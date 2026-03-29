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
  'mlearn.Settings.Plugins.OpenWindow': 'Open plugin window',
  'mlearn.Settings.Plugins.OpenWindowError': 'Unable to open plugin window.',
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
const mockPluginOpenWindow = vi.fn<(payload: { pluginId: string }) => Promise<boolean>>();
const mockPluginSelectAndInstall = vi.fn<() => Promise<PluginInstallResult>>();
const mockPluginUninstall = vi.fn<(pluginId: string) => Promise<boolean>>();

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    plugins: {
      pluginGetList: mockPluginGetList,
      pluginEnable: mockPluginEnable,
      pluginDisable: mockPluginDisable,
      pluginGrantPermissions: mockPluginGrantPermissions,
      pluginOpenWindow: mockPluginOpenWindow,
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
    mockPluginOpenWindow.mockReset();
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

  function createPlugin(overrides: Partial<PluginState> = {}): PluginState {
    return {
      id: 'discord-activity',
      name: 'Discord Activity',
      version: '1.0.0',
      description: 'Discord plugin window.',
      author: 'Plugin Dev',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      status: 'active',
      pluginPath: '/plugins/discord-activity',
      permissionsGranted: true,
      ui: {
        type: 'component',
        componentPath: 'dist/ui.js',
      },
      ...overrides,
    };
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

  it('shows an open plugin window button for active ui-panel plugins with ui contributions', async () => {
    mockPluginGetList.mockResolvedValue([createPlugin()]);

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    const pluginCard = container.querySelector('[data-plugin-id="discord-activity"]') as HTMLDivElement;
    const openWindowButton = Array.from(pluginCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open plugin window'),
    );

    expect(openWindowButton).toBeTruthy();
    dispose();
  });

  it('opens the plugin window for an eligible plugin', async () => {
    mockPluginGetList.mockResolvedValue([createPlugin()]);
    mockPluginOpenWindow.mockResolvedValue(true);

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    const pluginCard = container.querySelector('[data-plugin-id="discord-activity"]') as HTMLDivElement;
    const openWindowButton = Array.from(pluginCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open plugin window'),
    );

    expect(openWindowButton).toBeTruthy();
    openWindowButton!.click();
    await flushPromises();

    expect(mockPluginOpenWindow).toHaveBeenCalledWith({ pluginId: 'discord-activity' });
    dispose();
  });

  it('does not show an open plugin window button for ineligible plugins', async () => {
    mockPluginGetList.mockResolvedValue([
      createPlugin({ id: 'disabled.plugin', status: 'disabled' }),
      createPlugin({ id: 'no-capability.plugin', capabilities: ['integration'] }),
      createPlugin({ id: 'no-permission.plugin', permissions: [] }),
      createPlugin({
        id: 'no-ui.plugin',
        ui: undefined,
      }),
    ]);

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    for (const pluginId of ['disabled.plugin', 'no-capability.plugin', 'no-permission.plugin', 'no-ui.plugin']) {
      const pluginCard = container.querySelector(`[data-plugin-id="${pluginId}"]`) as HTMLDivElement;
      const openWindowButton = Array.from(pluginCard.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Open plugin window'),
      );

      expect(openWindowButton).toBeFalsy();
    }

    dispose();
  });

  it('announces an inline error when opening a plugin window returns false', async () => {
    mockPluginGetList.mockResolvedValue([createPlugin()]);
    mockPluginOpenWindow.mockResolvedValue(false);

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    const pluginCard = container.querySelector('[data-plugin-id="discord-activity"]') as HTMLDivElement;
    const openWindowButton = Array.from(pluginCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open plugin window'),
    );

    openWindowButton!.click();
    await flushPromises();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain('Unable to open plugin window.');
    dispose();
  });

  it('announces an inline error when opening a plugin window throws', async () => {
    mockPluginGetList.mockResolvedValue([createPlugin()]);
    mockPluginOpenWindow.mockRejectedValue(new Error('Plugin window failed to open'));

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    const pluginCard = container.querySelector('[data-plugin-id="discord-activity"]') as HTMLDivElement;
    const openWindowButton = Array.from(pluginCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open plugin window'),
    );

    openWindowButton!.click();
    await flushPromises();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain('Plugin window failed to open');
    dispose();
  });

  it('disables the open plugin window button while the request is in flight', async () => {
    const pendingOpenWindow = deferred<boolean>();
    mockPluginGetList.mockResolvedValue([createPlugin()]);
    mockPluginOpenWindow.mockReturnValue(pendingOpenWindow.promise);

    const { dispose } = await renderPluginsTab();
    await flushPromises();

    const pluginCard = container.querySelector('[data-plugin-id="discord-activity"]') as HTMLDivElement;
    const openWindowButton = Array.from(pluginCard.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open plugin window'),
    ) as HTMLButtonElement | undefined;

    expect(openWindowButton).toBeTruthy();
    const resolvedOpenWindowButton = openWindowButton as HTMLButtonElement;
    expect(resolvedOpenWindowButton.disabled).toBe(false);

    resolvedOpenWindowButton.click();
    await flushPromises();

    expect(resolvedOpenWindowButton.disabled).toBe(true);

    pendingOpenWindow.resolve(true);
    await flushPromises();

    expect(resolvedOpenWindowButton.disabled).toBe(false);
    dispose();
  });
});
