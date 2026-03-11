/**
 * Ollama Service
 * Handles communication with a local Ollama instance for LLM chat
 */

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { OllamaModel, OllamaChatMessage, OllamaToolDefinition, LLMStreamChunk, LLMChatMessage, LLMToolDefinition } from '../../shared/types';
import { loadSettings } from './settings';
import http from 'http';
import https from 'https';

/**
 * Parse Ollama URL into components for http/https request
 */
function parseUrl(urlStr: string): { hostname: string; port: number; protocol: string; path: string } {
  const url = new URL(urlStr);
  return {
    hostname: url.hostname,
    port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
    protocol: url.protocol,
    path: url.pathname + url.search,
  };
}

/** Fetch a URL returning raw text, following redirects */
function fetchUrlRaw(urlStr: string, timeoutMs: number, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const { hostname, port, protocol, path } = parseUrl(urlStr);
    const lib = protocol === 'https:' ? https : http;

    const options: http.RequestOptions = {
      hostname,
      port,
      path,
      method: 'GET',
      headers: { 'User-Agent': 'mLearn/2.0', Accept: '*/*' },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return; }
        fetchUrlRaw(new URL(res.headers.location, urlStr).toString(), timeoutMs, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

/**
 * Make an HTTP(S) request returning parsed JSON
 */
function jsonRequest(
  urlStr: string,
  method: string,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { hostname, port, protocol, path } = parseUrl(urlStr);
    const lib = protocol === 'https:' ? https : http;

    const options: http.RequestOptions = {
      hostname,
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/** Active stream request, keyed by webContents id, so it can be aborted */
const activeStreamRequests = new Map<number, http.ClientRequest>();

/**
 * Stream an Ollama chat completion, sending chunks back to the renderer
 */
function streamChat(
  sender: Electron.WebContents,
  messages: OllamaChatMessage[],
  tools?: OllamaToolDefinition[],
): void {
  const settings = loadSettings();
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';
  const model = settings.ollamaModel || 'llama3.2';
  const url = `${baseUrl}/api/chat`;

  const { hostname, port, protocol, path } = parseUrl(url);
  const lib = protocol === 'https:' ? https : http;

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const options: http.RequestOptions = {
    hostname,
    port,
    path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };

  const req = lib.request(options, (res) => {
    let buffer = '';
    let doneSent = false;

    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();

      // Ollama streams newline-delimited JSON
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const chunk: Record<string, unknown> = {};

          if (parsed.message?.content) {
            chunk.content = parsed.message.content;
          }
          if (parsed.message?.tool_calls) {
            chunk.tool_calls = parsed.message.tool_calls;
          }
          if (parsed.done) {
            chunk.done = true;
            doneSent = true;
            // Forward Ollama performance stats
            if (parsed.eval_count != null) chunk.eval_count = parsed.eval_count;
            if (parsed.eval_duration != null) chunk.eval_duration = parsed.eval_duration;
            if (parsed.prompt_eval_duration != null) chunk.prompt_eval_duration = parsed.prompt_eval_duration;
            if (parsed.total_duration != null) chunk.total_duration = parsed.total_duration;
          }

          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM, chunk);
          }
        } catch {
          // Skip malformed lines
        }
      }
    });

    res.on('end', () => {
      activeStreamRequests.delete(sender.id);
      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM, {
              content: parsed.message?.content || '',
              done: true,
              tool_calls: parsed.message?.tool_calls,
            });
          }
        } catch {
          if (!doneSent && !sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM, { done: true });
          }
        }
      } else if (!doneSent && !sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM, { done: true });
      }
    });

    res.on('error', (err) => {
      activeStreamRequests.delete(sender.id);
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM, {
          content: `\n[Error: ${err.message}]`,
          done: true,
        });
      }
    });
  });

  req.on('error', (err) => {
    activeStreamRequests.delete(sender.id);
    if (!sender.isDestroyed()) {
      sender.send(IPC_CHANNELS.OLLAMA_CHAT_STREAM, {
        content: `\n[Connection error: ${err.message}]`,
        done: true,
      });
    }
  });

  // Track this request so it can be aborted; destroy any prior request first
  const existing = activeStreamRequests.get(sender.id);
  if (existing && !existing.destroyed) existing.destroy();
  activeStreamRequests.set(sender.id, req);

  req.write(JSON.stringify(body));
  req.end();
}

/**
 * Abort an active stream request for a given sender
 */
function abortStream(senderId: number): void {
  const req = activeStreamRequests.get(senderId);
  if (req) {
    req.destroy();
    activeStreamRequests.delete(senderId);
  }
}

/**
 * Non-streaming chat completion (for tool calls that need full response)
 */
async function chatCompletion(
  messages: OllamaChatMessage[],
  tools?: OllamaToolDefinition[],
): Promise<{ content: string; tool_calls?: unknown[] }> {
  const settings = loadSettings();
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';
  const model = settings.ollamaModel || 'llama3.2';

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const result = (await jsonRequest(`${baseUrl}/api/chat`, 'POST', body, 60_000)) as {
    message?: { content?: string; tool_calls?: unknown[] };
  };

  return {
    content: result.message?.content || '',
    tool_calls: result.message?.tool_calls,
  };
}

/**
 * List available models on the Ollama instance
 */
async function listModels(): Promise<OllamaModel[]> {
  const settings = loadSettings();
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';

  const result = (await jsonRequest(`${baseUrl}/api/tags`, 'GET')) as {
    models?: OllamaModel[];
  };

  return result.models || [];
}

/**
 * Check if Ollama is reachable
 */
async function checkConnection(): Promise<boolean> {
  const settings = loadSettings();
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';

  try {
    await jsonRequest(`${baseUrl}/api/tags`, 'GET', undefined, 5_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull (download) a model from the Ollama registry with progress streaming
 */
function pullModel(sender: Electron.WebContents, modelName: string): void {
  const settings = loadSettings();
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';
  const url = `${baseUrl}/api/pull`;

  const { hostname, port, protocol, path } = parseUrl(url);
  const lib = protocol === 'https:' ? https : http;

  const body = { name: modelName, stream: true };

  const options: http.RequestOptions = {
    hostname,
    port,
    path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };

  const req = lib.request(options, (res) => {
    let buffer = '';

    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.OLLAMA_PULL_MODEL_PROGRESS, parsed);
          }
        } catch { /* skip */ }
      }
    });

    res.on('end', () => {
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.OLLAMA_PULL_MODEL_PROGRESS, parsed);
          }
        } catch { /* skip */ }
      }
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.OLLAMA_PULL_MODEL_PROGRESS, { status: 'success' });
      }
    });

    res.on('error', (err) => {
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.OLLAMA_PULL_MODEL_PROGRESS, { status: 'error', error: err.message });
      }
    });
  });

  req.on('error', (err) => {
    if (!sender.isDestroyed()) {
      sender.send(IPC_CHANNELS.OLLAMA_PULL_MODEL_PROGRESS, { status: 'error', error: err.message });
    }
  });

  req.write(JSON.stringify(body));
  req.end();
}

/**
 * Convert unified LLM messages to Ollama format
 */
function toOllamaMessages(messages: LLMChatMessage[]): OllamaChatMessage[] {
  return messages.map(m => ({
    role: m.role,
    content: m.content,
    tool_calls: m.toolCalls?.map(tc => ({
      function: { name: tc.name, arguments: tc.arguments },
    })),
    tool_name: m.toolName,
  }));
}

/**
 * Convert unified tool definitions to Ollama format
 */
function toOllamaTools(tools: LLMToolDefinition[]): OllamaToolDefinition[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Stream an Ollama chat in unified LLM format, sending LLMStreamChunks
 */
function streamChatUnified(
  sender: Electron.WebContents,
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
): void {
  const settings = loadSettings();
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';
  const model = settings.ollamaModel || 'llama3.2';
  const url = `${baseUrl}/api/chat`;

  const { hostname, port, protocol, path } = parseUrl(url);
  const lib = protocol === 'https:' ? https : http;

  const ollamaMessages = toOllamaMessages(messages);
  const ollamaTools = tools.length > 0 ? toOllamaTools(tools) : undefined;

  const body: Record<string, unknown> = {
    model,
    messages: ollamaMessages,
    stream: true,
    // Disable extended thinking for Qwen3 and similar models —
    // thinking content goes into a separate `message.thinking` field
    // that our streaming doesn't accumulate, causing empty responses.
    think: false,
  };
  if (ollamaTools) {
    body.tools = ollamaTools;
  }

  const options: http.RequestOptions = {
    hostname,
    port,
    path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };

  const req = lib.request(options, (res) => {
    let buffer = '';
    let doneSent = false;
    // Track thinking state for models that still use thinking mode
    // (fallback if `think: false` is not supported by the Ollama version)
    let inThinking = false;

    res.on('data', (rawChunk: Buffer) => {
      buffer += rawChunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);

          const chunk: LLMStreamChunk = {};

          // Build content from both regular and thinking fields
          const regularContent = parsed.message?.content || '';
          const thinkingContent = parsed.message?.thinking || '';
          let chunkContent = '';

          if (thinkingContent) {
            if (!inThinking) {
              chunkContent += '<think>';
              inThinking = true;
            }
            chunkContent += thinkingContent;
          }
          if (regularContent) {
            if (inThinking) {
              chunkContent += '</think>';
              inThinking = false;
            }
            chunkContent += regularContent;
          }

          if (chunkContent) {
            chunk.content = chunkContent;
          }

          if (parsed.message?.tool_calls) {
            chunk.toolCalls = parsed.message.tool_calls.map(
              (tc: { function: { name: string; arguments: Record<string, unknown> } }, i: number) => ({
                id: `call_${Date.now()}_${i}`,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })
            );
          }
          if (parsed.done) {
            // Close any unclosed thinking block before finalizing
            if (inThinking) {
              chunk.content = (chunk.content || '') + '</think>';
              inThinking = false;
            }
            chunk.done = true;
            doneSent = true;
            if (parsed.eval_count != null) chunk.evalCount = parsed.eval_count;
            if (parsed.eval_duration != null) chunk.evalDuration = parsed.eval_duration;
            if (parsed.prompt_eval_duration != null) chunk.promptEvalDuration = parsed.prompt_eval_duration;
            if (parsed.total_duration != null) chunk.totalDuration = parsed.total_duration;
          }

          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk);
          }
        } catch { /* skip */ }
      }
    });

    res.on('end', () => {
      activeStreamRequests.delete(sender.id);
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          const regularContent = parsed.message?.content || '';
          const thinkingContent = parsed.message?.thinking || '';
          let finalContent = '';
          if (thinkingContent) {
            finalContent += inThinking ? thinkingContent : `<think>${thinkingContent}`;
            inThinking = true;
          }
          if (regularContent) {
            if (inThinking) finalContent += '</think>';
            finalContent += regularContent;
            inThinking = false;
          }
          if (inThinking) {
            finalContent += '</think>';
          }

          const chunk: LLMStreamChunk = {
            content: finalContent,
            done: true,
          };
          if (parsed.message?.tool_calls) {
            chunk.toolCalls = parsed.message.tool_calls.map(
              (tc: { function: { name: string; arguments: Record<string, unknown> } }, i: number) => ({
                id: `call_${Date.now()}_${i}`,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })
            );
          }
          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, chunk);
          }
        } catch {
          if (!doneSent && !sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, { done: true } as LLMStreamChunk);
          }
        }
      } else if (!doneSent && !sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, { done: true } as LLMStreamChunk);
      }
    });

    res.on('error', (err) => {
      activeStreamRequests.delete(sender.id);
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, {
          error: err.message,
          done: true,
        } as LLMStreamChunk);
      }
    });
  });

  req.on('error', (err) => {
    activeStreamRequests.delete(sender.id);
    if (!sender.isDestroyed()) {
      sender.send(IPC_CHANNELS.LLM_STREAM_CHUNK, {
        error: err.message,
        done: true,
      } as LLMStreamChunk);
    }
  });

  // Track this request so it can be aborted; destroy any prior request first
  const existing = activeStreamRequests.get(sender.id);
  if (existing && !existing.destroyed) existing.destroy();
  activeStreamRequests.set(sender.id, req);
  req.write(JSON.stringify(body));
  req.end();
}

/**
 * Register IPC handlers for Ollama
 */
export function setupOllamaIPC(): void {
  // Non-streaming chat
  ipcMain.on(IPC_CHANNELS.OLLAMA_CHAT, async (event: IpcMainEvent, messages: OllamaChatMessage[], tools?: OllamaToolDefinition[]) => {
    try {
      const result = await chatCompletion(messages, tools);
      event.reply(IPC_CHANNELS.OLLAMA_CHAT, result);
    } catch (err) {
      event.reply(IPC_CHANNELS.OLLAMA_CHAT, {
        content: `[Error: ${(err as Error).message}]`,
      });
    }
  });

  // Streaming chat
  ipcMain.on(IPC_CHANNELS.OLLAMA_CHAT_STREAM, (_event: IpcMainEvent, messages: OllamaChatMessage[], tools?: OllamaToolDefinition[]) => {
    streamChat(_event.sender, messages, tools);
  });

  // Abort streaming chat
  ipcMain.on(IPC_CHANNELS.OLLAMA_CHAT_STREAM_ABORT, (_event: IpcMainEvent) => {
    abortStream(_event.sender.id);
  });

  // List models (return name strings only)
  ipcMain.handle(IPC_CHANNELS.OLLAMA_LIST_MODELS, async () => {
    try {
      const models = await listModels();
      return models.map(m => m.name);
    } catch {
      return [];
    }
  });

  // Check connection
  ipcMain.handle(IPC_CHANNELS.OLLAMA_CHECK, async () => {
    return checkConnection();
  });

  // URL fetch (for conversation agent web lookups)
  ipcMain.handle(IPC_CHANNELS.FETCH_URL, async (_event: IpcMainInvokeEvent, url: string) => {
    try {
      const content = await fetchUrlRaw(url, 15_000);
      return { content };
    } catch (err) {
      return { content: '', error: (err as Error).message };
    }
  });

  // Pull model
  ipcMain.on(IPC_CHANNELS.OLLAMA_PULL_MODEL, (event: IpcMainEvent, modelName: string) => {
    pullModel(event.sender, modelName);
  });
}

/**
 * Stream chat in unified LLM format via Ollama (called by the unified LLM router)
 */
export function ollamaStreamChatUnified(
  sender: Electron.WebContents,
  messages: LLMChatMessage[],
  tools: LLMToolDefinition[],
): void {
  streamChatUnified(sender, messages, tools);
}

/**
 * Abort an active Ollama stream (called by the unified LLM router)
 */
export function ollamaAbortStream(senderId: number): void {
  abortStream(senderId);
}
