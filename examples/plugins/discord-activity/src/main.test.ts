import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeActivate = vi.fn(async () => undefined);
const runtimeDeactivate = vi.fn(async () => undefined);
let capturedRuntimeDependencies:
  | {
      pluginBridge: {
        getPluginValue: (channel: string) => Promise<unknown>;
        onPluginValue: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      };
    }
  | undefined;

const createDiscordActivityRuntime = vi.fn((dependencies: {
  pluginBridge: {
    getPluginValue: (channel: string) => Promise<unknown>;
    onPluginValue: (channel: string, callback: (...args: unknown[]) => void) => () => void;
  };
}) => {
  capturedRuntimeDependencies = dependencies;
  return {
    activate: runtimeActivate,
    deactivate: runtimeDeactivate,
  };
});

const getPluginValue = vi.fn(async () => ({ hasValue: false, value: null }));
const onPluginValue = vi.fn(() => () => undefined);

vi.mock('./runtime', () => ({
  createDiscordActivityRuntime,
}));

vi.mock('./discordRpc', () => ({
  createDiscordRpcClient: vi.fn(() => ({})),
}));

describe('discord activity main entry', () => {
  beforeEach(() => {
    vi.resetModules();
    runtimeActivate.mockClear();
    runtimeDeactivate.mockClear();
    createDiscordActivityRuntime.mockClear();
    capturedRuntimeDependencies = undefined;
    getPluginValue.mockClear();
    onPluginValue.mockClear();
    delete (globalThis as typeof globalThis & { __mlearnPluginBus?: unknown }).__mlearnPluginBus;
  });

  it('uses the main-process plugin bus instead of the renderer bridge', async () => {
    ;(globalThis as typeof globalThis & {
      __mlearnPluginBus?: {
        getPluginValue: typeof getPluginValue;
        onPluginValue: typeof onPluginValue;
      };
    }).__mlearnPluginBus = {
      getPluginValue,
      onPluginValue,
    };

    const mod = await import('./main');
    await mod.activate();

    if (!capturedRuntimeDependencies) {
      throw new Error('runtime dependencies were not captured');
    }

    const pluginBridge = capturedRuntimeDependencies.pluginBridge;

    await pluginBridge.getPluginValue('app.user.activity');
    pluginBridge.onPluginValue('app.user.activity', () => undefined);

    expect(getPluginValue).toHaveBeenCalledWith('app.user.activity');
    expect(onPluginValue).toHaveBeenCalledWith('app.user.activity', expect.any(Function));
    expect(runtimeActivate).toHaveBeenCalledTimes(1);
  });
});
