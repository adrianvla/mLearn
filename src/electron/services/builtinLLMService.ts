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
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.builtinLLMService');

const MODEL_DIR_NAME = 'models';
const IDLE_UNLOAD_MS = 10 * 60 * 1000; // 10 minutes
// The model's advertised maximum can exceed 200k tokens and reserves an
// impractical KV cache on a 16 GB unified-memory machine. Chat requests need
// a bounded interactive window; the session can shift older history as needed.
const INTERACTIVE_CONTEXT_TOKENS = 8192;

// Dynamic imports for node-llama-cpp (ESM module in CJS context)
let llamaCppModule: typeof import('node-llama-cpp') | null = null;

// State — use `any` for node-llama-cpp instance types since their constructors are private
let llamaInstance: any = null;
let llamaInstancePromise: Promise<any> | null = null;
let llamaRuntimeError: string | undefined;
let loadedModel: any = null;
let modelContext: any = null;
let loadedModelPath: string | null = null;
let lifecycleTail: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let currentAbortController: AbortController | null = null;
let isDownloading = false;
let downloadProgress = 0;
let downloadedBytes = 0;
let expectedBytes = 0;
let rawControlModelPath: string | null = null;

function tokenUsage(sequence: any, before?: { usedInputTokens: number; usedOutputTokens: number }): { inputTokens: number | null; outputTokens: number | null } {
  const meter = sequence?.tokenMeter;
  if (!meter?.getState) return { inputTokens: null, outputTokens: null };
  const after = meter.getState();
  return {
    inputTokens: after.usedInputTokens - (before?.usedInputTokens ?? 0),
    outputTokens: after.usedOutputTokens - (before?.usedOutputTokens ?? 0),
  };
}

async function releaseChatSession(session: any, sequence: any, context: any): Promise<void> {
  try {
    await session.dispose?.({ disposeSequence: false });
  } finally {
    await sequence.dispose?.();
    // node-llama-cpp's sequence dispose starts asynchronous ID reclamation.
    // A subsequent getSequence() can otherwise throw "No sequences left".
    const deadline = Date.now() + 10_000;
    while (context.sequencesLeft === 0) {
      if (Date.now() >= deadline) throw new Error('Model context sequence was not reclaimed');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function runRawControl(): Promise<void> {
  if (!modelContext || !loadedModel) return;
  const llamaCpp = await importLlamaCpp();
  for (const pass of ['cold', 'warm'] as const) {
    const sequence = modelContext.getSequence();
    const before = sequence.tokenMeter?.getState?.();
    const session = new llamaCpp.LlamaChatSession({ contextSequence: sequence, autoDisposeSequence: false });
    const startedAt = performance.now();
    let firstTokenAt = 0;
    let outputTokens = 0;
    try {
      await session.prompt('Count from 1 to 20, separated by spaces.', {
        maxTokens: 64,
        onToken: (tokens) => {
          if (!firstTokenAt) firstTokenAt = performance.now();
          outputTokens += tokens.length;
        },
      });
      const elapsedMs = performance.now() - startedAt;
      const measured = tokenUsage(sequence, before);
      log.info('Tutor raw control', { pass, modelFile: path.basename(loadedModelPath ?? ''), contextSize: modelContext.contextSize, inputTokens: measured.inputTokens, outputTokens: measured.outputTokens ?? outputTokens, firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : null, totalMs: Math.round(elapsedMs), generationTokensPerSecond: firstTokenAt && elapsedMs > firstTokenAt - startedAt ? Number(((measured.outputTokens ?? outputTokens) / ((elapsedMs - (firstTokenAt - startedAt)) / 1000)).toFixed(2)) : null, processRssBytes: process.memoryUsage().rss });
    } finally {
      await releaseChatSession(session, sequence, modelContext);
    }
  }
}

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
  const downloaded = isModelDownloaded(modelFile);
  const runtimeAvailable = llamaInstance !== null;
  const loaded = loadedModel !== null && modelContext !== null && loadedModelPath === getModelPath(modelFile);
  return {
    downloaded,
    runtimeAvailable,
    ready: downloaded && runtimeAvailable && loaded,
    runtimeError: downloaded && !loaded ? llamaRuntimeError : undefined,
    downloading: isDownloading,
    progress: downloadProgress,
    downloadedBytes,
    expectedBytes,
    loaded,
  };
}

/** Resolve the built-in runtime once so readiness checks and chat use the same binary. */
async function ensureLlamaRuntime(): Promise<any> {
  if (llamaInstance) return llamaInstance;

  const runtimePromise = llamaInstancePromise ??= importLlamaCpp().then((llamaCpp) => llamaCpp.getLlama());
  try {
    llamaInstance = await runtimePromise;
    llamaRuntimeError = undefined;
    return llamaInstance;
  } catch (err) {
    llamaRuntimeError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    if (llamaInstancePromise === runtimePromise) llamaInstancePromise = null;
  }
}

export async function checkBuiltinModelStatus(modelFile?: string): Promise<LLMModelStatus> {
  if (isModelDownloaded(modelFile)) {
    try {
      await withModelLifecycle(async () => {
        await ensureModelLoaded(modelFile, new AbortController().signal);
        if (process.env.MLEARN_TUTOR_RAW_CONTROL === '1' && rawControlModelPath !== loadedModelPath) {
          rawControlModelPath = loadedModelPath;
          await runRawControl();
        }
        resetIdleTimer();
      });
    } catch (error) {
      log.error('Tutor readiness or raw-control check failed', error as Error);
      // The status carries the startup failure for this selected model.
    }
  }
  return getModelStatus(modelFile);
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
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.LLM_DOWNLOAD_PROGRESS, getModelStatus(modelFile));
      }
    );
    isDownloading = false;
    downloadProgress = 1;
    if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.LLM_DOWNLOAD_PROGRESS, getModelStatus(modelFile));
  } catch (err) {
    log.error('Model download failed', err as Error);
    isDownloading = false;
    throw err;
  }
}

// Serialize native resource use with unload/delete so active sequences cannot be freed.
function withModelLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycleTail ? lifecycleTail.then(operation) : operation();
  const settled = result.then(() => undefined, () => undefined);
  lifecycleTail = settled;
  void settled.then(() => {
    if (lifecycleTail === settled) lifecycleTail = null;
  });
  return result;
}

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function resetIdleTimer(): void {
  clearIdleTimer();
  if (!loadedModel) return;
  idleTimer = setTimeout(() => {
    void withModelLifecycle(unloadModel).catch((error) => log.error('Idle model unload failed', error));
  }, IDLE_UNLOAD_MS);
}

async function ensureModelLoaded(modelFile: string | undefined, signal: AbortSignal): Promise<void> {
  const modelPath = getModelPath(modelFile);
  const startedAt = performance.now();
  signal.throwIfAborted();
  if (loadedModel && modelContext && loadedModelPath === modelPath) {
    log.info('Tutor model readiness', { stage: 'already-loaded', modelFile: path.basename(modelPath), contextSize: modelContext.contextSize, processRssBytes: process.memoryUsage().rss });
    return;
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error('Model not downloaded');
  }
  await unloadModel();
  const runtime = await ensureLlamaRuntime();
  signal.throwIfAborted();
  try {
    loadedModel = await runtime.loadModel({ modelPath, loadSignal: signal });
    log.info('Tutor model readiness', { stage: 'model-loaded', modelFile: path.basename(modelPath), elapsedMs: Math.round(performance.now() - startedAt), modelFileBytes: fs.statSync(modelPath).size, processRssBytes: process.memoryUsage().rss });
    loadedModelPath = modelPath;
    signal.throwIfAborted();
    modelContext = await loadedModel.createContext({ contextSize: INTERACTIVE_CONTEXT_TOKENS });
    log.info('Tutor model readiness', { stage: 'context-ready', modelFile: path.basename(modelPath), elapsedMs: Math.round(performance.now() - startedAt), contextSize: modelContext.contextSize, processRssBytes: process.memoryUsage().rss });
    signal.throwIfAborted();
    llamaRuntimeError = undefined;
  } catch (error) {
    llamaRuntimeError = error instanceof Error ? error.message : String(error);
    try { await unloadModel(); } catch (cleanupError) { log.error('Model startup cleanup failed', cleanupError as Error); }
    throw error;
  }
}

async function unloadModel(): Promise<void> {
  clearIdleTimer();
  let failure: unknown;
  if (modelContext) {
    try { await modelContext.dispose(); modelContext = null; }
    catch (error) { failure = error; }
  }
  if (loadedModel) {
    try { await loadedModel.dispose(); loadedModel = null; }
    catch (error) { failure ??= error; }
  }
  if (!modelContext && !loadedModel) loadedModelPath = null;
  if (failure) throw failure;
}

async function streamChat(
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  sender: Electron.WebContents,
  modelFile?: string,
): Promise<void> {
  clearIdleTimer();
  const controller = new AbortController();
  currentAbortController = controller;
  try {
    await ensureModelLoaded(modelFile, controller.signal);
    controller.signal.throwIfAborted();
    await streamLoadedChat(messages, tools, sender, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, { done: true, content: '' });
    } else {
      throw error;
    }
  } finally {
    currentAbortController = null;
    resetIdleTimer();
  }
}

/**
 * Convert unified LLM types to node-llama-cpp format and stream a chat response
 */
async function streamLoadedChat(
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
  sender: Electron.WebContents,
  signal: AbortSignal,
): Promise<void> {

  const llamaCpp = await importLlamaCpp();

  if (!modelContext) {
    throw new Error('Model not loaded');
  }

  // Create a fresh chat session for each request so the full conversation
  // history (sent by the renderer) is reconstructed properly.
  const session = new llamaCpp.LlamaChatSession({
    contextSequence: modelContext.getSequence(),
    // Each request owns one context sequence. Releasing it is required before
    // the next queued request can allocate another sequence from this context.
    autoDisposeSequence: false,
  });

  const startTime = Date.now();
  let firstTokenTime = 0;
  let tokenCount = 0;
  let segmentedTokens = 0;
  let thoughtTokens = 0;
  const sequence = session.sequence;
  const tokenMeterBefore = sequence?.tokenMeter?.getState?.();

  // Separate system messages from conversation messages
  const systemMessages = messages.filter(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  // The last message should be the user prompt
  const lastUserMsg = conversationMessages[conversationMessages.length - 1];
  if (!lastUserMsg || lastUserMsg.role !== 'user') {
    await releaseChatSession(session, sequence, modelContext);
    throw new Error('No user message found');
  }

  try {
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

    // Build prompt options
    const promptOptions: Parameters<typeof session.prompt>[1] = {
      signal,
      functions: Object.keys(functions).length > 0 ? functions : undefined,
      onResponseChunk: (chunk) => {
        if (signal.aborted || chunk.tokens.length === 0) return;
        const previousCount = segmentedTokens;
        segmentedTokens += chunk.tokens.length;
        if (chunk.type === 'segment' && chunk.segmentType === 'thought') thoughtTokens += chunk.tokens.length;
        if (Math.floor(previousCount / 64) !== Math.floor(segmentedTokens / 64)) {
          log.info('Tutor model generation', { stage: 'segmented-progress', totalTokens: segmentedTokens, thoughtTokens, visibleTokens: tokenCount, elapsedMs: Date.now() - startTime, processRssBytes: process.memoryUsage().rss });
        }
      },
      onToken: (tokens) => {
        if (signal.aborted) return;
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
          log.info('Tutor model generation', { stage: 'first-token', firstTokenMs: firstTokenTime - startTime, inputTokens: tokenUsage(sequence, tokenMeterBefore).inputTokens, contextSize: modelContext?.contextSize, processRssBytes: process.memoryUsage().rss });
        }
        const previousCount = tokenCount;
        tokenCount += tokens.length;
        if (Math.floor(previousCount / 64) !== Math.floor(tokenCount / 64)) {
          log.info('Tutor model generation', { stage: 'progress', outputTokens: tokenCount, elapsedMs: Date.now() - startTime, processRssBytes: process.memoryUsage().rss });
        }
      },
      onTextChunk: (text: string) => {
        if (signal.aborted) return;
        if (!firstTokenTime) firstTokenTime = Date.now();

        const chunk: LLMStreamChunk = {
          content: text,
        };
        sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk);
      },
      maxTokens: 2048,
      budgets: { thoughtTokens: 128 },
      temperature: 0.3,
    };

    const response = await session.prompt(lastUserMsg.content, promptOptions);
    signal.throwIfAborted();

    if (tokenCount === 0 && response) {
      // node-llama-cpp may suppress onTextChunk for think-tag content;
      // forward the full response so the renderer can process it
      const fallbackChunk: LLMStreamChunk = { content: response };
      sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, fallbackChunk);
    }

    const totalTime = Date.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : 0;
    const usage = tokenUsage(sequence, tokenMeterBefore);
    log.info('Tutor model generation', { stage: 'complete', modelFile: path.basename(loadedModelPath ?? ''), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens ?? tokenCount, segmentedTokens, thoughtTokens, maxTokens: promptOptions.maxTokens, contextSize: modelContext.contextSize, firstTokenMs: ttft || null, totalMs: totalTime, promptTokensPerSecond: usage.inputTokens && ttft ? Number((usage.inputTokens / (ttft / 1000)).toFixed(2)) : null, generationTokensPerSecond: firstTokenTime && totalTime > ttft ? Number(((usage.outputTokens ?? tokenCount) / ((totalTime - ttft) / 1000)).toFixed(2)) : null, processRssBytes: process.memoryUsage().rss });

    // Emit final done chunk (tool calls already emitted individually — don't re-include)
    const doneChunk: LLMStreamChunk = {
      content: '',
      done: true,
      evalCount: usage.outputTokens ?? tokenCount,
      totalDuration: totalTime * 1_000_000, // convert to nanoseconds
      promptEvalDuration: ttft * 1_000_000,
    };
    sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, doneChunk);
  } catch (err) {
    log.error('LLM stream error', err as Error);
    if ((err as Error).name === 'AbortError' || signal.aborted) {
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
    await releaseChatSession(session, sequence, modelContext);
  }
}

/**
 * Set up IPC handlers for the built-in LLM service
 */
export function setupBuiltinLLMIPC(): void {
  // Check model status
  ipcMain.handle(IPC_CHANNELS.LLM_CHECK_MODEL, (_event, modelFile?: string) => {
    return checkBuiltinModelStatus(modelFile);
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
      const status = await checkBuiltinModelStatus(resolvedModelFile);
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, status);
    } catch (err) {
      log.error('Model download IPC handler failed', err as Error);
      const status: LLMModelStatus = {
        ...getModelStatus(resolvedModelFile),
        error: (err as Error).message,
      };
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.LLM_MODEL_STATUS, status);
    }
  });

  // Unload model
  ipcMain.on(IPC_CHANNELS.LLM_UNLOAD_MODEL, () => {
    return withModelLifecycle(unloadModel).catch((error) => log.error('Model unload failed', error));
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
    return withModelLifecycle(async () => {
      const filePath = getModelPath(modelFile);
      if (loadedModelPath === filePath) await unloadModel();
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
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
  await withModelLifecycle(() => streamChat(messages, tools, sender, modelFile));
}

/**
 * Abort an active built-in LLM stream (called by unified LLM router)
 */
export function builtinAbortStream(): void {
  if (currentAbortController) {
    currentAbortController.abort();
  }
}
