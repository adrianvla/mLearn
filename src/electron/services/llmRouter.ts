/**
 * Unified LLM Router
 * Routes LLM_STREAM and LLM_STREAM_ABORT to the correct provider (builtin, ollama, or cloud).
 *
 * Stream guard: exactly ONE active stream app-wide at any time. A second LLM_STREAM from the
 * same webContents is rejected with a STREAM_BUSY error chunk (programming error); requests
 * from other webContents are queued FIFO and started when the owner's stream completes.
 * Only the owning webContents may abort its stream.
 */

import { ipcMain, type IpcMainEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk } from '../../shared/types';
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
}

let activeOwner: number | null = null;
let activeSender: Electron.WebContents | null = null;
let activeOriginalSend: ((channel: string, ...args: unknown[]) => void) | null = null;
let activeDestroyedListener: (() => void) | null = null;
const queue: QueuedStreamRequest[] = [];

// Providers differ in completion signalling (ollama is fire-and-forget, cloud/builtin awaited),
// so the owner's `send` is wrapped for the stream duration: the terminal chunk (done: true,
// including error chunks) is the uniform completion signal.
function wrapSenderSend(sender: Electron.WebContents): void {
  const originalSend = sender.send.bind(sender);
  activeOriginalSend = originalSend;
  sender.send = (channel: string, ...args: unknown[]) => {
    originalSend(channel, ...args);
    if (channel === IPC_CHANNELS.LLM_STREAM_CHUNK) {
      const chunk = args[0] as LLMStreamChunk | undefined;
      if (chunk?.done) {
        releaseStream();
      }
    }
  };
  activeDestroyedListener = () => releaseStream();
  sender.once('destroyed', activeDestroyedListener);
}

function releaseStream(): void {
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
    void dispatchStream(next.sender, next.messages, next.tools, next.tier, next.think);
    return;
  }
}

function getCloudAdapter(): CloudLLMAdapter {
  const settings = loadSettings();
  const cloudApiUrl = (settings.overrideCloudEndpointUrl && settings.cloudApiUrl)
    ? settings.cloudApiUrl.replace(/\/+$/, '')
    : DEFAULT_CLOUD_API_URL;
  // Recreate if settings changed
  cloudAdapter = new CloudLLMAdapter(
    cloudApiUrl,
    settings.cloudAuthAccessToken || settings.cloudAuthToken,
  );
  return cloudAdapter;
}

/** Route a stream to the provider configured in settings (existing routing logic). */
async function dispatchStream(
  sender: Electron.WebContents,
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  tier?: string,
  think?: boolean,
): Promise<void> {
  const settings = loadSettings();
  const provider = settings.llmProvider || DEFAULT_SETTINGS.llmProvider;

  try {
    if (provider === 'cloud') {
      const adapter = getCloudAdapter();
      await adapter.streamChat(messages, tools || [], {
        onChunk: (chunk) => sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk),
        onDone: () => {},
        onError: (error) => {
          const errorChunk: LLMStreamChunk = { error, done: true };
          sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, errorChunk);
        },
      }, tier === 'fast' || tier === 'cheap' ? tier : undefined, think);
    } else if (provider === 'ollama') {
      ollamaStreamChatUnified(sender, messages, tools || []);
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
  }
}

/** Route an abort to the provider configured in settings (existing routing logic). */
function abortProvider(senderId: number): void {
  const settings = loadSettings();
  const provider = settings.llmProvider || DEFAULT_SETTINGS.llmProvider;

  if (provider === 'cloud') {
    cloudAdapter?.abort();
  } else if (provider === 'ollama') {
    ollamaAbortStream(senderId);
  } else {
    builtinAbortStream();
  }
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
    } else if (activeOwner === sender.id) {
      // Same webContents overlapping its own stream is a programming error: reject without
      // touching the provider and without routing through the wrapped send (a done:true chunk
      // through the wrapper would release the active stream).
      const busyChunk: LLMStreamChunk = { error: 'STREAM_BUSY', done: true };
      activeOriginalSend!(IPC_CHANNELS.LLM_STREAM_CHUNK, busyChunk);
    } else {
      queue.push({ sender, messages, tools, tier, think });
    }
  });

  // Unified abort — only the owning webContents may abort the active stream
  ipcMain.on(IPC_CHANNELS.LLM_STREAM_ABORT, (event: IpcMainEvent) => {
    const sender = event.sender;

    if (activeOwner === sender.id) {
      abortProvider(sender.id);
      releaseStream();
    } else if (queue.some((req) => req.sender.id === sender.id)) {
      // Non-owner with queued request: silently cancel it (it was never dispatched).
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].sender.id === sender.id) {
          queue.splice(i, 1);
        }
      }
    } else {
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
  queue.length = 0;
}
