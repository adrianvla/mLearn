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
  createRpcClient: CreateRpcClient;
  now?: () => Date;
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
  createRpcClient,
  now = () => new Date(),
}: RuntimeDependencies) {
  let rpcClient: RpcClient | undefined;

  return {
    async activate(): Promise<void> {
      await cleanupRpcClient(rpcClient);
      rpcClient = undefined;

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
        await nextClient.setActivity({
          details: config.details,
          state: config.state,
          ...(config.showTimestamp
            ? {
                timestamps: {
                  start: now().getTime(),
                },
              }
            : {}),
        });

        rpcClient = nextClient;
        await persistRuntimeStatus(storage, {
          connected: true,
          lastError: '',
        });
      } catch (error) {
        await cleanupRpcClient(nextClient);
        await persistRuntimeStatus(storage, {
          connected: false,
          lastError: getErrorMessage(error),
        });
      }
    },
    async deactivate(): Promise<void> {
      await cleanupRpcClient(rpcClient);
      rpcClient = undefined;

      await persistRuntimeStatus(storage, {
        connected: false,
        lastError: '',
      });
    },
  };
}
