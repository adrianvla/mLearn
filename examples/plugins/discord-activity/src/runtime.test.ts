import { describe, expect, it, vi } from 'vitest';

import {
  createDiscordActivityRuntime,
  DISCORD_ACTIVITY_CLIENT_ID,
  loadDiscordActivityConfig,
} from './runtime';

type MockStorage = ReturnType<typeof createStorage>;
type MockRpcClient = ReturnType<typeof createRpcClient>;

function createStorage(initial: Record<string, string | null> = {}) {
  const values = new Map<string, string>();

  for (const [key, value] of Object.entries(initial)) {
    if (typeof value === 'string') {
      values.set(key, value);
    }
  }

  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function createRpcClient() {
  return {
    login: vi.fn(async (_options: { clientId: string }) => {}),
    setActivity: vi.fn(async (_activity: Record<string, unknown>) => {}),
    clearActivity: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
}

async function readPersistedStatus(storage: MockStorage) {
  const rawStatus = storage.values.get('discord-activity:runtime-status');
  expect(rawStatus).toBeTruthy();
  return JSON.parse(rawStatus as string) as {
    connected: boolean;
    lastError: string;
  };
}

describe('discord activity runtime', () => {
  it('loads and normalizes persisted config', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'false',
      'discord-activity:details': '  Reviewing flashcards  ',
      'discord-activity:state': '   ',
      'discord-activity:showTimestamp': 'not-a-boolean',
    });

    const config = await loadDiscordActivityConfig(storage);

    expect(config).toEqual({
      enabled: false,
      details: 'Reviewing flashcards',
      state: 'In a focused session',
      showTimestamp: true,
    });
  });

  it('applies Discord Rich Presence when persisted config is enabled', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:details': 'Reviewing flashcards',
      'discord-activity:state': 'Japanese immersion',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const runtime = createDiscordActivityRuntime({
      storage,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(rpcClient.login).toHaveBeenCalledWith({
      clientId: DISCORD_ACTIVITY_CLIENT_ID,
    });
    expect(rpcClient.setActivity).toHaveBeenCalledWith({
      details: 'Reviewing flashcards',
      state: 'Japanese immersion',
      timestamps: {
        start: new Date('2026-03-29T12:00:00.000Z').getTime(),
      },
    });
  });

  it('does not apply presence when persisted config is disabled', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'false',
      'discord-activity:details': 'Reviewing flashcards',
      'discord-activity:state': 'Japanese immersion',
      'discord-activity:showTimestamp': 'true',
    });
    const createRpcClient = vi.fn<() => MockRpcClient>(() => createRpcClient());
    const runtime = createDiscordActivityRuntime({
      storage,
      createRpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(createRpcClient).not.toHaveBeenCalled();
  });

  it('clears presence and disconnects on deactivate', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:details': 'Reviewing flashcards',
      'discord-activity:state': 'Japanese immersion',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const runtime = createDiscordActivityRuntime({
      storage,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();
    await runtime.deactivate();

    expect(rpcClient.clearActivity).toHaveBeenCalledTimes(1);
    expect(rpcClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it('persists disconnected runtime status when Discord connection fails', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:details': 'Reviewing flashcards',
      'discord-activity:state': 'Japanese immersion',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    rpcClient.login.mockRejectedValueOnce(new Error('Discord is not running'));
    const runtime = createDiscordActivityRuntime({
      storage,
      createRpcClient: () => rpcClient,
    });

    await runtime.activate();

    const status = await readPersistedStatus(storage);
    expect(status).toMatchObject({
      connected: false,
    });
    expect(status.lastError).toContain('Discord is not running');
  });

  it('disconnects the new RPC client when setActivity fails after login', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:details': 'Reviewing flashcards',
      'discord-activity:state': 'Japanese immersion',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    rpcClient.setActivity.mockRejectedValueOnce(new Error('Failed to publish presence'));
    const runtime = createDiscordActivityRuntime({
      storage,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(rpcClient.login).toHaveBeenCalledTimes(1);
    expect(rpcClient.disconnect).toHaveBeenCalledTimes(1);

    const status = await readPersistedStatus(storage);
    expect(status).toMatchObject({
      connected: false,
    });
    expect(status.lastError).toContain('Failed to publish presence');
  });

  it('exports one checked-in Discord client ID constant', () => {
    expect(DISCORD_ACTIVITY_CLIENT_ID).toMatch(/^\d{10,}$/);
  });
});
