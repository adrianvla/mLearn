/**
 * Built-in LLM Service using node-llama-cpp
 * Runs GGUF models locally in the Electron main process with function calling support.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IPC_CHANNELS } from '../../shared/constants';
import { downloadFileWithProgress } from '../utils/downloadManager';
import { BUILTIN_MODELS, getModelUrl } from '../../shared/builtinModels';
import type { LLMStreamChunk, LLMModelStatus, LLMChatMessage, LLMToolDefinition, LLMToolCall } from '../../shared/types';

const MODEL_DIR_NAME = 'models';
const IDLE_UNLOAD_MS = 10 * 60 * 1000; // 10 minutes

// Dynamic imports for node-llama-cpp (ESM module in CJS context)
let llamaCppModule: typeof import('node-llama-cpp') | null = null;

// State — use `any` for node-llama-cpp instance types since their constructors are private
let llamaInstance: any = null;
let loadedModel: any = null;
let modelContext: any = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let currentAbortController: AbortController | null = null;
let isDownloading = false;
let downloadProgress = 0;
let downloadedBytes = 0;
let expectedBytes = 0;

function getModelsDir(): string {
  return path.join(app.getPath('userData'), MODEL_DIR_NAME);
}

function getModelPath(modelFile?: string): string {
  const file = modelFile ?? BUILTIN_MODELS[BUILTIN_MODELS.length - 1].modelFile;
  return path.join(getModelsDir(), file);
}

function isModelDownloaded(modelFile?: string): boolean {
  return fs.existsSync(getModelPath(modelFile));
}

async function importLlamaCpp(): Promise<typeof import('node-llama-cpp')> {
  if (!llamaCppModule) {
    // node-llama-cpp is ESM, use dynamic import
    // CJS→ESM interop: `await import()` is transpiled to require() by TypeScript's
    // commonjs module setting, which breaks ESM-only packages. `new Function()` avoids
    // the transpilation so the native dynamic import is preserved at runtime.
    llamaCppModule = await (new Function('return import("node-llama-cpp")')() as Promise<typeof import('node-llama-cpp')>);
  }
  return llamaCppModule;
}

function getModelStatus(modelFile?: string): LLMModelStatus {
  return {
    downloaded: isModelDownloaded(modelFile),
    downloading: isDownloading,
    progress: downloadProgress,
    downloadedBytes,
    expectedBytes,
    loaded: loadedModel !== null,
  };
}

/**
 * Download a model file from HuggingFace with progress reporting
 */
async function downloadModel(
  modelUrl: string,
  modelFile: string,
  sender: Electron.WebContents
): Promise<void> {
  if (isDownloading) {
    throw new Error('Download already in progress');
  }

  isDownloading = true;
  downloadProgress = 0;
  downloadedBytes = 0;
  expectedBytes = 0;

  try {
    await downloadFileWithProgress(
      modelUrl,
      getModelPath(modelFile),
      (progress) => {
        downloadedBytes = progress.downloadedBytes;
        expectedBytes = progress.expectedBytes;
        downloadProgress = progress.progress;
        sender.send(IPC_CHANNELS.LLM_DOWNLOAD_PROGRESS, getModelStatus(modelFile));
      }
    );
    isDownloading = false;
    downloadProgress = 1;
    sender.send(IPC_CHANNELS.LLM_DOWNLOAD_PROGRESS, getModelStatus(modelFile));
  } catch (err) {
    console.error(err);
    isDownloading = false;
    throw err;
  }
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    unloadModel();
  }, IDLE_UNLOAD_MS);
}

async function ensureModelLoaded(modelFile?: string): Promise<void> {
  if (loadedModel && modelContext) {
    resetIdleTimer();
    return;
  }

  const modelPath = getModelPath(modelFile);
  if (!fs.existsSync(modelPath)) {
    throw new Error('Model not downloaded');
  }

  const llamaCpp = await importLlamaCpp();

  if (!llamaInstance) {
    llamaInstance = await llamaCpp.getLlama();
  }

  loadedModel = await llamaInstance.loadModel({ modelPath });
  modelContext = await loadedModel.createContext();

  resetIdleTimer();
}

function unloadModel(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (modelContext) {
    modelContext.dispose();
    modelContext = null;
  }
  if (loadedModel) {
    loadedModel.dispose();
    loadedModel = null;
  }
}

/**
 * Convert unified LLM types to node-llama-cpp format and stream a chat response
 */
async function streamChat(
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  sender: Electron.WebContents,
  modelFile?: string
): Promise<void> {
  await ensureModelLoaded(modelFile);

  const llamaCpp = await importLlamaCpp();

  if (!modelContext) {
    throw new Error('Model not loaded');
  }

  // Create a fresh chat session for each request so the full conversation
  // history (sent by the renderer) is reconstructed properly.
  const session = new llamaCpp.LlamaChatSession({
    contextSequence: modelContext.getSequence(),
  });

  currentAbortController = new AbortController();
  const startTime = Date.now();
  let firstTokenTime = 0;
  let tokenCount = 0;

  // Separate system messages from conversation messages
  const systemMessages = messages.filter(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  // The last message should be the user prompt
  const lastUserMsg = conversationMessages[conversationMessages.length - 1];
  if (!lastUserMsg || lastUserMsg.role !== 'user') {
    session.dispose?.();
    throw new Error('No user message found');
  }

  // Build the chat history for node-llama-cpp from all messages except the last user message
  const chatHistoryItems: { type: string; text?: string; response?: string[] }[] = [];
  if (systemMessages.length > 0) {
    chatHistoryItems.push({
      type: 'system',
      text: systemMessages.map(m => m.content).join('\n'),
    });
  }
  for (const msg of conversationMessages.slice(0, -1)) {
    if (msg.role === 'user') {
      chatHistoryItems.push({ type: 'user', text: msg.content });
    } else if (msg.role === 'assistant') {
      chatHistoryItems.push({ type: 'model', response: [msg.content] });
    }
    // Tool messages are handled implicitly by node-llama-cpp's function calling
  }

  if (chatHistoryItems.length > 0) {
    session.setChatHistory(chatHistoryItems as Parameters<typeof session.setChatHistory>[0]);
  }

  // Build function definitions for node-llama-cpp tool calling
  const functions: Record<string, ReturnType<typeof llamaCpp.defineChatSessionFunction>> = {};

  // Collected tool calls
  const collectedToolCalls: LLMToolCall[] = [];
  let toolCallIdCounter = 0;

  for (const tool of tools) {
    functions[tool.name] = llamaCpp.defineChatSessionFunction({
      description: tool.description,
      params: tool.parameters as Parameters<typeof llamaCpp.defineChatSessionFunction>[0]['params'],
      handler: async (params) => {
        const toolCall: LLMToolCall = {
          id: `call_${Date.now()}_${toolCallIdCounter++}`,
          name: tool.name,
          arguments: (params ?? {}) as Record<string, unknown>,
        };
        collectedToolCalls.push(toolCall);

        // Emit the tool call immediately
        const chunk: LLMStreamChunk = {
          toolCalls: [toolCall],
        };
        sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk);

        // Return a simple acknowledgment — the tool is "executed" on the renderer side
        return 'Tool executed successfully';
      },
    });
  }

  try {
    // Build prompt options
    const promptOptions: Parameters<typeof session.prompt>[1] = {
      signal: currentAbortController.signal,
      functions: Object.keys(functions).length > 0 ? functions : undefined,
      onTextChunk: (text: string) => {
        if (!firstTokenTime) firstTokenTime = Date.now();
        tokenCount++;

        const chunk: LLMStreamChunk = {
          content: text,
        };
        sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk);
      },
      maxTokens: 2048,
      temperature: 0.3,
    };

    const response = await session.prompt(lastUserMsg.content, promptOptions);

    if (tokenCount === 0 && response) {
      // node-llama-cpp may suppress onTextChunk for think-tag content;
      // forward the full response so the renderer can process it
      const fallbackChunk: LLMStreamChunk = { content: response };
      sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, fallbackChunk);
    }

    const totalTime = Date.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : 0;

    // Emit final done chunk (tool calls already emitted individually — don't re-include)
    const doneChunk: LLMStreamChunk = {
      content: '',
      done: true,
      evalCount: tokenCount,
      totalDuration: totalTime * 1_000_000, // convert to nanoseconds
      promptEvalDuration: ttft * 1_000_000,
    };
    sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, doneChunk);
  } catch (err) {
    console.error(err);
    if ((err as Error).name === 'AbortError' || currentAbortController?.signal.aborted) {
      const abortChunk: LLMStreamChunk = { done: true, content: '' };
      sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, abortChunk);
    } else {
      const errorChunk: LLMStreamChunk = {
        error: (err as Error).message || 'Unknown error',
        done: true,
      };
      sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, errorChunk);
    }
  } finally {
    currentAbortController = null;
    resetIdleTimer();
    session.dispose?.();
  }
}

/**
 * Set up IPC handlers for the built-in LLM service
 */
export function setupBuiltinLLMIPC(): void {
  // Check model status
  ipcMain.handle(IPC_CHANNELS.LLM_CHECK_MODEL, (_event, modelFile?: string) => {
    return getModelStatus(modelFile);
  });

  // Download model
  ipcMain.on(IPC_CHANNELS.LLM_DOWNLOAD_MODEL, async (event, modelUrl?: string, modelFile?: string) => {
    const fallbackModel = BUILTIN_MODELS[BUILTIN_MODELS.length - 1];
    const resolvedModelFile = modelFile ?? fallbackModel.modelFile;
    const resolvedModelUrl = modelUrl ?? getModelUrl(fallbackModel);
    try {
      await downloadModel(
        resolvedModelUrl,
        resolvedModelFile,
        event.sender
      );
      event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, getModelStatus(resolvedModelFile));
    } catch (err) {
      console.error(err);
      const status: LLMModelStatus = {
        ...getModelStatus(resolvedModelFile),
        error: (err as Error).message,
      };
      event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, status);
    }
  });

  // Unload model
  ipcMain.on(IPC_CHANNELS.LLM_UNLOAD_MODEL, () => {
    unloadModel();
  });

  // Get system memory info for autoselect
  ipcMain.handle(IPC_CHANNELS.LLM_GET_SYSTEM_MEMORY, async () => {
    const gpuInfo = await app.getGPUInfo('basic') as { gpuDevice?: Array<{ dedicatedVideoMemory?: number }> } | null;
    const dedicatedVram = gpuInfo?.gpuDevice?.[0]?.dedicatedVideoMemory ?? 0;
    return {
      hasDiscreteGpu: dedicatedVram > 0,
      dedicatedVramBytes: dedicatedVram,
      totalRamBytes: os.totalmem(),
    };
  });

  // List downloaded models with file sizes
  ipcMain.handle(IPC_CHANNELS.LLM_LIST_DOWNLOADED_MODELS, () => {
    return BUILTIN_MODELS
      .filter((m) => isModelDownloaded(m.modelFile))
      .map((m) => {
        const filePath = getModelPath(m.modelFile);
        const stat = fs.statSync(filePath);
        return { modelFile: m.modelFile, sizeBytes: stat.size };
      });
  });

  // Delete a model file (whitelist-validated)
  ipcMain.handle(IPC_CHANNELS.LLM_DELETE_MODEL, (_event, modelFile: string) => {
    const isWhitelisted = BUILTIN_MODELS.some((m) => m.modelFile === modelFile);
    if (!isWhitelisted) {
      throw new Error(`Model file not in registry: ${modelFile}`);
    }
    const filePath = getModelPath(modelFile);
    if (loadedModel !== null && fs.existsSync(filePath)) {
      unloadModel();
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

/**
 * Stream chat via built-in model (called by unified LLM router)
 */
export async function builtinStreamChat(
  sender: Electron.WebContents,
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  modelFile?: string,
): Promise<void> {
  await streamChat(messages, tools, sender, modelFile);
}

/**
 * Abort an active built-in LLM stream (called by unified LLM router)
 */
export function builtinAbortStream(): void {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}
