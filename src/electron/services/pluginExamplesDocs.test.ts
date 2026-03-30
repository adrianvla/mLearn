import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test'),
  },
}));

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => '/tmp/test'),
}));

import { validateManifest } from './pluginManager';
import { DISCORD_ACTIVITY_CLIENT_ID } from '../../../examples/plugins/discord-activity/src/runtime';

const repoRoot = path.resolve(__dirname, '../../..');
const requireFromTest = createRequire(import.meta.url);

function readRequiredFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

describe('plugin examples and public docs', () => {
  it('ships valid example plugin manifests', () => {
    const discordManifest = JSON.parse(readRequiredFile('examples/plugins/discord-activity/plugin.json'));
    const languageManifest = JSON.parse(readRequiredFile('examples/plugins/language-template/plugin.json'));

    expect(fs.existsSync(path.join(repoRoot, 'examples/plugins/discord-activity/dist/main.cjs'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'examples/plugins/discord-activity/dist/ui.js'))).toBe(true);

    const discordRuntimeEntry = requireFromTest(path.join(repoRoot, 'examples/plugins/discord-activity/dist/main.cjs')) as {
      activate?: unknown;
      deactivate?: unknown;
    };

    expect(typeof discordRuntimeEntry.activate).toBe('function');
    expect(typeof discordRuntimeEntry.deactivate).toBe('function');

    expect(validateManifest(discordManifest, '/examples/plugins/discord-activity')).toMatchObject({
      id: 'discord-activity',
      capabilities: ['integration', 'ui-panel'],
      permissions: ['kv-store', 'open-window'],
      main: 'dist/main.cjs',
      ui: {
        type: 'component',
        componentPath: 'dist/ui.js',
      },
    });

    expect(discordManifest.main).toBe('dist/main.cjs');
    expect(discordManifest.ui).toMatchObject({
      type: 'component',
      componentPath: 'dist/ui.js',
    });

    expect(validateManifest(languageManifest, '/examples/plugins/language-template')).toMatchObject({
      id: 'language-template',
      capabilities: ['language'],
      permissions: [],
      languageId: 'python-template',
      pythonModuleDir: 'python',
      pythonModuleName: 'template_lang',
    });
  });

  it('keeps the checked-in Discord client ID aligned across source, manifest, and docs', () => {
    const runtimeSource = readRequiredFile('examples/plugins/discord-activity/src/runtime.ts');
    const pluginManifest = readRequiredFile('examples/plugins/discord-activity/plugin.json');
    const readme = readRequiredFile('docs/plugins/README.md');

    expect(runtimeSource).toContain(`DISCORD_ACTIVITY_CLIENT_ID = '${DISCORD_ACTIVITY_CLIENT_ID}'`);
    expect(pluginManifest).toContain(`Client ID: ${DISCORD_ACTIVITY_CLIENT_ID}`);
    expect(readme).toContain(`Client ID: ${DISCORD_ACTIVITY_CLIENT_ID}`);
    expect(DISCORD_ACTIVITY_CLIENT_ID).toBe('1487871166633869342');
  });

  it('documents the current plugin trust and host conventions', () => {
    const readme = readRequiredFile('docs/plugins/README.md');
    const manifestDoc = readRequiredFile('docs/plugins/manifest.md');

    expect(readme).toContain('Grant permissions');
    expect(readme).toContain('plugin-host');
    expect(readme).toContain('plugin-ui://');
    expect(readme).toContain('pluginOpenWindow');
    expect(readme).toContain('does not yet wire manifest-declared language plugins');
    expect(readme).toContain('src/root-of-app/config.py');
    expect(readme).toContain('bundle `src/main.ts` into separate runtime targets');
    expect(readme).toContain('`dist/main.cjs`');
    expect(readme).toContain('`dist/ui.js`');

    expect(manifestDoc).toContain('apiVersion');
    expect(manifestDoc).toContain('permissions');
    expect(manifestDoc).toContain('pythonModuleDir');
    expect(manifestDoc).toContain('pythonModuleName');
    expect(manifestDoc).toContain('ui');
    expect(manifestDoc).toContain('componentPath');
    expect(manifestDoc).toContain('Node `require()`');
    expect(manifestDoc).toContain('browser `import()`');
    expect(manifestDoc).toContain('single precompiled module entry');
    expect(manifestDoc).toContain('relative chunk or asset resolution may need extra care');
  });

  it('documents the launcher and Discord example runtime behavior', () => {
    const readme = readRequiredFile('docs/plugins/README.md');

    expect(readme).toContain('Active plugins with the `ui-panel` capability');
    expect(readme).toContain('show an `Open plugin window` action in Settings');
    expect(readme).toContain('`open-window` permission');
    expect(readme).toContain('examples/plugins/discord-activity/');
    expect(readme).toContain('installable example plugin');
    expect(readme).toContain('disable and re-enable the plugin');
    expect(readme).toContain('real Discord Rich Presence integration');
    expect(readme).toContain('not just placeholder host-window scaffolding');
  });
});
