import { describe, expect, it, vi } from 'vitest';

import type { AppActivity } from '../../../../src/shared/plugins/appActivity';
import type { PluginBusEnvelope } from '../../../../src/shared/pluginBus';

import {
  createDiscordActivityRuntime,
  DISCORD_ACTIVITY_CLIENT_ID,
  loadDiscordActivityConfig,
} from './runtime';

type MockStorage = ReturnType<typeof createStorage>;
type MockRpcClient = ReturnType<typeof createRpcClient>;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

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

function createPluginBridge(initialActivity?: AppActivity) {
  let envelope: PluginBusEnvelope = initialActivity === undefined
    ? { hasValue: false, value: null }
    : { hasValue: true, value: initialActivity };
  let onValue:
    | ((nextValue: PluginBusEnvelope, previousValue: PluginBusEnvelope) => void)
    | undefined;

  return {
    getPluginValue: vi.fn(async (channel: string) => {
      expect(channel).toBe('app.user.activity');
      return envelope;
    }),
    onPluginValue: vi.fn((channel: string, callback: (nextValue: PluginBusEnvelope, previousValue: PluginBusEnvelope) => void) => {
      expect(channel).toBe('app.user.activity');
      onValue = callback;
      return () => {
        if (onValue === callback) {
          onValue = undefined;
        }
      };
    }),
    emit(activity: AppActivity | undefined) {
      const previousEnvelope = envelope;
      envelope = activity === undefined
        ? { hasValue: false, value: null }
        : { hasValue: true, value: activity };
      onValue?.(envelope, previousEnvelope);
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
      'discord-activity:showTimestamp': 'not-a-boolean',
    });

    const config = await loadDiscordActivityConfig(storage);

    expect(config).toEqual({
      enabled: false,
      showTimestamp: true,
    });
    expect(storage.get).toHaveBeenCalledTimes(2);
    expect(storage.get).toHaveBeenCalledWith('discord-activity:enabled');
    expect(storage.get).toHaveBeenCalledWith('discord-activity:showTimestamp');
  });

  it('maps idle to Using mLearn / Idling', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({ kind: 'flashcards' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 15,
      durationSeconds: 300,
    });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({
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
      pluginBridge,
      createRpcClient: () => rpcClient,
      now,
    });

    await runtime.activate();
    pluginBridge.emit({
      kind: 'video',
      workName: 'Spirited Away',
      currentTimeSeconds: 30,
      durationSeconds: 300,
    });

    expect(getActivityPayload(rpcClient, 0)?.timestamps?.start).toBe(
      getActivityPayload(rpcClient, 1)?.timestamps?.start,
    );
  });

  it('publishes the latest activity when an update arrives during activate', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const readerActivity: AppActivity = {
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    };
    pluginBridge.getPluginValue.mockImplementationOnce(async () => {
      pluginBridge.emit(readerActivity);
      return { hasValue: false, value: null };
    });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(rpcClient.setActivity).toHaveBeenCalledTimes(1);
    expect(getActivityPayload(rpcClient)).toMatchObject({
      state: 'Reading on mLearn',
      details: 'Reading page 3/20 of Yotsuba',
    });
  });

  it('does not let a stale activity callback tear down a newer RPC client', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const firstClient = createRpcClient();
    const secondClient = createRpcClient();
    const stalePublish = createDeferred<void>();
    firstClient.setActivity
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => stalePublish.promise);
    const createRpcClientForActivation = vi
      .fn<() => MockRpcClient>()
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient);
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
      createRpcClient: createRpcClientForActivation,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();
    pluginBridge.emit({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    });

    await runtime.activate();

    stalePublish.reject(new Error('stale callback failure'));
    await flushMicrotasks();

    expect(secondClient.clearActivity).not.toHaveBeenCalled();
    expect(secondClient.disconnect).not.toHaveBeenCalled();

    const status = await readPersistedStatus(storage);
    expect(status).toEqual({
      connected: true,
      lastError: '',
    });
  });

  it('does not install a slow older activation after a later deactivate', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const slowLogin = createDeferred<void>();
    const firstClient = createRpcClient();
    firstClient.login.mockImplementationOnce(() => slowLogin.promise);
    const createRpcClientForActivation = vi
      .fn<() => MockRpcClient>()
      .mockReturnValueOnce(firstClient);
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
      createRpcClient: createRpcClientForActivation,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    const firstActivate = runtime.activate();
    await flushMicrotasks();

    await runtime.deactivate();

    slowLogin.resolve();
    await firstActivate;

    expect(firstClient.setActivity).not.toHaveBeenCalled();
    expect(firstClient.clearActivity).toHaveBeenCalledTimes(1);
    expect(firstClient.disconnect).toHaveBeenCalledTimes(1);

    const status = await readPersistedStatus(storage);
    expect(status).toEqual({
      connected: false,
      lastError: '',
    });
  });

  it('does not persist connected status when a slow snapshot resumes after deactivate', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const snapshotStarted = createDeferred<void>();
    const slowSnapshot = createDeferred<PluginBusEnvelope>();
    const rpcClient = createRpcClient();
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    pluginBridge.getPluginValue.mockImplementationOnce(() => {
      snapshotStarted.resolve();
      return slowSnapshot.promise;
    });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    const activatePromise = runtime.activate();
    await snapshotStarted.promise;

    await runtime.deactivate();

    slowSnapshot.resolve({ hasValue: true, value: { kind: 'idle' } });
    await activatePromise;

    const status = await readPersistedStatus(storage);
    expect(status).toEqual({
      connected: false,
      lastError: '',
    });
  });

  it('omits timestamps when showTimestamp is disabled', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'false',
    });
    const rpcClient = createRpcClient();
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date('2026-03-29T12:00:00.000Z'))
      .mockReturnValueOnce(new Date('2026-03-29T12:01:00.000Z'));
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
      createRpcClient: () => rpcClient,
      now,
    });

    await runtime.activate();
    pluginBridge.emit({
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
    const pluginBridge = createPluginBridge({
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
      pluginBridge,
      createRpcClient: () => rpcClient,
      now,
    });

    await runtime.activate();
    pluginBridge.emit({
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
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
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

  it('queues only the latest pending activity while a publish is in flight', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const inFlightPublish = createDeferred<void>();
    const rpcClient = createRpcClient();
    rpcClient.setActivity
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => inFlightPublish.promise)
      .mockImplementationOnce(async () => undefined);
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    pluginBridge.emit({
      kind: 'flashcards',
    });
    await flushMicrotasks();

    expect(rpcClient.setActivity).toHaveBeenCalledTimes(2);

    pluginBridge.emit({
      kind: 'reader',
      workName: 'Yotsuba',
      currentPage: 3,
      totalPages: 20,
    });
    await flushMicrotasks();

    expect(rpcClient.setActivity).toHaveBeenCalledTimes(2);

    inFlightPublish.resolve();
    await flushMicrotasks();

    expect(rpcClient.setActivity).toHaveBeenCalledTimes(3);
    expect(getActivityPayload(rpcClient, 2)).toMatchObject({
      details: 'Reading page 3/20 of Yotsuba',
    });

    expect(getActivityPayload(rpcClient, 0)).toMatchObject({
      details: 'Idling',
    });
    expect(getActivityPayload(rpcClient, 1)).toMatchObject({
      details: 'Reviewing Flashcards',
    });

    const status = await readPersistedStatus(storage);
    expect(status).toMatchObject({
      connected: true,
      lastError: '',
    });
  });

  it('logs runtime failures with the plugin name prefix', async () => {
    const storage = createStorage({
      'discord-activity:enabled': 'true',
      'discord-activity:showTimestamp': 'true',
    });
    const rpcClient = createRpcClient();
    rpcClient.setActivity.mockRejectedValueOnce(new Error('Failed to publish presence'));
    const pluginBridge = createPluginBridge({ kind: 'idle' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = createDiscordActivityRuntime({
      storage,
      pluginBridge,
      createRpcClient: () => rpcClient,
      now: () => new Date('2026-03-29T12:00:00.000Z'),
    });

    await runtime.activate();

    expect(consoleError).toHaveBeenCalledWith(
      '[Plugin] [Discord Activity]',
      'Failed to publish presence',
    );

    consoleError.mockRestore();
  });

  it('exports one checked-in Discord client ID constant', () => {
    expect(DISCORD_ACTIVITY_CLIENT_ID).toMatch(/^\d{10,}$/);
  });
});
