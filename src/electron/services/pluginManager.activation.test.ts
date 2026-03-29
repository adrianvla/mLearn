import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    initPluginManager();

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

    initPluginManager();
    disablePlugin('reenable.plugin');

    expect(enablePlugin('reenable.plugin')).toEqual(expect.objectContaining({
      id: 'reenable.plugin',
      status: 'active',
      permissions: [],
    }));
  });
});
