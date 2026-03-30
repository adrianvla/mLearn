import fs from 'fs';
import path from 'path';
import type { PluginBusEnvelope } from '../../../../src/shared/pluginBus';

import { createDiscordRpcClient } from './discordRpc';
import { createDiscordActivityRuntime } from './runtime';

export { default } from './ui';

const pluginRoot = path.resolve(__dirname, '..');
const kvPath = path.join(pluginRoot, '.kv.json');

function loadPluginStore(): Record<string, string> {
  try {
    if (!fs.existsSync(kvPath)) {
      return {};
    }

    const parsed: unknown = JSON.parse(fs.readFileSync(kvPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function savePluginStore(store: Record<string, string>): void {
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(kvPath, JSON.stringify(store, null, 2), 'utf-8');
}

type MainProcessPluginBus = {
  getPluginValue: (channel: string) => Promise<PluginBusEnvelope>;
  onPluginValue: (channel: string, callback: (nextValue: PluginBusEnvelope, previousValue: PluginBusEnvelope) => void) => () => void;
};

function getPluginBus(): MainProcessPluginBus {
  const pluginBus = (globalThis as typeof globalThis & {
    __mlearnPluginBus?: MainProcessPluginBus;
  }).__mlearnPluginBus;

  if (!pluginBus) {
    throw new Error('Main-process plugin bus is not available');
  }

  return pluginBus;
}

const runtime = createDiscordActivityRuntime({
  storage: {
    get: async (key: string) => loadPluginStore()[key] ?? null,
    set: async (key: string, value: string) => {
      const store = loadPluginStore();
      store[key] = value;
      savePluginStore(store);
    },
  },
  pluginBridge: {
    getPluginValue: (channel) => getPluginBus().getPluginValue(channel),
    onPluginValue: (channel, callback) => getPluginBus().onPluginValue(channel, callback),
  },
  createRpcClient: () => createDiscordRpcClient(),
});

export async function activate(): Promise<void> {
  await runtime.activate();
}

export async function deactivate(): Promise<void> {
  await runtime.deactivate();
}
