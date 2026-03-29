import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-plugin-manager-deactivate-'));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => tempRoot),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempRoot),
}));

declare global {
  var __pluginOnDeactivate: (() => void) | undefined;
}

describe('pluginManager deactivate hook', () => {
  beforeEach(() => {
    fs.rmSync(path.join(tempRoot, 'plugins'), { recursive: true, force: true });
    fs.rmSync(path.join(tempRoot, 'plugin-state.json'), { force: true });
    vi.resetModules();
    globalThis.__pluginOnDeactivate = undefined;
  });

  afterEach(() => {
    fs.rmSync(path.join(tempRoot, 'plugins'), { recursive: true, force: true });
    fs.rmSync(path.join(tempRoot, 'plugin-state.json'), { force: true });
    globalThis.__pluginOnDeactivate = undefined;
  });

  it('calls deactivate before the plugin becomes disabled', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'deactivate-order.plugin');
    const distDir = path.join(pluginDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'deactivate-order.plugin',
      name: 'Deactivate Order Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: [],
      main: 'dist/main.js',
    }));
    fs.writeFileSync(path.join(distDir, 'main.js'), "module.exports = { deactivate() { globalThis.__pluginOnDeactivate?.(); } };\n");

    const { disablePlugin, initPluginManager, listPlugins } = await import('./pluginManager');
    const statusesDuringDeactivate: string[] = [];
    globalThis.__pluginOnDeactivate = () => {
      statusesDuringDeactivate.push(listPlugins()[0]?.status ?? 'missing');
    };

    await initPluginManager();

    await expect(disablePlugin('deactivate-order.plugin')).resolves.toEqual(expect.objectContaining({
      id: 'deactivate-order.plugin',
      status: 'disabled',
    }));
    expect(statusesDuringDeactivate).toEqual(['active']);
  });

  it('disables loaded plugins whose module does not export deactivate', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'no-deactivate.plugin');
    const distDir = path.join(pluginDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'no-deactivate.plugin',
      name: 'No Deactivate Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: [],
      main: 'dist/main.js',
    }));
    fs.writeFileSync(path.join(distDir, 'main.js'), "module.exports = { activate() {} };\n");

    const { disablePlugin, initPluginManager, listPlugins } = await import('./pluginManager');

    await initPluginManager();

    expect(listPlugins()).toEqual([
      expect.objectContaining({
        id: 'no-deactivate.plugin',
        status: 'active',
      }),
    ]);
    await expect(disablePlugin('no-deactivate.plugin')).resolves.toEqual(expect.objectContaining({
      id: 'no-deactivate.plugin',
      status: 'disabled',
    }));
  });

  it('awaits async deactivate hooks before returning disabled state', async () => {
    const pluginDir = path.join(tempRoot, 'plugins', 'async-deactivate.plugin');
    const distDir = path.join(pluginDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({
      id: 'async-deactivate.plugin',
      name: 'Async Deactivate Plugin',
      version: '1.0.0',
      apiVersion: '1.0.0',
      capabilities: ['integration'],
      permissions: [],
      main: 'dist/main.js',
    }));
    fs.writeFileSync(
      path.join(distDir, 'main.js'),
      "module.exports = { activate() {}, deactivate() { return new Promise((resolve) => setTimeout(() => { globalThis.__pluginOnDeactivate?.(); resolve(); }, 0)); } };\n",
    );

    const { disablePlugin, initPluginManager, listPlugins } = await import('./pluginManager');
    const statusesDuringDeactivate: string[] = [];
    globalThis.__pluginOnDeactivate = () => {
      statusesDuringDeactivate.push(listPlugins()[0]?.status ?? 'missing');
    };

    await initPluginManager();

    const disableResult = disablePlugin('async-deactivate.plugin');

    expect(disableResult).toBeInstanceOf(Promise);
    await expect(disableResult).resolves.toEqual(expect.objectContaining({
      id: 'async-deactivate.plugin',
      status: 'disabled',
    }));
    expect(statusesDuringDeactivate).toEqual(['active']);
  });
});
