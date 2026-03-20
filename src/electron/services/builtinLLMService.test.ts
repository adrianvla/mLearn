import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIpcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
const mockIpcListeners = new Map<string, ((...args: unknown[]) => void)[]>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      mockIpcHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) || [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
    isPackaged: false,
    on: vi.fn(),
  },
}));

const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
  },
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}));

const mockDownloadFileWithProgress = vi.fn();

vi.mock('../utils/downloadManager', () => ({
  downloadFileWithProgress: mockDownloadFileWithProgress,
}));

let mockPromptImpl: (text: string, opts: { onTextChunk: (t: string) => void; signal: AbortSignal }) => Promise<string>;

const mockSessionPrompt = vi.fn(async (text: string, opts: { onTextChunk?: (t: string) => void; signal?: AbortSignal }) => {
  return mockPromptImpl(text, opts as { onTextChunk: (t: string) => void; signal: AbortSignal });
});
const mockSessionSetChatHistory = vi.fn();
const mockSessionDispose = vi.fn();
const mockContextGetSequence = vi.fn(() => ({}));
const mockContextDispose = vi.fn();
const mockModelCreateContext = vi.fn(async () => ({
  getSequence: mockContextGetSequence,
  dispose: mockContextDispose,
}));
const mockModelDispose = vi.fn();
const mockLoadModel = vi.fn(async () => ({
  createContext: mockModelCreateContext,
  dispose: mockModelDispose,
}));
const mockGetLlama = vi.fn(async () => ({
  loadModel: mockLoadModel,
}));
const mockDefineChatSessionFunction = vi.fn((def: unknown) => def);

class MockLlamaChatSession {
  prompt = mockSessionPrompt;
  setChatHistory = mockSessionSetChatHistory;
  dispose = mockSessionDispose;
  constructor(_opts: unknown) {}
}

vi.mock('node-llama-cpp', () => ({
  getLlama: mockGetLlama,
  LlamaChatSession: MockLlamaChatSession,
  defineChatSessionFunction: mockDefineChatSessionFunction,
}));

function createMockSender(id = 1) {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    id,
  };
}

type SenderMock = ReturnType<typeof createMockSender>;

const OriginalFunction = globalThis.Function;

let mod: typeof import('./builtinLLMService');

beforeEach(async () => {
  vi.resetModules();
  mockIpcHandlers.clear();
  mockIpcListeners.clear();
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);

  mockPromptImpl = async (_text, opts) => {
    opts.onTextChunk('Hello!');
    return 'Hello!';
  };

  globalThis.Function = function (...args: string[]) {
    if (args.length === 1 && args[0] === 'return import("node-llama-cpp")') {
      return () => Promise.resolve({
        getLlama: mockGetLlama,
        LlamaChatSession: MockLlamaChatSession,
        defineChatSessionFunction: mockDefineChatSessionFunction,
      });
    }
    return new OriginalFunction(...args);
  } as unknown as typeof Function;

  mod = await import('./builtinLLMService');
});

import { afterAll } from 'vitest';
afterAll(() => {
  globalThis.Function = OriginalFunction;
});

describe('setupBuiltinLLMIPC', () => {
  it('registers LLM_CHECK_MODEL handler', () => {
    mod.setupBuiltinLLMIPC();
    expect(mockIpcHandlers.has('llm-check-model')).toBe(true);
  });

  it('registers LLM_DOWNLOAD_MODEL listener', () => {
    mod.setupBuiltinLLMIPC();
    expect(mockIpcListeners.has('llm-download-model')).toBe(true);
  });

  it('registers LLM_UNLOAD_MODEL listener', () => {
    mod.setupBuiltinLLMIPC();
    expect(mockIpcListeners.has('llm-unload-model')).toBe(true);
  });
});

describe('LLM_CHECK_MODEL handler', () => {
  beforeEach(() => {
    mod.setupBuiltinLLMIPC();
  });

  it('returns downloaded:true when model file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    const handler = mockIpcHandlers.get('llm-check-model');
    const status = await handler!(null);
    expect((status as { downloaded: boolean }).downloaded).toBe(true);
  });

  it('returns downloaded:false when model file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const handler = mockIpcHandlers.get('llm-check-model');
    const status = await handler!(null);
    expect((status as { downloaded: boolean }).downloaded).toBe(false);
  });

  it('returns downloading:false and loaded:false by default', async () => {
    const handler = mockIpcHandlers.get('llm-check-model');
    const status = await handler!(null) as { downloading: boolean; loaded: boolean };
    expect(status.downloading).toBe(false);
    expect(status.loaded).toBe(false);
  });

  it('returns status for specific modelFile argument', async () => {
    mockExistsSync.mockImplementation((p: string) => p.includes('custom-model.gguf'));
    const handler = mockIpcHandlers.get('llm-check-model');
    const status = await handler!(null, 'custom-model.gguf') as { downloaded: boolean };
    expect(status.downloaded).toBe(true);
  });
});

describe('LLM_DOWNLOAD_MODEL handler', () => {
  beforeEach(() => {
    mod.setupBuiltinLLMIPC();
  });

  it('calls downloadFileWithProgress and sends LLM_MODEL_STATUS on success', async () => {
    mockDownloadFileWithProgress.mockResolvedValue(undefined);
    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('llm-download-model') || [];

    await new Promise<void>(resolve => {
      sender.send.mockImplementation((channel: string) => {
        if (channel === 'llm-model-status') resolve();
      });
      listeners[0](event);
    });

    expect(mockDownloadFileWithProgress).toHaveBeenCalled();
    expect(sender.send).toHaveBeenCalledWith('llm-model-status', expect.any(Object));
  });

  it('calls downloadFileWithProgress with custom url and file', async () => {
    mockDownloadFileWithProgress.mockResolvedValue(undefined);
    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('llm-download-model') || [];

    await new Promise<void>(resolve => {
      sender.send.mockImplementation((channel: string) => {
        if (channel === 'llm-model-status') resolve();
      });
      listeners[0](event, 'https://example.com/model.gguf', 'model.gguf');
    });

    expect(mockDownloadFileWithProgress).toHaveBeenCalledWith(
      'https://example.com/model.gguf',
      expect.stringContaining('model.gguf'),
      expect.any(Function),
    );
  });

  it('calls onProgress callback and sends LLM_DOWNLOAD_PROGRESS', async () => {
    mockDownloadFileWithProgress.mockImplementation(async (_url, _dest, onProgress) => {
      onProgress({ downloadedBytes: 500, expectedBytes: 1000, progress: 0.5 });
    });
    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('llm-download-model') || [];

    await new Promise<void>(resolve => {
      sender.send.mockImplementation((channel: string) => {
        if (channel === 'llm-model-status') resolve();
      });
      listeners[0](event);
    });

    expect(sender.send).toHaveBeenCalledWith('llm-download-progress', expect.any(Object));
  });

  it('sends LLM_MODEL_STATUS with error when download fails', async () => {
    mockDownloadFileWithProgress.mockRejectedValue(new Error('network error'));
    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('llm-download-model') || [];

    await new Promise<void>(resolve => {
      sender.send.mockImplementation((channel: string) => {
        if (channel === 'llm-model-status') resolve();
      });
      listeners[0](event);
    });

    const statusCall = sender.send.mock.calls.find(c => c[0] === 'llm-model-status');
    expect(statusCall).toBeDefined();
    expect(statusCall![1]).toMatchObject({ error: 'network error' });
  });
});

describe('LLM_UNLOAD_MODEL handler', () => {
  beforeEach(() => {
    mod.setupBuiltinLLMIPC();
  });

  it('does not throw when called with nothing loaded', () => {
    const listeners = mockIpcListeners.get('llm-unload-model') || [];
    expect(() => listeners[0]({})).not.toThrow();
  });

  it('sets loaded:false after unloading a loaded model', async () => {
    mockExistsSync.mockReturnValue(true);
    const sender = createMockSender() as unknown as Electron.WebContents;
    await mod.builtinStreamChat(sender, [{ role: 'user', content: 'hi' }], []);

    const checkHandler = mockIpcHandlers.get('llm-check-model');
    const beforeUnload = await checkHandler!(null) as { loaded: boolean };
    expect(beforeUnload.loaded).toBe(true);

    const listeners = mockIpcListeners.get('llm-unload-model') || [];
    listeners[0]({});

    const afterUnload = await checkHandler!(null) as { loaded: boolean };
    expect(afterUnload.loaded).toBe(false);
  });
});

describe('builtinStreamChat', () => {
  it('sends LLM_STREAM_CHUNK with content tokens', async () => {
    mockExistsSync.mockReturnValue(true);
    const sender = createMockSender();
    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [{ role: 'user', content: 'hello' }],
      [],
    );

    const contentCalls = sender.send.mock.calls.filter(
      c => c[0] === 'llm-stream-chunk' && c[1]?.content,
    );
    expect(contentCalls.length).toBeGreaterThan(0);
    expect(contentCalls[0][1].content).toBe('Hello!');
  });

  it('sends done:true chunk after response completes', async () => {
    mockExistsSync.mockReturnValue(true);
    const sender = createMockSender();
    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [{ role: 'user', content: 'hello' }],
      [],
    );

    const doneCall = sender.send.mock.calls.find(c => c[0] === 'llm-stream-chunk' && c[1]?.done === true);
    expect(doneCall).toBeDefined();
  });

  it('throws when model is not downloaded', async () => {
    mockExistsSync.mockReturnValue(false);
    const sender = createMockSender();
    await expect(
      mod.builtinStreamChat(
        sender as unknown as Electron.WebContents,
        [{ role: 'user', content: 'hello' }],
        [],
      )
    ).rejects.toThrow('Model not downloaded');
  });

  it('sends error chunk when prompt throws a non-abort error', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPromptImpl = async () => { throw new Error('llama internal error'); };

    const sender = createMockSender();
    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [{ role: 'user', content: 'hello' }],
      [],
    );

    const errorCall = sender.send.mock.calls.find(c => c[0] === 'llm-stream-chunk' && c[1]?.error);
    expect(errorCall).toBeDefined();
    expect(errorCall![1].error).toBe('llama internal error');
    expect(errorCall![1].done).toBe(true);
  });

  it('sends done:true chunk when prompt is aborted', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPromptImpl = async (_text, opts) => {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      throw err;
    };

    const sender = createMockSender();
    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [{ role: 'user', content: 'hello' }],
      [],
    );

    const doneCall = sender.send.mock.calls.find(c => c[0] === 'llm-stream-chunk' && c[1]?.done === true);
    expect(doneCall).toBeDefined();
    expect(doneCall![1].error).toBeUndefined();
  });

  it('passes system messages as chat history', async () => {
    mockExistsSync.mockReturnValue(true);
    const sender = createMockSender();
    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'hello' },
      ],
      [],
    );

    expect(mockSessionSetChatHistory).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'system', text: 'You are helpful' }),
      ]),
    );
  });

  it('builds history with prior conversation turns', async () => {
    mockExistsSync.mockReturnValue(true);
    const sender = createMockSender();
    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' },
      ],
      [],
    );

    expect(mockSessionSetChatHistory).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: 'user', text: 'first question' }),
        expect.objectContaining({ type: 'model' }),
      ]),
    );
  });

  it('uses fallback content when onTextChunk is never called', async () => {
    mockExistsSync.mockReturnValue(true);
    mockPromptImpl = async () => 'Fallback response';

    const sender = createMockSender();
    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [{ role: 'user', content: 'hello' }],
      [],
    );

    const contentCall = sender.send.mock.calls.find(c => c[0] === 'llm-stream-chunk' && c[1]?.content === 'Fallback response');
    expect(contentCall).toBeDefined();
  });

  it('emits toolCalls chunk for each tool invocation', async () => {
    mockExistsSync.mockReturnValue(true);

    mockPromptImpl = async (_text, opts) => {
      opts.onTextChunk('response');
      return 'response';
    };

    mockDefineChatSessionFunction.mockImplementation((def: unknown) => {
      const typedDef = def as { handler: (params: Record<string, unknown>) => Promise<string> };
      const originalPromptImpl = mockPromptImpl;
      mockPromptImpl = async (text, opts) => {
        await typedDef.handler({ key: 'value' });
        return originalPromptImpl(text, opts);
      };
      return def;
    });

    const sender = createMockSender();
    const tools = [{
      name: 'my_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: { key: { type: 'string' } } },
    }];

    await mod.builtinStreamChat(
      sender as unknown as Electron.WebContents,
      [{ role: 'user', content: 'use tool' }],
      tools,
    );

    const toolCall = sender.send.mock.calls.find(c => c[0] === 'llm-stream-chunk' && c[1]?.toolCalls);
    expect(toolCall).toBeDefined();
    expect(toolCall![1].toolCalls[0].name).toBe('my_tool');
  });

  it('throws when no user message is provided', async () => {
    mockExistsSync.mockReturnValue(true);
    const sender = createMockSender();
    await expect(
      mod.builtinStreamChat(
        sender as unknown as Electron.WebContents,
        [{ role: 'assistant', content: 'I said something' }],
        [],
      )
    ).rejects.toThrow('No user message found');
  });

  it('reuses loaded model on second call', async () => {
    mockExistsSync.mockReturnValue(true);
    const sender = createMockSender();

    await mod.builtinStreamChat(sender as unknown as Electron.WebContents, [{ role: 'user', content: 'first' }], []);
    await mod.builtinStreamChat(sender as unknown as Electron.WebContents, [{ role: 'user', content: 'second' }], []);

    expect(mockGetLlama).toHaveBeenCalledTimes(1);
    expect(mockLoadModel).toHaveBeenCalledTimes(1);
  });
});

describe('builtinAbortStream', () => {
  it('does not throw when no active stream', () => {
    expect(() => mod.builtinAbortStream()).not.toThrow();
  });

  it('aborts the active stream', async () => {
    mockExistsSync.mockReturnValue(true);

    let capturedController: AbortController | null = null;
    mockPromptImpl = async (_text, opts) => {
      capturedController = { abort: vi.fn(), signal: opts.signal } as unknown as AbortController;
      await new Promise(resolve => setTimeout(resolve, 50));
      return '';
    };

    const sender = createMockSender() as unknown as Electron.WebContents;
    const streamPromise = mod.builtinStreamChat(sender, [{ role: 'user', content: 'hi' }], []);
    mod.builtinAbortStream();
    await streamPromise;

    const senderMock = sender as unknown as SenderMock;
    const doneCall = senderMock.send.mock.calls.find(c => c[0] === 'llm-stream-chunk' && c[1]?.done === true);
    expect(doneCall).toBeDefined();
  });
});
