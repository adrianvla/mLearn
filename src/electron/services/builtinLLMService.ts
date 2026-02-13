/**
 * Built-in LLM Service using node-llama-cpp
 * Runs GGUF models locally in the Electron main process with function calling support.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { IPC_CHANNELS } from '../../shared/constants';
import type { LLMStreamChunk, LLMModelStatus, LLMChatMessage, LLMToolDefinition, LLMToolCall } from '../../shared/types';

// Default model configuration
const DEFAULT_MODEL_REPO = 'Qwen/Qwen3-4B-GGUF';
const DEFAULT_MODEL_FILE = 'qwen3-4b-q4_k_m.gguf';
const DEFAULT_MODEL_URL = `https://huggingface.co/${DEFAULT_MODEL_REPO}/resolve/main/${DEFAULT_MODEL_FILE}`;
const MODEL_DIR_NAME = 'models';
const IDLE_UNLOAD_MS = 10 * 60 * 1000; // 10 minutes

// Dynamic imports for node-llama-cpp (ESM module in CJS context)
let llamaCppModule: typeof import('node-llama-cpp') | null = null;

// State — use `any` for node-llama-cpp instance types since their constructors are private
let llamaInstance: any = null;
let loadedModel: any = null;
let modelContext: any = null;
let chatSession: any = null;
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
  return path.join(getModelsDir(), modelFile || DEFAULT_MODEL_FILE);
}

function isModelDownloaded(modelFile?: string): boolean {
  return fs.existsSync(getModelPath(modelFile));
}

async function importLlamaCpp(): Promise<typeof import('node-llama-cpp')> {
  if (!llamaCppModule) {
    // node-llama-cpp is ESM, use dynamic import
    llamaCppModule = await (Function('return import("node-llama-cpp")')() as Promise<typeof import('node-llama-cpp')>);
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
function downloadModel(
  modelUrl: string,
  modelFile: string,
  sender: Electron.WebContents
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isDownloading) {
      reject(new Error('Download already in progress'));
      return;
    }

    const modelsDir = getModelsDir();
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const destPath = getModelPath(modelFile);
    const tempPath = destPath + '.downloading';

    isDownloading = true;
    downloadProgress = 0;
    downloadedBytes = 0;
    expectedBytes = 0;

    const emitProgress = () => {
      const status = getModelStatus(modelFile);
      sender.send(IPC_CHANNELS.LLM_DOWNLOAD_PROGRESS, status);
    };

    const doRequest = (url: string, redirectCount: number = 0) => {
      if (redirectCount > 5) {
        isDownloading = false;
        reject(new Error('Too many redirects'));
        return;
      }

      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.get(url, (res) => {
        // Handle redirects (HuggingFace uses them)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          isDownloading = false;
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        expectedBytes = parseInt(res.headers['content-length'] || '0', 10);
        emitProgress();

        const fileStream = fs.createWriteStream(tempPath);
        let lastEmit = 0;

        res.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (expectedBytes > 0) {
            downloadProgress = downloadedBytes / expectedBytes;
          }
          // Throttle progress updates to ~500ms
          const now = Date.now();
          if (now - lastEmit > 500) {
            lastEmit = now;
            emitProgress();
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            fs.renameSync(tempPath, destPath);
            isDownloading = false;
            downloadProgress = 1;
            emitProgress();
            resolve();
          });
        });

        fileStream.on('error', (err) => {
          fs.unlinkSync(tempPath);
          isDownloading = false;
          reject(err);
        });
      });

      req.on('error', (err) => {
        isDownloading = false;
        reject(err);
      });
    };

    doRequest(modelUrl);
  });
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
  // Create a fresh chat session each time model is loaded
  chatSession = new llamaCpp.LlamaChatSession({
    contextSequence: modelContext.getSequence(),
  });

  resetIdleTimer();
}

function unloadModel(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (chatSession) {
    chatSession = null;
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

  if (!chatSession || !modelContext) {
    throw new Error('Model not loaded');
  }

  currentAbortController = new AbortController();
  const startTime = Date.now();
  let firstTokenTime = 0;
  let tokenCount = 0;

  // Build the user prompt from messages
  // The chat session manages system messages internally,
  // so we extract the last user message as the prompt
  const systemMessages = messages.filter(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system');
  const lastUserMsg = userMessages[userMessages.length - 1];

  if (!lastUserMsg) {
    throw new Error('No user message found');
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
    // Set system prompt if provided
    if (systemMessages.length > 0) {
      chatSession.setChatHistory([
        { type: 'system', text: systemMessages.map(m => m.content).join('\n') },
      ]);
    }

    // Build prompt options
    const promptOptions: Parameters<typeof chatSession.prompt>[1] = {
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
      maxTokens: 512,
      temperature: 0.3,
    };

    const response = await chatSession.prompt(lastUserMsg.content, promptOptions);
    void response; // The response text is already emitted via onTextChunk

    const totalTime = Date.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : 0;

    // Emit final done chunk
    const doneChunk: LLMStreamChunk = {
      content: '',
      done: true,
      toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
      evalCount: tokenCount,
      totalDuration: totalTime * 1_000_000, // convert to nanoseconds
      promptEvalDuration: ttft * 1_000_000,
    };
    sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, doneChunk);
  } catch (err) {
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
    try {
      await downloadModel(
        modelUrl || DEFAULT_MODEL_URL,
        modelFile || DEFAULT_MODEL_FILE,
        event.sender
      );
      event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, getModelStatus(modelFile));
    } catch (err) {
      const status: LLMModelStatus = {
        ...getModelStatus(modelFile),
        error: (err as Error).message,
      };
      event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, status);
    }
  });

  // Unload model
  ipcMain.on(IPC_CHANNELS.LLM_UNLOAD_MODEL, () => {
    unloadModel();
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
