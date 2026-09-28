/**
 * Unified LLM Router
 * Routes LLM_STREAM and LLM_STREAM_ABORT to the correct provider (builtin, ollama, or cloud).
 *
 * Stream guard: exactly ONE active stream app-wide at any time. A second LLM_STREAM from the
 * same webContents is rejected with a STREAM_BUSY error chunk while delivery is active;
 * subsequent turns and requests from other webContents wait until provider cleanup completes.
 * Only the owning webContents may abort its stream.
 */

import type { RuntimeTraceContext } from '../../shared/runtimeInspection';
import { runtimeTrace, recordRuntimeChunk, finishRuntimeTrace } from './runtimeTraceService';
import { ipcMain, type IpcMainEvent } from 'electron';
import { EventEmitter } from 'events';
import { getUserDataPath } from '../utils/platform';
import { IPC_CHANNELS } from '../../shared/constants';
import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk, Settings } from '../../shared/types';
import { usesManagedLlm } from '../../shared/llmTask';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { loadSettings } from './settings';
import { ollamaStreamChatUnified, ollamaAbortStream } from './ollamaService';
import { builtinStreamChat, builtinAbortStream } from './builtinLLMService';
import { CloudLLMAdapter, OpenAICompatibleLLMAdapter } from '../../shared/backends/cloudLLMAdapter';
import { DEFAULT_CLOUD_API_URL } from '../../shared/constants';
import { getLogger } from '../../shared/utils/logger';
import { runtimeAllows } from './kikanRuntime';

const log = getLogger('electron.llmRouter');

let cloudAdapter: CloudLLMAdapter | null = null;
let compatibleAdapter: OpenAICompatibleLLMAdapter | null = null;

interface QueuedStreamRequest {
  traceId?: string;
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
    settings.cloudAuthAccessToken, settings.cloudAuthToken,
    settings.compatibleApiBaseUrl, settings.compatibleApiKey, settings.compatibleModel]);
}

let activeOwner: number | null = null;
let activeProvider: Settings['llmProvider'] | null = null;
let activeSender: Electron.WebContents | null = null;
let activeOriginalSend: ((channel: string, ...args: unknown[]) => void) | null = null;
let activeDestroyedListener: (() => void) | null = null;
interface StreamLifecycle {
  traceId?: string;
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
function wrapSenderSend(sender: Electron.WebContents, traceId?: string): void {
  const lifecycle: StreamLifecycle = { traceId, providerSettled: false, terminal: false, cancelled: false };
  activeLifecycle = lifecycle;
  const originalSend = sender.send.bind(sender);
  activeOriginalSend = originalSend;
  sender.send = (channel: string, ...args: unknown[]) => {
    if (sender.isDestroyed()) return;
    if (channel === IPC_CHANNELS.LLM_STREAM_CHUNK) {
      if (lifecycle.cancelled || lifecycle.terminal) return;
      const chunk = args[0] as LLMStreamChunk | undefined;
      if (chunk?.done) lifecycle.terminal = true;
      // Capture provider output first, but defer terminal classification until
      // the owner has synchronously accepted or rejected it (e.g. its budget).
      if (chunk) { const { done: _done, error: _error, ...payload } = chunk; recordRuntimeChunk(lifecycle.traceId, payload); }
    }
    try {
      originalSend(channel, ...args);
    } finally {
      // Main-owned jobs validate delivery (including budgets) synchronously.
      // A rejected terminal chunk must not first be recorded as a success.
      if (channel === IPC_CHANNELS.LLM_STREAM_CHUNK && args[0]) {
        const chunk = args[0] as LLMStreamChunk;
        if (chunk.done || chunk.error) recordRuntimeChunk(lifecycle.traceId, { done: chunk.done, error: chunk.error });
      }
      if (activeLifecycle === lifecycle) releaseStream();
    }
  };
  activeDestroyedListener = () => cancelActiveStream(sender.id);
  sender.once('destroyed', activeDestroyedListener);
}

function cancelActiveStream(senderId: number): void {
  if (activeOwner !== senderId || !activeLifecycle || activeLifecycle.cancelled) return;
  activeLifecycle.cancelled = true;
  finishRuntimeTrace(activeLifecycle.traceId, 'cancelled');
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
      finishRuntimeTrace(next.traceId, 'cancelled');
      continue;
    }
    activeOwner = next.sender.id;
    activeSender = next.sender;
    wrapSenderSend(next.sender, next.traceId);
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
    usesManagedLlm(settings),
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
  if (!runtimeAllows('cloud-llm')) return Promise.reject(new Error('Cloud LLM is temporarily unavailable'));
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
    log.info('Tutor inference dispatch', { ownerId: sender.id, provider, queued: expectedRoute !== undefined, modelFile: provider === 'builtin' ? settings.builtinModel : undefined, messageCount: messages.length, messageCharacters: messages.reduce((sum, message) => sum + message.content.length, 0) });
    activeProvider = provider;
    runtimeTrace().start(lifecycle?.traceId, { provider, model: provider === 'builtin' ? settings.builtinModel
      : provider === 'ollama' ? settings.ollamaModel : provider === 'openai-compatible' ? settings.compatibleModel : undefined, tier });
    if (expectedRoute !== undefined && expectedRoute !== routeKey(settings)) throw new Error('Inference settings changed while the job was queued');
    if (provider === 'cloud' || provider === 'openai-compatible') {
      if (!runtimeAllows('cloud-llm')) throw new Error('Cloud LLM is temporarily unavailable');
      const adapter = provider === 'cloud' ? getCloudAdapter()
        : (compatibleAdapter = new OpenAICompatibleLLMAdapter(
          settings.compatibleApiBaseUrl, settings.compatibleApiKey, settings.compatibleModel));
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
  } else if (provider === 'openai-compatible') {
    compatibleAdapter?.abort();
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
  traceContext: RuntimeTraceContext = { source: 'internal' },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const queuedAt = performance.now();
    messages = structuredClone(messages); // Freeze queued application input, not just its diagnostic copy.
    const traceId = runtimeTrace().begin({ kind: 'model', context: traceContext, input: { messages, tools: [], priority, maxOutputCharacters } });
    let settled = false;
    let text = '';
    let firstContentAt = 0;
    const sender = Object.assign(new EventEmitter(), {
      id: nextJobOwner--,
      isDestroyed: () => settled,
      send: (_channel: string, chunk: LLMStreamChunk) => {
        if (settled) return;
        if (chunk.error) { cancel(new Error(chunk.error)); return; }
        if (!firstContentAt && chunk.content) {
          firstContentAt = performance.now();
          log.info('Tutor job stage', { ownerId: sender.id, stage: 'first-content', elapsedMs: Math.round(firstContentAt - queuedAt) });
        }
        text += chunk.content ?? '';
        if (text.length > maxOutputCharacters) { cancel(new Error('Model output exceeded the scenario budget')); return; }
        if (chunk.done) {
          log.info('Tutor job stage', { ownerId: sender.id, stage: 'generation-done', elapsedMs: Math.round(performance.now() - queuedAt), firstContentMs: firstContentAt ? Math.round(firstContentAt - queuedAt) : null, outputCharacters: text.length, outputTokens: chunk.evalCount ?? null });
          finish();
        }
      },
    }) as unknown as Electron.WebContents;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(text);
    };
    const cancel = (error: Error): void => {
      log.info('Tutor job stage', { ownerId: sender.id, stage: 'cancelled-or-failed', elapsedMs: Math.round(performance.now() - queuedAt), errorName: error.name });
      finishRuntimeTrace(traceId, signal.aborted ? 'cancelled' : 'failed', error.message);
      finish(error);
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].sender.id === sender.id) queue.splice(i, 1);
      if (activeOwner === sender.id) {
        cancelActiveStream(sender.id);
      }
    };
    const onAbort = (): void => cancel(new Error('Scenario generation cancelled'));
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    enqueueRequest({ sender, messages, tools: [], expectedRoute: routeKey(loadSettings()), priority, traceId });
    log.info('Tutor job stage', { ownerId: sender.id, stage: 'queued', queueDepth: queue.length, maxOutputCharacters });
    if (activeOwner === null) drainQueue();
  });
}

/**
 * Set up the unified LLM stream router.
 * Call this after setupOllamaIPC() and setupBuiltinLLMIPC().
 */
export function setupLLMRouterIPC(): void {
  // Unified stream — routes to the correct provider, guarded to one active stream
  ipcMain.on(IPC_CHANNELS.LLM_STREAM, async (event: IpcMainEvent, messages: LLMChatMessage[], tools: LLMToolDefinition[], tier?: string, think?: boolean, traceContext?: RuntimeTraceContext) => {
    const sender = event.sender;
    const traceId = runtimeTrace().begin({ kind: 'model', context: traceContext ?? { source: 'foreground' }, input: { messages, tools, tier, think } });

    if (activeOwner === null) {
      activeOwner = sender.id;
      activeSender = sender;
      wrapSenderSend(sender, traceId);
      await dispatchStream(sender, messages, tools, tier, think);
    } else if (activeOwner === sender.id && !activeLifecycle?.terminal && !activeLifecycle?.cancelled) {
      // Same webContents overlapping its own stream is a programming error: reject without
      // touching the provider and without routing through the wrapped send (a done:true chunk
      // through the wrapper would release the active stream).
      const busyChunk: LLMStreamChunk = { error: 'STREAM_BUSY', done: true };
      recordRuntimeChunk(traceId, busyChunk);
      activeOriginalSend!(IPC_CHANNELS.LLM_STREAM_CHUNK, busyChunk);
    } else {
      enqueueRequest({ sender, messages, tools, tier, think, priority: 'foreground', traceId });
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
        finishRuntimeTrace(queue[i].traceId, 'cancelled');
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
