import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginManifest } from '../../shared/plugins/types';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-plugin-manager-'));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => tempRoot),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempRoot),
}));

describe('pluginManager activation', () => {
  beforeEach(() => {
    fs.rmSync(path.join(tempRoot, 'plugins'), { recursive: true, force: true });
    fs.rmSync(path.join(tempRoot, 'plugin-state.json'), { force: true });
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(path.join(tempRoot, 'plugins'), { recursive: true, force: true });
    fs.rmSync(path.join(tempRoot, 'plugin-state.json'), { force: true });
  });

  it('activates plugins that request no permissions during initialization', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'no-permissions.plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'no-permissions.plugin',
      name: 'No Permissions Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: [],
    }));

    const { initPluginManager, listPlugins } = await import('./pluginManager');

    await initPluginManager();

    expect(listPlugins()).toEqual([
      expect.objectContaining({
        id: 'no-permissions.plugin',
        permissions: [],
        status: 'active',
      }),
    ]);
  });

  it('re-activates disabled plugins that request no permissions when enabled again', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'reenable.plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'reenable.plugin',
      name: 'Reenable Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: [],
    }));

    const { disablePlugin, enablePlugin, initPluginManager } = await import('./pluginManager');

    await initPluginManager();
    await disablePlugin('reenable.plugin');

    await expect(enablePlugin('reenable.plugin')).resolves.toEqual(expect.objectContaining({
      id: 'reenable.plugin',
      status: 'active',
      permissions: [],
    }));
  });

  it('awaits async activate hooks before marking plugins active', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'async-activate.plugin');
    const distDir = path.join(pluginDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'async-activate.plugin',
      name: 'Async Activate Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: [],
      main: 'dist/main.js',
    }));
    fs.writeFileSync(
      path.join(distDir, 'main.js'),
      "module.exports = { activate() { return new Promise((resolve) => setTimeout(resolve, 0)); } };\n",
    );

    const { enablePlugin, initPluginManager, disablePlugin } = await import('./pluginManager');

    await initPluginManager();
    await disablePlugin('async-activate.plugin');

    const enableResult = enablePlugin('async-activate.plugin');

    expect(enableResult).toBeInstanceOf(Promise);
    await expect(enableResult).resolves.toEqual(expect.objectContaining({
      id: 'async-activate.plugin',
      status: 'active',
      permissions: [],
    }));
  });

  it('awaits activation after granting permissions before returning plugin state', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'grant-permissions.plugin');
    const distDir = path.join(pluginDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'grant-permissions.plugin',
      name: 'Grant Permissions Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: ['kv-store'],
      main: 'dist/main.js',
    }));
    fs.writeFileSync(
      path.join(distDir, 'main.js'),
      "module.exports = { activate() { return new Promise((resolve) => setTimeout(resolve, 0)); } };\n",
    );

    const { grantPermissions, initPluginManager, listPlugins } = await import('./pluginManager');

    await initPluginManager();

    expect(listPlugins()).toEqual([
      expect.objectContaining({
        id: 'grant-permissions.plugin',
        status: 'pending',
        permissionsGranted: false,
      }),
    ]);

    const grantResult = grantPermissions('grant-permissions.plugin');

    expect(grantResult).toBeInstanceOf(Promise);
    await expect(grantResult).resolves.toEqual(expect.objectContaining({
      id: 'grant-permissions.plugin',
      status: 'active',
      permissionsGranted: true,
    }));
  });

  it('awaits activation before returning state for newly installed plugins', async () => {
    const pluginDir = path.join(tempRoot, 'installed.plugin');
    const distDir = path.join(pluginDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(distDir, 'main.js'),
      "module.exports = { activate() { return new Promise((resolve) => setTimeout(resolve, 0)); } };\n",
    );

    const manifest: PluginManifest = {
      id: 'installed.plugin',
      name: 'Installed Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: [],
      main: 'dist/main.js',
    };

    const { registerInstalledPlugin } = await import('./pluginManager');

    const result = registerInstalledPlugin(manifest, pluginDir);

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual(expect.objectContaining({
      id: 'installed.plugin',
      status: 'active',
    }));
  });

  it('preserves component ui metadata when rediscovering installed plugins', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'rediscovered-ui.plugin');
    const distDir = path.join(pluginDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'rediscovered-ui.plugin',
      name: 'Rediscovered UI Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['ui-panel'],
      permissions: ['open-window'],
      ui: {
        type: 'component',
        componentPath: 'dist/ui.js',
      },
    }));
    fs.writeFileSync(path.join(distDir, 'ui.js'), 'export default {}\n');

    const { initPluginManager, listPlugins } = await import('./pluginManager');

    await initPluginManager();

    expect(listPlugins()).toEqual([
      expect.objectContaining({
        id: 'rediscovered-ui.plugin',
        ui: {
          type: 'component',
          componentPath: 'dist/ui.js',
        },
      }),
    ]);
  });
});
