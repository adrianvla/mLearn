import type { AppActivity } from '../../../../src/shared/plugins/appActivity';

export const DISCORD_ACTIVITY_CLIENT_ID = '1487871166633869342';

export type DiscordActivityStatusDescription = {
  label: string;
  state: string;
  details: string;
};

const DISCORD_ACTIVITY_METADATA = {
  idle: {
    label: 'Idle',
    state: 'Using mLearn',
    exampleDetails: 'Idling',
    getDetails: () => 'Idling',
  },
  reader: {
    label: 'Reader',
    state: 'Reading on mLearn',
    exampleDetails: 'Reading page x/y of {work name}',
    getDetails: (activity: Extract<AppActivity, { kind: 'reader' }>) =>
      `Reading page ${activity.currentPage}/${activity.totalPages} of ${activity.workName}`,
  },
  video: {
    label: 'Video',
    state: 'Watching on mLearn',
    exampleDetails: '{current time}/{duration} - {work name}',
    getDetails: (activity: Extract<AppActivity, { kind: 'video' }>) =>
      `${formatDuration(activity.currentTimeSeconds)}/${formatDuration(activity.durationSeconds)} - ${activity.workName}`,
  },
  flashcards: {
    label: 'Flashcards',
    state: 'Using mLearn',
    exampleDetails: 'Reviewing Flashcards',
    getDetails: () => 'Reviewing Flashcards',
  },
} as const;

export const DISCORD_ACTIVITY_STATUS_DESCRIPTIONS: DiscordActivityStatusDescription[] = [
  {
    label: DISCORD_ACTIVITY_METADATA.idle.label,
    state: DISCORD_ACTIVITY_METADATA.idle.state,
    details: DISCORD_ACTIVITY_METADATA.idle.exampleDetails,
  },
  {
    label: DISCORD_ACTIVITY_METADATA.reader.label,
    state: DISCORD_ACTIVITY_METADATA.reader.state,
    details: DISCORD_ACTIVITY_METADATA.reader.exampleDetails,
  },
  {
    label: DISCORD_ACTIVITY_METADATA.video.label,
    state: DISCORD_ACTIVITY_METADATA.video.state,
    details: DISCORD_ACTIVITY_METADATA.video.exampleDetails,
  },
  {
    label: DISCORD_ACTIVITY_METADATA.flashcards.label,
    state: DISCORD_ACTIVITY_METADATA.flashcards.state,
    details: DISCORD_ACTIVITY_METADATA.flashcards.exampleDetails,
  },
];

export type DiscordActivityConfig = {
  enabled: boolean;
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
        state: DISCORD_ACTIVITY_METADATA.idle.state,
        details: DISCORD_ACTIVITY_METADATA.idle.getDetails(),
      };
    case 'reader':
      return {
        state: DISCORD_ACTIVITY_METADATA.reader.state,
        details: DISCORD_ACTIVITY_METADATA.reader.getDetails(activity),
      };
    case 'flashcards':
      return {
        state: DISCORD_ACTIVITY_METADATA.flashcards.state,
        details: DISCORD_ACTIVITY_METADATA.flashcards.getDetails(),
      };
    case 'video':
      return {
        state: DISCORD_ACTIVITY_METADATA.video.state,
        details: DISCORD_ACTIVITY_METADATA.video.getDetails(activity),
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

export async function loadDiscordActivityConfig(storage: Storage): Promise<DiscordActivityConfig> {
  const [enabledRaw, showTimestampRaw] = await Promise.all([
    storage.get('discord-activity:enabled'),
    storage.get('discord-activity:showTimestamp'),
  ]);

  return {
    enabled: normalizeBoolean(enabledRaw, true),
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
