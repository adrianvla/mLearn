/**
 * Unified LLM Router
 * Routes LLM_STREAM and LLM_STREAM_ABORT to the correct provider (builtin, ollama, or cloud).
 *
 * Stream guard: exactly ONE active stream app-wide at any time. A second LLM_STREAM from the
 * same webContents is rejected with a STREAM_BUSY error chunk while delivery is active;
 * subsequent turns and requests from other webContents wait until provider cleanup completes.
 * Only the owning webContents may abort its stream.
 */

import { ipcMain, type IpcMainEvent } from 'electron';
import { EventEmitter } from 'events';
import { getUserDataPath } from '../utils/platform';
import { IPC_CHANNELS } from '../../shared/constants';
import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk, Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { loadSettings } from './settings';
import { ollamaStreamChatUnified, ollamaAbortStream } from './ollamaService';
import { builtinStreamChat, builtinAbortStream } from './builtinLLMService';
import { CloudLLMAdapter } from '../../shared/backends/cloudLLMAdapter';
import { DEFAULT_CLOUD_API_URL } from '../../shared/constants';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.llmRouter');

let cloudAdapter: CloudLLMAdapter | null = null;

interface QueuedStreamRequest {
  sender: Electron.WebContents;
  messages: LLMChatMessage[];
  tools: LLMToolDefinition[];
  tier?: string;
  think?: boolean;
  expectedRoute?: string;
  priority?: 'foreground' | 'background';
}

function routeKey(settings: Settings): string {
  return JSON.stringify([getUserDataPath(), settings.livingWorldEnabled, settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled,
    settings.proactivityEnabled ?? DEFAULT_SETTINGS.proactivityEnabled,
    settings.proactiveOptOutParticipantIds, settings.proactiveOptOutRoomIds, settings.proactiveCallOptOutParticipantIds,
    settings.llmEnabled, settings.inferenceCloudTier, settings.llmProvider, settings.ollamaUrl, settings.ollamaModel,
    settings.builtinModel, settings.cloudApiUrl, settings.overrideCloudEndpointUrl,
    settings.cloudAuthAccessToken, settings.cloudAuthToken]);
}

let activeOwner: number | null = null;
let activeProvider: Settings['llmProvider'] | null = null;
let activeSender: Electron.WebContents | null = null;
let activeOriginalSend: ((channel: string, ...args: unknown[]) => void) | null = null;
let activeDestroyedListener: (() => void) | null = null;
interface StreamLifecycle {
  providerSettled: boolean;
  terminal: boolean;
  cancelled: boolean;
}
let activeLifecycle: StreamLifecycle | null = null;
const queue: QueuedStreamRequest[] = [];

function enqueueRequest(request: QueuedStreamRequest): void {
  if (request.priority !== 'foreground') {
    queue.push(request);
    return;
  }
  const firstBackground = queue.findIndex(item => item.priority === 'background');
  if (firstBackground === -1) queue.push(request);
  else queue.splice(firstBackground, 0, request);
}

// A terminal chunk completes delivery, but the provider still owns resources until
// its promise settles (notably the built-in session's asynchronous disposal).
function wrapSenderSend(sender: Electron.WebContents): void {
  const lifecycle: StreamLifecycle = { providerSettled: false, terminal: false, cancelled: false };
  activeLifecycle = lifecycle;
  const originalSend = sender.send.bind(sender);
  activeOriginalSend = originalSend;
  sender.send = (channel: string, ...args: unknown[]) => {
    if (sender.isDestroyed()) return;
    if (channel === IPC_CHANNELS.LLM_STREAM_CHUNK) {
      if (lifecycle.cancelled || lifecycle.terminal) return;
      const chunk = args[0] as LLMStreamChunk | undefined;
      if (chunk?.done) lifecycle.terminal = true;
    }
    try {
      originalSend(channel, ...args);
    } finally {
      if (activeLifecycle === lifecycle) releaseStream();
    }
  };
  activeDestroyedListener = () => cancelActiveStream(sender.id);
  sender.once('destroyed', activeDestroyedListener);
}

function cancelActiveStream(senderId: number): void {
  if (activeOwner !== senderId || !activeLifecycle || activeLifecycle.cancelled) return;
  activeLifecycle.cancelled = true;
  abortProvider(senderId);
  releaseStream();
}

function releaseStream(): void {
  if (!activeLifecycle?.providerSettled || (!activeLifecycle.terminal && !activeLifecycle.cancelled)) return;
  if (activeSender && activeDestroyedListener) {
    activeSender.removeListener('destroyed', activeDestroyedListener);
  }
  if (activeSender && activeOriginalSend) {
    activeSender.send = activeOriginalSend;
  }
  activeDestroyedListener = null;
  activeOriginalSend = null;
  activeSender = null;
  activeOwner = null;
  activeProvider = null;
  activeLifecycle = null;
  drainQueue();
}

function drainQueue(): void {
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (next.sender.isDestroyed()) {
      continue;
    }
    activeOwner = next.sender.id;
    activeSender = next.sender;
    wrapSenderSend(next.sender);
    void dispatchStream(next.sender, next.messages, next.tools, next.tier, next.think, next.expectedRoute,
      next.priority === 'background' ? 'internal' : 'foreground');
    return;
  }
}

function cloudAdapterFromSettings(settings: Settings): CloudLLMAdapter {
  const cloudApiUrl = (settings.overrideCloudEndpointUrl && settings.cloudApiUrl)
    ? settings.cloudApiUrl.replace(/\/+$/, '')
    : DEFAULT_CLOUD_API_URL;
  return new CloudLLMAdapter(
    cloudApiUrl,
    settings.cloudAuthAccessToken || settings.cloudAuthToken,
  );
}

function getCloudAdapter(): CloudLLMAdapter {
  // Recreate if settings changed
  cloudAdapter = cloudAdapterFromSettings(loadSettings());
  return cloudAdapter;
}

/**
 * Non-streaming cloud completion for background cognition (Dreamer). Builds a
 * private adapter so it never rebinds the shared `cloudAdapter` that a user
 * stream's abort depends on.
 */
export function cloudComplete(messages: LLMChatMessage[]): Promise<string> {
  const adapter = cloudAdapterFromSettings(loadSettings());
  return new Promise<string>((resolve, reject) => {
    let text = '';
    void adapter.streamChat(messages, [], {
      onChunk: (chunk) => {
        if (chunk.error !== undefined) {
          reject(new Error(chunk.error));
          return;
        }
        if (chunk.content) text += chunk.content;
        if (chunk.done) resolve(text);
      },
      onDone: () => resolve(text),
      onError: (error) => reject(new Error(error)),
    }, undefined, undefined, 'internal');
  });
}

/** Route a stream to the provider configured in settings (existing routing logic). */
async function dispatchStream(
  sender: Electron.WebContents,
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  tier?: string,
  think?: boolean,
  expectedRoute?: string,
  usageScope: 'foreground' | 'internal' = 'foreground',
): Promise<void> {
  const lifecycle = activeLifecycle;
  try {
    const settings = loadSettings();
    const provider = settings.llmProvider || DEFAULT_SETTINGS.llmProvider;
    activeProvider = provider;
    if (expectedRoute !== undefined && expectedRoute !== routeKey(settings)) throw new Error('Inference settings changed while the job was queued');
    if (provider === 'cloud') {
      const adapter = getCloudAdapter();
      await adapter.streamChat(messages, tools || [], {
        onChunk: (chunk) => sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk),
        onDone: () => {},
        onError: (error) => {
          const errorChunk: LLMStreamChunk = { error, done: true };
          sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, errorChunk);
        },
      }, tier === 'standard' || tier === 'realtime' ? tier : undefined, think, usageScope);
    } else if (provider === 'ollama') {
      await ollamaStreamChatUnified(sender, messages, tools || []);
    } else {
      await builtinStreamChat(sender, messages, tools || [], settings.builtinModel || undefined);
    }
  } catch (err) {
    log.error('[LLMRouter] Stream error:', (err as Error).message);
    const errorChunk: LLMStreamChunk = {
      error: (err as Error).message || 'Failed to start LLM stream',
      done: true,
    };
    sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, errorChunk);
  } finally {
    if (lifecycle && activeLifecycle === lifecycle) {
      lifecycle.providerSettled = true;
      releaseStream();
    }
  }
}

/** Route an abort to the provider configured in settings (existing routing logic). */
function abortProvider(senderId: number): void {
  const settings = loadSettings();
  const provider = activeProvider ?? settings.llmProvider ?? DEFAULT_SETTINGS.llmProvider;

  if (provider === 'cloud') {
    cloudAdapter?.abort();
  } else if (provider === 'ollama') {
    ollamaAbortStream(senderId);
  } else {
    builtinAbortStream();
  }
}

let nextJobOwner = -100;

/** Main-owned inference shares the conversation queue and owns only its cancellation. */
export function completeJob(
  messages: LLMChatMessage[],
  signal: AbortSignal,
  maxOutputCharacters = 24000,
  priority: 'foreground' | 'background' = 'foreground',
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let text = '';
    const sender = Object.assign(new EventEmitter(), {
      id: nextJobOwner--,
      isDestroyed: () => settled,
      send: (_channel: string, chunk: LLMStreamChunk) => {
        if (settled) return;
        if (chunk.error) { cancel(new Error(chunk.error)); return; }
        text += chunk.content ?? '';
        if (text.length > maxOutputCharacters) { cancel(new Error('Model output exceeded the scenario budget')); return; }
        if (chunk.done) finish();
      },
    }) as unknown as Electron.WebContents;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(text);
    };
    const cancel = (error: Error): void => {
      finish(error);
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].sender.id === sender.id) queue.splice(i, 1);
      if (activeOwner === sender.id) {
        cancelActiveStream(sender.id);
      }
    };
    const onAbort = (): void => cancel(new Error('Scenario generation cancelled'));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    enqueueRequest({ sender, messages, tools: [], expectedRoute: routeKey(loadSettings()), priority });
    if (activeOwner === null) drainQueue();
  });
}

/**
 * Set up the unified LLM stream router.
 * Call this after setupOllamaIPC() and setupBuiltinLLMIPC().
 */
export function setupLLMRouterIPC(): void {
  // Unified stream — routes to the correct provider, guarded to one active stream
  ipcMain.on(IPC_CHANNELS.LLM_STREAM, async (event: IpcMainEvent, messages: LLMChatMessage[], tools: LLMToolDefinition[], tier?: string, think?: boolean) => {
    const sender = event.sender;

    if (activeOwner === null) {
      activeOwner = sender.id;
      activeSender = sender;
      wrapSenderSend(sender);
      await dispatchStream(sender, messages, tools, tier, think);
    } else if (activeOwner === sender.id && !activeLifecycle?.terminal && !activeLifecycle?.cancelled) {
      // Same webContents overlapping its own stream is a programming error: reject without
      // touching the provider and without routing through the wrapped send (a done:true chunk
      // through the wrapper would release the active stream).
      const busyChunk: LLMStreamChunk = { error: 'STREAM_BUSY', done: true };
      activeOriginalSend!(IPC_CHANNELS.LLM_STREAM_CHUNK, busyChunk);
    } else {
      enqueueRequest({ sender, messages, tools, tier, think, priority: 'foreground' });
    }
  });

  // Unified abort — only the owning webContents may abort the active stream
  ipcMain.on(IPC_CHANNELS.LLM_STREAM_ABORT, (event: IpcMainEvent) => {
    const sender = event.sender;

    let removedQueued = false;
    // A new turn may queue behind this same window's terminal/aborted stream
    // while that provider is disposing its resources.
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].sender.id === sender.id) {
        queue.splice(i, 1);
        removedQueued = true;
      }
    }
    if (activeOwner === sender.id) {
      cancelActiveStream(sender.id);
    } else if (!removedQueued) {
      log.warn('[LLMRouter] Abort rejected: no active or queued stream for this webContents');
    }
  });
}

// Test-only: reset guard state between tests
export function __resetStreamGuardForTests(): void {
  if (activeSender && activeDestroyedListener) {
    activeSender.removeListener('destroyed', activeDestroyedListener);
  }
  if (activeSender && activeOriginalSend) {
    activeSender.send = activeOriginalSend;
  }
  activeDestroyedListener = null;
  activeOriginalSend = null;
  activeSender = null;
  activeOwner = null;
  activeProvider = null;
  activeLifecycle = null;
  queue.length = 0;
}
