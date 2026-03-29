import fs from 'fs';
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

const repoRoot = path.resolve(__dirname, '../../..');

function readRequiredFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

describe('plugin examples and public docs', () => {
  it('ships valid example plugin manifests', () => {
    const discordManifest = JSON.parse(readRequiredFile('examples/plugins/discord-activity/plugin.json'));
    const languageManifest = JSON.parse(readRequiredFile('examples/plugins/language-template/plugin.json'));

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

    expect(validateManifest(languageManifest, '/examples/plugins/language-template')).toMatchObject({
      id: 'language-template',
      capabilities: ['language'],
      permissions: [],
      languageId: 'python-template',
      pythonModuleDir: 'python',
      pythonModuleName: 'template_lang',
    });
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
});
