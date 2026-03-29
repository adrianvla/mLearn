import type { AppActivity } from '../../../../src/shared/plugins/appActivity';

export const DISCORD_ACTIVITY_CLIENT_ID = '1366046646392395806';

const DEFAULT_DETAILS = 'Studying with mLearn';
const DEFAULT_STATE = 'In a focused session';

export type DiscordActivityConfig = {
  enabled: boolean;
  details: string;
  state: string;
  showTimestamp: boolean;
};

export type DiscordActivityRuntimeStatus = {
  connected: boolean;
  lastError: string;
};

export type AppActivityBridge = {
  getAppActivity: () => Promise<AppActivity>;
  onAppActivity: (callback: (activity: AppActivity) => void) => () => void;
};

type Storage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
};

type RpcClient = {
  login: (options: { clientId: string }) => Promise<void>;
  setActivity: (activity: Record<string, unknown>) => Promise<void>;
  clearActivity: () => Promise<void>;
  disconnect: () => Promise<void>;
};

type CreateRpcClient = () => RpcClient;

type RuntimeDependencies = {
  storage: Storage;
  appActivity: AppActivityBridge;
  createRpcClient: CreateRpcClient;
  now?: () => Date;
};

type RuntimeSession = {
  token: number;
  client: RpcClient;
  showTimestamp: boolean;
  unsubscribeFromAppActivity?: () => void;
  activitySessionKey?: string;
  activitySessionStart?: number;
};

const RUNTIME_STATUS_KEY = 'discord-activity:runtime-status';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Unknown Discord RPC error';
}

async function persistRuntimeStatus(storage: Storage, status: DiscordActivityRuntimeStatus): Promise<void> {
  await storage.set(RUNTIME_STATUS_KEY, JSON.stringify(status));
}

async function cleanupRpcClient(rpcClient: RpcClient | undefined): Promise<void> {
  if (!rpcClient) {
    return;
  }

  try {
    await rpcClient.clearActivity();
  } finally {
    await rpcClient.disconnect();
  }
}

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || totalSeconds < 0) {
    return '--:--';
  }

  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function getActivitySessionKey(activity: AppActivity): string {
  switch (activity.kind) {
    case 'idle':
    case 'flashcards':
      return activity.kind;
    case 'reader':
    case 'video':
      return `${activity.kind}:${activity.workName}`;
  }
}

function mapAppActivityToDiscordPresence(activity: AppActivity): {
  state: string;
  details: string;
} {
  switch (activity.kind) {
    case 'idle':
      return {
        state: 'Using mLearn',
        details: 'Idling',
      };
    case 'reader':
      return {
        state: 'Reading on mLearn',
        details: `Reading page ${activity.currentPage}/${activity.totalPages} of ${activity.workName}`,
      };
    case 'flashcards':
      return {
        state: 'Using mLearn',
        details: 'Reviewing Flashcards',
      };
    case 'video':
      return {
        state: 'Watching on mLearn',
        details: `${formatDuration(activity.currentTimeSeconds)}/${formatDuration(activity.durationSeconds)} - ${activity.workName}`,
      };
  }
}

function normalizeBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
}

function normalizeString(value: string | null, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : fallback;
}

export async function loadDiscordActivityConfig(storage: Storage): Promise<DiscordActivityConfig> {
  const [enabledRaw, detailsRaw, stateRaw, showTimestampRaw] = await Promise.all([
    storage.get('discord-activity:enabled'),
    storage.get('discord-activity:details'),
    storage.get('discord-activity:state'),
    storage.get('discord-activity:showTimestamp'),
  ]);

  return {
    enabled: normalizeBoolean(enabledRaw, true),
    details: normalizeString(detailsRaw, DEFAULT_DETAILS),
    state: normalizeString(stateRaw, DEFAULT_STATE),
    showTimestamp: normalizeBoolean(showTimestampRaw, true),
  };
}

export function createDiscordActivityRuntime({
  storage,
  appActivity,
  createRpcClient,
  now = () => new Date(),
}: RuntimeDependencies) {
  let activeSession: RuntimeSession | undefined;
  let runtimeToken = 0;

  function getTimestamps(session: RuntimeSession, activity: AppActivity): { start: number } | undefined {
    if (!session.showTimestamp) {
      return undefined;
    }

    const nextSessionKey = getActivitySessionKey(activity);
    if (session.activitySessionKey !== nextSessionKey || session.activitySessionStart === undefined) {
      session.activitySessionKey = nextSessionKey;
      session.activitySessionStart = now().getTime();
    }

    return {
      start: session.activitySessionStart,
    };
  }

  async function publishActivity(session: RuntimeSession, activity: AppActivity): Promise<void> {
    if (activeSession !== session) {
      return;
    }

    const presence = mapAppActivityToDiscordPresence(activity);
    const timestamps = getTimestamps(session, activity);

    await session.client.setActivity({
      ...presence,
      ...(timestamps ? { timestamps } : {}),
    });
  }

  async function handleRuntimeError(session: RuntimeSession, error: unknown): Promise<void> {
    const isCurrentSession = activeSession === session;
    if (isCurrentSession) {
      session.unsubscribeFromAppActivity?.();
      session.unsubscribeFromAppActivity = undefined;
      activeSession = undefined;
    }

    await cleanupRpcClient(session.client);

    if (session.token !== runtimeToken) {
      return;
    }

    await persistRuntimeStatus(storage, {
      connected: false,
      lastError: getErrorMessage(error),
    });
  }

  return {
    async activate(): Promise<void> {
      runtimeToken += 1;
      const activationToken = runtimeToken;
      const previousSession = activeSession;
      activeSession = undefined;
      previousSession?.unsubscribeFromAppActivity?.();
      if (previousSession) {
        previousSession.unsubscribeFromAppActivity = undefined;
        await cleanupRpcClient(previousSession.client);
      }

      const config = await loadDiscordActivityConfig(storage);
      if (!config.enabled) {
        await persistRuntimeStatus(storage, {
          connected: false,
          lastError: '',
        });
        return;
      }

      const nextClient = createRpcClient();

      try {
        await nextClient.login({
          clientId: DISCORD_ACTIVITY_CLIENT_ID,
        });
        if (activationToken !== runtimeToken) {
          await cleanupRpcClient(nextClient);
          return;
        }

        const session: RuntimeSession = {
          token: activationToken,
          client: nextClient,
          showTimestamp: config.showTimestamp,
        };
        activeSession = session;
        let sawActivityEvent = false;
        session.unsubscribeFromAppActivity = appActivity.onAppActivity((activity) => {
          sawActivityEvent = true;
          void publishActivity(session, activity).catch(async (error) => {
            await handleRuntimeError(session, error);
          });
        });
        const initialActivity = await appActivity.getAppActivity();
        if (activationToken !== runtimeToken || activeSession !== session) {
          session.unsubscribeFromAppActivity?.();
          session.unsubscribeFromAppActivity = undefined;
          await cleanupRpcClient(nextClient);
          return;
        }

        if (!sawActivityEvent) {
          await publishActivity(session, initialActivity);
        }
        await persistRuntimeStatus(storage, {
          connected: true,
          lastError: '',
        });
      } catch (error) {
        const failedSession = activeSession?.client === nextClient
          ? activeSession
          : {
              token: activationToken,
              client: nextClient,
              showTimestamp: config.showTimestamp,
            };
        await handleRuntimeError(failedSession, error);
      }
    },
    async deactivate(): Promise<void> {
      runtimeToken += 1;
      const previousSession = activeSession;
      activeSession = undefined;
      previousSession?.unsubscribeFromAppActivity?.();
      if (previousSession) {
        previousSession.unsubscribeFromAppActivity = undefined;
        await cleanupRpcClient(previousSession.client);
      }

      await persistRuntimeStatus(storage, {
        connected: false,
        lastError: '',
      });
    },
  };
}
