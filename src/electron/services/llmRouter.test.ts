import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIpcListeners = new Map<string, ((...args: unknown[]) => void)[]>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const existing = mockIpcListeners.get(channel) || [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    isPackaged: false,
    on: vi.fn(),
  },
}));

const mockLoadSettings = vi.fn();

vi.mock('./settings', () => ({
  loadSettings: mockLoadSettings,
}));

const mockOllamaStreamChatUnified = vi.fn();
const mockOllamaAbortStream = vi.fn();

vi.mock('./ollamaService', () => ({
  ollamaStreamChatUnified: mockOllamaStreamChatUnified,
  ollamaAbortStream: mockOllamaAbortStream,
}));

const mockBuiltinStreamChat = vi.fn();
const mockBuiltinAbortStream = vi.fn();

vi.mock('./builtinLLMService', () => ({
  builtinStreamChat: mockBuiltinStreamChat,
  builtinAbortStream: mockBuiltinAbortStream,
}));

const mockCloudStreamChat = vi.fn();
const mockCloudAbort = vi.fn();

vi.mock('../../shared/backends/cloudLLMAdapter', () => {
  return {
    CloudLLMAdapter: class {
      streamChat = mockCloudStreamChat;
      abort = mockCloudAbort;
    },
  };
});

let mod: typeof import('./llmRouter');

function createMockSender() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    id: 1,
  };
}

function createMockEvent(sender = createMockSender()) {
  return { sender };
}

beforeEach(async () => {
  vi.resetModules();
  mockIpcListeners.clear();
  vi.clearAllMocks();
  mockLoadSettings.mockReturnValue({
    llmProvider: 'builtin',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
    cloudApiUrl: '',
    overrideCloudEndpointUrl: false,
    cloudAuthAccessToken: '',
    cloudAuthToken: '',
  });
  mod = await import('./llmRouter');
});

describe('setupLLMRouterIPC', () => {
  it('registers LLM_STREAM listener', () => {
    mod.setupLLMRouterIPC();
    expect(mockIpcListeners.has('llm-stream')).toBe(true);
  });

  it('registers LLM_STREAM_ABORT listener', () => {
    mod.setupLLMRouterIPC();
    expect(mockIpcListeners.has('llm-stream-abort')).toBe(true);
  });
});

describe('LLM_STREAM routing to builtin', () => {
  beforeEach(() => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'builtin' });
    mod.setupLLMRouterIPC();
    mockBuiltinStreamChat.mockResolvedValue(undefined);
  });

  it('routes to builtinStreamChat when provider is builtin', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const messages = [{ role: 'user', content: 'hello' }];
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, messages, []);
    expect(mockBuiltinStreamChat).toHaveBeenCalledWith(sender, messages, [], undefined);
  });

  it('routes to builtinStreamChat when provider is undefined (default)', async () => {
    mockLoadSettings.mockReturnValue({ llmProvider: undefined });
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], undefined);
    expect(mockBuiltinStreamChat).toHaveBeenCalledWith(sender, [], [], undefined);
  });

  it('sends error chunk when builtinStreamChat throws', async () => {
    mockBuiltinStreamChat.mockRejectedValue(new Error('llama error'));
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
      error: 'llama error',
      done: true,
    }));
  });
});

describe('LLM_STREAM routing to ollama', () => {
  beforeEach(() => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'ollama' });
    mod.setupLLMRouterIPC();
  });

  it('routes to ollamaStreamChatUnified when provider is ollama', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const messages = [{ role: 'user', content: 'hello' }];
    const tools = [{ name: 'my_tool', description: 'desc', parameters: {} }];
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, messages, tools);
    expect(mockOllamaStreamChatUnified).toHaveBeenCalledWith(sender, messages, tools);
  });

  it('passes empty tools array when tools is null', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], null);
    expect(mockOllamaStreamChatUnified).toHaveBeenCalledWith(sender, [], []);
  });
});

describe('LLM_STREAM routing to cloud', () => {
  beforeEach(() => {
    mockLoadSettings.mockReturnValue({
      llmProvider: 'cloud',
      overrideCloudEndpointUrl: false,
      cloudApiUrl: '',
      cloudAuthAccessToken: 'token123',
      cloudAuthToken: '',
    });
    mockCloudStreamChat.mockResolvedValue(undefined);
    mod.setupLLMRouterIPC();
  });

  it('routes to CloudLLMAdapter.streamChat when provider is cloud', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const messages = [{ role: 'user', content: 'hello' }];
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, messages, []);
    expect(mockCloudStreamChat).toHaveBeenCalledWith(
      messages,
      [],
      expect.objectContaining({ onChunk: expect.any(Function), onDone: expect.any(Function), onError: expect.any(Function) }),
      undefined,
    );
  });

  it('onChunk sends LLM_STREAM_CHUNK to sender', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    let capturedOnChunk: ((chunk: unknown) => void) | undefined;
    mockCloudStreamChat.mockImplementation((_msgs: unknown, _tools: unknown, callbacks: { onChunk: (chunk: unknown) => void }) => {
      capturedOnChunk = callbacks.onChunk;
      return Promise.resolve();
    });
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    capturedOnChunk?.({ content: 'test', done: false });
    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', { content: 'test', done: false });
  });

  it('onError sends error chunk to sender', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    let capturedOnError: ((error: string) => void) | undefined;
    mockCloudStreamChat.mockImplementation((_msgs: unknown, _tools: unknown, callbacks: { onError: (error: string) => void }) => {
      capturedOnError = callbacks.onError;
      return Promise.resolve();
    });
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    capturedOnError?.('network error');
    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
      error: 'network error',
      done: true,
    }));
  });

  it('uses cloudAuthToken as fallback when accessToken is empty', async () => {
    mockLoadSettings.mockReturnValue({
      llmProvider: 'cloud',
      overrideCloudEndpointUrl: false,
      cloudApiUrl: '',
      cloudAuthAccessToken: '',
      cloudAuthToken: 'fallback-token',
    });
    mod.setupLLMRouterIPC();
    mockCloudStreamChat.mockResolvedValue(undefined);
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    expect(mockCloudStreamChat).toHaveBeenCalled();
  });

  it('sends error chunk when cloud streamChat throws', async () => {
    mockCloudStreamChat.mockRejectedValue(new Error('cloud error'));
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
      error: 'cloud error',
      done: true,
    }));
  });
});

describe('LLM_STREAM_ABORT routing', () => {
  it('calls builtinAbortStream when provider is builtin', () => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'builtin' });
    mod.setupLLMRouterIPC();
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const listeners = mockIpcListeners.get('llm-stream-abort') || [];
    listeners[0](event);
    expect(mockBuiltinAbortStream).toHaveBeenCalled();
  });

  it('calls ollamaAbortStream when provider is ollama', () => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'ollama' });
    mod.setupLLMRouterIPC();
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const listeners = mockIpcListeners.get('llm-stream-abort') || [];
    listeners[0](event);
    expect(mockOllamaAbortStream).toHaveBeenCalledWith(sender.id);
  });

  it('calls cloudAdapter.abort when provider is cloud', async () => {
    mockLoadSettings.mockReturnValue({
      llmProvider: 'cloud',
      overrideCloudEndpointUrl: false,
      cloudApiUrl: '',
      cloudAuthAccessToken: 'tok',
      cloudAuthToken: '',
    });
    mockCloudStreamChat.mockResolvedValue(undefined);
    mod.setupLLMRouterIPC();

    const sender = createMockSender();
    const event = createMockEvent(sender);

    const streamListeners = mockIpcListeners.get('llm-stream') || [];
    streamListeners[0](event, [], []);

    const abortListeners = mockIpcListeners.get('llm-stream-abort') || [];
    abortListeners[0](event);

    expect(mockCloudAbort).toHaveBeenCalled();
  });

  it('does nothing for cloud abort if no stream was started', () => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'cloud' });
    mod.setupLLMRouterIPC();
    const event = createMockEvent();
    const listeners = mockIpcListeners.get('llm-stream-abort') || [];
    expect(() => listeners[0](event)).not.toThrow();
  });

  it('defaults to builtin abort when provider is undefined', () => {
    mockLoadSettings.mockReturnValue({ llmProvider: undefined });
    mod.setupLLMRouterIPC();
    const event = createMockEvent();
    const listeners = mockIpcListeners.get('llm-stream-abort') || [];
    listeners[0](event);
    expect(mockBuiltinAbortStream).toHaveBeenCalled();
  });
});
