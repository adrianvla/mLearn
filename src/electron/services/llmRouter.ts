/**
 * Unified LLM Router
 * Routes LLM_STREAM and LLM_STREAM_ABORT to the correct provider (builtin or ollama).
 */

import { ipcMain, type IpcMainEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk } from '../../shared/types';
import { loadSettings } from './settings';
import { ollamaStreamChatUnified, ollamaAbortStream } from './ollamaService';
import { builtinStreamChat, builtinAbortStream } from './builtinLLMService';
import { CloudLLMAdapter } from '../../shared/backends/cloudLLMAdapter';

let cloudAdapter: CloudLLMAdapter | null = null;

function getCloudAdapter(): CloudLLMAdapter {
  const settings = loadSettings();
  // Recreate if settings changed
  cloudAdapter = new CloudLLMAdapter(
    settings.cloudLLMUrl,
    settings.cloudAuthAccessToken || settings.cloudLLMToken || settings.cloudAuthToken,
  );
  return cloudAdapter;
}

/**
 * Set up the unified LLM stream router.
 * Call this after setupOllamaIPC() and setupBuiltinLLMIPC().
 */
export function setupLLMRouterIPC(): void {
  // Unified stream — routes to the correct provider
  ipcMain.on(IPC_CHANNELS.LLM_STREAM, async (event: IpcMainEvent, messages: LLMChatMessage[], tools: LLMToolDefinition[]) => {
    const settings = loadSettings();
    const provider = settings.llmProvider || 'builtin';

    try {
      if (provider === 'cloud') {
        const adapter = getCloudAdapter();
        await adapter.streamChat(messages, tools || [], {
          onChunk: (chunk) => event.sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk),
          onDone: () => {},
          onError: (error) => {
            const errorChunk: LLMStreamChunk = { error, done: true };
            event.sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, errorChunk);
          },
        });
      } else if (provider === 'ollama') {
        ollamaStreamChatUnified(event.sender, messages, tools || []);
      } else {
        await builtinStreamChat(event.sender, messages, tools || []);
      }
    } catch (err) {
      console.error('[LLMRouter] Stream error:', (err as Error).message);
      const errorChunk: LLMStreamChunk = {
        error: (err as Error).message || 'Failed to start LLM stream',
        done: true,
      };
      event.sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, errorChunk);
    }
  });

  // Unified abort — routes to correct provider
  ipcMain.on(IPC_CHANNELS.LLM_STREAM_ABORT, (event: IpcMainEvent) => {
    const settings = loadSettings();
    const provider = settings.llmProvider || 'builtin';

    if (provider === 'cloud') {
      cloudAdapter?.abort();
    } else if (provider === 'ollama') {
      ollamaAbortStream(event.sender.id);
    } else {
      builtinAbortStream();
    }
  });
}
