import { describe, expect, it, vi } from 'vitest';

import type { AppActivity } from '../../../../src/shared/plugins/appActivity';

import {
  createDiscordActivityRuntime,
  DISCORD_ACTIVITY_CLIENT_ID,
  loadDiscordActivityConfig,
} from './runtime';

type MockStorage = ReturnType<typeof createStorage>;
type MockRpcClient = ReturnType<typeof createRpcClient>;
type MockAppActivityBridge = ReturnType<typeof createAppActivityBridge>;

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

function createAppActivityBridge(initialActivity: AppActivity = { kind: 'idle' }) {
  let appActivity = initialActivity;
  let onActivity: ((activity: AppActivity) => void) | undefined;

  return {
    getAppActivity: vi.fn(async () => appActivity),
    onAppActivity: vi.fn((callback: (activity: AppActivity) => void) => {
      onActivity = callback;
      return () => {
        if (onActivity === callback) {
          onActivity = undefined;
        }
      };
    }),
    emit(activity: AppActivity) {
      appActivity = activity;
      onActivity?.(activity);
    },
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

function getActivityPayload(rpcClient: MockRpcClient, callIndex = 0) {
  return rpcClient.setActivity.mock.calls[callIndex]?.[0] as {
    state: string;
    details: string;
    timestamps?: { start: number };
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

  it('maps idle to Using mLearn / Idling', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(rpcClient.login).toHaveBeenCalledWith({
      clientId: DISCORD_ACTIVITY_CLIENT_ID,
    });
    expect(getActivityPayload(rpcClient)).toEqual({
      state: 'Using mLearn',
      details: 'Idling',
      timestamps: {
        start: new Date('2026-03-29T12:00:00.000Z').getTime(),
      },
    });
  });

  it('maps reader to Reading on mLearn / Reading page 3/20 of Yotsuba', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(getActivityPayload(rpcClient)).toMatchObject({
      state: 'Reading on mLearn',
      details: 'Reading page 3/20 of Yotsuba',
    });
  });

  it('maps flashcards to Using mLearn / Reviewing Flashcards', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({ kind: 'flashcards' });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(getActivityPayload(rpcClient)).toMatchObject({
      state: 'Using mLearn',
      details: 'Reviewing Flashcards',
    });
  });

  it('maps video to Watching on mLearn / 00:15/05:00 - Spirited Away', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 15,
      durationSeconds: 300,
    });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(getActivityPayload(rpcClient)).toMatchObject({
      state: 'Watching on mLearn',
      details: '00:15/05:00 - Spirited Away',
    });
  });

  it('does not reset timestamps on later video bucket updates', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 15,
      durationSeconds: 300,
    });
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-03-29T12:00:00.000Z'))
      .mockReturnValueOnce(new Date('2026-03-29T12:00:30.000Z'));
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now,
    });

    await runtime.activate();
    appActivity.emit({
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 30,
      durationSeconds: 300,
    });

    expect(getActivityPayload(rpcClient, 0)?.timestamps?.start).toBe(
      getActivityPayload(rpcClient, 1)?.timestamps?.start,
    );
  });

  it('omits timestamps when showTimestamp is disabled', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'false',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(getActivityPayload(rpcClient)).not.toHaveProperty('timestamps');
  });

  it('resets timestamps when the activity kind changes', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({ kind: 'idle' });
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-03-29T12:00:00.000Z'))
      .mockReturnValueOnce(new Date('2026-03-29T12:01:00.000Z'));
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now,
    });

    await runtime.activate();
    appActivity.emit({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    });

    expect(getActivityPayload(rpcClient, 0)?.timestamps?.start).not.toBe(
      getActivityPayload(rpcClient, 1)?.timestamps?.start,
    );
  });

  it('resets timestamps when the work name changes', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    });
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-03-29T12:00:00.000Z'))
      .mockReturnValueOnce(new Date('2026-03-29T12:01:00.000Z'));
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient: () => rpcClient,
      now,
    });

    await runtime.activate();
    appActivity.emit({
      kind: 'reader',
      workName: 'Sora no Otoshimono',
      currentPage: 3,
      totalPages: 20,
    });

    expect(getActivityPayload(rpcClient, 0)?.timestamps?.start).not.toBe(
      getActivityPayload(rpcClient, 1)?.timestamps?.start,
    );
  });

  it('does not apply presence when persisted config is disabled', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'false',
      'discord-activity:showTimestamp': 'true',
    });
    const createRpcClient = vi.fn<() => MockRpcClient>(() => createRpcClient());
    const appActivity = createAppActivityBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
      createRpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(createRpcClient).not.toHaveBeenCalled();
  });

  it('clears presence and disconnects on deactivate', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const appActivity = createAppActivityBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
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
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    rpcClient.login.mockRejectedValueOnce(new Error('Discord is not running'));
    const appActivity = createAppActivityBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
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
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    rpcClient.setActivity.mockRejectedValueOnce(new Error('Failed to publish presence'));
    const appActivity = createAppActivityBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      appActivity,
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
