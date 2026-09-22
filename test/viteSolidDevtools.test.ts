import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import viteConfig, { isSolidDevtoolsEnabled } from '../vite.config';

async function resolveConfig(command: ConfigEnv['command'], mode: string): Promise<UserConfig> {
  return (viteConfig as (env: ConfigEnv) => Promise<UserConfig>)({
    command,
    mode,
    isSsrBuild: false,
    isPreview: false,
  });
}

function pluginNames(config: UserConfig): string[] {
  return (config.plugins as Plugin[]).map((plugin) => plugin.name);
}

describe('Solid Devtools Vite integration', () => {
  it('is enabled only for the Vite development server', () => {
    expect(isSolidDevtoolsEnabled('serve', 'development')).toBe(true);
    expect(isSolidDevtoolsEnabled('build', 'production')).toBe(false);
    expect(isSolidDevtoolsEnabled('build', 'capacitor')).toBe(false);
  });

  it('injects the runtime only into development-server pages', async () => {
    const developmentPlugins = pluginNames(await resolveConfig('serve', 'development'));
    const productionPlugins = pluginNames(await resolveConfig('build', 'production'));

    expect(developmentPlugins).toEqual(expect.arrayContaining([
      'solid-devtools',
      'mlearn-solid-devtools-runtime',
    ]));
    expect(productionPlugins).not.toContain('solid-devtools');
    expect(productionPlugins).not.toContain('mlearn-solid-devtools-runtime');
  });
});
