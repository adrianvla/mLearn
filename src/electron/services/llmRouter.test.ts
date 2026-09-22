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
const mockCloudConstructor = vi.fn();

vi.mock('../../shared/backends/cloudLLMAdapter', () => {
  return {
    CloudLLMAdapter: class {
      constructor(...args: unknown[]) { mockCloudConstructor(...args); }
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
    once: vi.fn(),
    removeListener: vi.fn(),
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
  mockBuiltinStreamChat.mockReset();
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
  it('collects bounded main-job output and releases the provider for the next job', async () => {
    mockBuiltinStreamChat.mockImplementation(async (sender) => {
      sender.send('llm-stream-chunk', { content: 'hello' });
      sender.send('llm-stream-chunk', { content: ' world', done: true });
    });
    await expect(mod.completeJob([{ role: 'user', content: 'First' }], new AbortController().signal)).resolves.toBe('hello world');
    await expect(mod.completeJob([{ role: 'user', content: 'Bounded' }], new AbortController().signal, 4)).rejects.toThrow(/budget/);
    expect(mockBuiltinAbortStream).toHaveBeenCalledOnce();
    await expect(mod.completeJob([{ role: 'user', content: 'Next' }], new AbortController().signal)).resolves.toBe('hello world');
  });

  it('does not send a queued local job to cloud after provider settings change', async () => {
    mod.setupLLMRouterIPC();
    const owner = createMockSender();
    await mockIpcListeners.get('llm-stream')![0](createMockEvent(owner), [{ role: 'user', content: 'Foreground' }], []);
    const result = mod.completeJob([{ role: 'user', content: 'Private local setup' }], new AbortController().signal);
    const rejected = expect(result).rejects.toThrow(/settings changed/);
    mockLoadSettings.mockReturnValue({ llmProvider: 'cloud' });
    owner.send('llm-stream-chunk', { done: true });
    await rejected;
    expect(mockCloudStreamChat).not.toHaveBeenCalled();
  });
  it('does not dispatch queued maintenance after Living World consent is revoked', async () => {
    const settings = { ...mockLoadSettings(), livingWorldEnabled: true };
    mockLoadSettings.mockReturnValue(settings);
    mod.setupLLMRouterIPC();
    const owner = createMockSender();
    await mockIpcListeners.get('llm-stream')![0](createMockEvent(owner), [{ role: 'user', content: 'Foreground' }], []);
    const controller = new AbortController();
    const result = mod.completeJob([{ role: 'user', content: 'Private reflection' }], controller.signal).catch(error => error);
    settings.livingWorldEnabled = false;
    owner.send('llm-stream-chunk', { done: true });
    controller.abort();
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
    expect((await result).message).toMatch(/settings changed/);
  });

  it('queues a main-owned job behind conversation and cancels it without aborting the foreground owner', async () => {
    mod.setupLLMRouterIPC();
    const owner = createMockSender();
    await mockIpcListeners.get('llm-stream')![0](createMockEvent(owner), [{ role: 'user', content: 'Foreground' }], []);
    const controller = new AbortController();
    const result = mod.completeJob([{ role: 'user', content: 'Scenario' }], controller.signal);
    const rejected = expect(result).rejects.toThrow(/cancel/i);
    controller.abort();
    await rejected;
    expect(mockBuiltinAbortStream).not.toHaveBeenCalled();
    owner.send('llm-stream-chunk', { done: true });
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
  });
  it('dispatches newly queued foreground inference before older background work', async () => {
    mod.setupLLMRouterIPC();
    const owner = createMockSender();
    await mockIpcListeners.get('llm-stream')![0](createMockEvent(owner), [{ role: 'user', content: 'Active turn' }], []);

    const background = mod.completeJob(
      [{ role: 'user', content: 'Autonomy' }],
      new AbortController().signal,
      100,
      'background',
    );
    const foreground = mod.completeJob(
      [{ role: 'user', content: 'Next user turn' }],
      new AbortController().signal,
    );

    owner.send('llm-stream-chunk', { done: true });
    expect(mockBuiltinStreamChat.mock.calls[1]?.[1]).toEqual([{ role: 'user', content: 'Next user turn' }]);
    const foregroundSender = mockBuiltinStreamChat.mock.calls[1]?.[0];
    foregroundSender.send('llm-stream-chunk', { content: 'foreground', done: true });
    await expect(foreground).resolves.toBe('foreground');
    expect(mockBuiltinStreamChat.mock.calls[2]?.[1]).toEqual([{ role: 'user', content: 'Autonomy' }]);
    const backgroundSender = mockBuiltinStreamChat.mock.calls[2]?.[0];
    backgroundSender.send('llm-stream-chunk', { content: 'background', done: true });

    await expect(foreground).resolves.toBe('foreground');
    await expect(background).resolves.toBe('background');
  });
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
    const sendSpy = sender.send;
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    expect(sendSpy).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
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
      undefined,
      'foreground',
    );
  });

  it('selects managed transport only for the configured school endpoint', async () => {
    for (const managed of [false, true]) {
      mockLoadSettings.mockReturnValue({ ...mockLoadSettings(), overrideCloudEndpointUrl: managed, cloudApiUrl: 'https://school.test' });
      mockCloudStreamChat.mockImplementationOnce(async (_messages, _tools, callbacks) => callbacks.onDone());
      await mod.cloudComplete([{ role: 'user', content: 'hi' }]);
      expect(mockCloudConstructor.mock.calls.at(-1)?.[2]).toBe(managed);
      expect(mockCloudStreamChat.mock.calls.at(-1)?.[5]).toBe('internal');
    }
  });

  it('onChunk sends LLM_STREAM_CHUNK to sender', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const sendSpy = sender.send;
    let capturedOnChunk: ((chunk: unknown) => void) | undefined;
    mockCloudStreamChat.mockImplementation((_msgs: unknown, _tools: unknown, callbacks: { onChunk: (chunk: unknown) => void }) => {
      capturedOnChunk = callbacks.onChunk;
      return Promise.resolve();
    });
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    capturedOnChunk?.({ content: 'test', done: false });
    expect(sendSpy).toHaveBeenCalledWith('llm-stream-chunk', { content: 'test', done: false });
  });

  it('onError sends error chunk to sender', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const sendSpy = sender.send;
    let capturedOnError: ((error: string) => void) | undefined;
    mockCloudStreamChat.mockImplementation((_msgs: unknown, _tools: unknown, callbacks: { onError: (error: string) => void }) => {
      capturedOnError = callbacks.onError;
      return Promise.resolve();
    });
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    capturedOnError?.('network error');
    expect(sendSpy).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
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
    const sendSpy = sender.send;
    const listeners = mockIpcListeners.get('llm-stream') || [];
    await listeners[0](event, [], []);
    expect(sendSpy).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
      error: 'cloud error',
      done: true,
    }));
  });
});

describe('LLM_STREAM_ABORT routing', () => {
  it('calls builtinAbortStream when provider is builtin', async () => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'builtin' });
    mod.setupLLMRouterIPC();
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const streamListeners = mockIpcListeners.get('llm-stream') || [];
    streamListeners[0](event, [], []);
    const listeners = mockIpcListeners.get('llm-stream-abort') || [];
    listeners[0](event);
    expect(mockBuiltinAbortStream).toHaveBeenCalled();
  });

  it('calls ollamaAbortStream when provider is ollama', async () => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'ollama' });
    mod.setupLLMRouterIPC();
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const streamListeners = mockIpcListeners.get('llm-stream') || [];
    streamListeners[0](event, [], []);
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

  it('defaults to builtin abort when provider is undefined', async () => {
    mockLoadSettings.mockReturnValue({ llmProvider: undefined });
    mod.setupLLMRouterIPC();
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const streamListeners = mockIpcListeners.get('llm-stream') || [];
    streamListeners[0](event, [], []);
    const listeners = mockIpcListeners.get('llm-stream-abort') || [];
    listeners[0](event);
    expect(mockBuiltinAbortStream).toHaveBeenCalled();
  });
});

describe('LLM_STREAM guard: one active stream app-wide', () => {
  beforeEach(() => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'builtin' });
    mod.setupLLMRouterIPC();
    mockBuiltinStreamChat.mockResolvedValue(undefined);
  });

  function streamListeners() {
    return mockIpcListeners.get('llm-stream') || [];
  }

  it('rejects a second LLM_STREAM from the same webContents with STREAM_BUSY and does not dispatch again', async () => {
    const sender = createMockSender();
    const event = createMockEvent(sender);
    const sendSpy = sender.send;
    const listeners = streamListeners();

    await listeners[0](event, [{ role: 'user', content: 'hello' }], []);
    await listeners[0](event, [{ role: 'user', content: 'again' }], []);

    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
      error: 'STREAM_BUSY',
      done: true,
    }));
  });

  it('queues a stream from a different webContents and starts it after the owner completes', async () => {
    const owner = createMockSender();
    owner.id = 1;
    const other = createMockSender();
    other.id = 2;
    const listeners = streamListeners();

    await listeners[0](createMockEvent(owner), [{ role: 'user', content: 'first' }], []);
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);

    // Second webContents request while the first stream is still active: queued, not dispatched.
    await listeners[0](createMockEvent(other), [{ role: 'user', content: 'second' }], []);
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
    expect(other.send).not.toHaveBeenCalled();

    // Owner stream completes with a done:true chunk through its wrapped send.
    owner.send('llm-stream-chunk', { done: true });
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(2);
    expect(mockBuiltinStreamChat).toHaveBeenLastCalledWith(other, [{ role: 'user', content: 'second' }], [], undefined);
  });
});

describe('LLM_STREAM_ABORT guard: only the owner may abort', () => {
  beforeEach(() => {
    mockLoadSettings.mockReturnValue({ llmProvider: 'builtin' });
    mod.setupLLMRouterIPC();
    mockBuiltinStreamChat.mockResolvedValue(undefined);
  });

  function streamListeners() {
    return mockIpcListeners.get('llm-stream') || [];
  }

  function abortListeners() {
    return mockIpcListeners.get('llm-stream-abort') || [];
  }

  it('rejects abort from a non-owner and does not invoke the provider abort', async () => {
    const owner = createMockSender();
    owner.id = 1;
    const other = createMockSender();
    other.id = 2;
    await streamListeners()[0](createMockEvent(owner), [], []);

    abortListeners()[0](createMockEvent(other));
    expect(mockBuiltinAbortStream).not.toHaveBeenCalled();

    abortListeners()[0](createMockEvent(owner));
    expect(mockBuiltinAbortStream).toHaveBeenCalledTimes(1);
  });

  it('abort from the owner releases the stream and starts the next queued request', async () => {
    const owner = createMockSender();
    owner.id = 1;
    const other = createMockSender();
    other.id = 2;
    await streamListeners()[0](createMockEvent(owner), [], []);
    await streamListeners()[0](createMockEvent(other), [{ role: 'user', content: 'queued' }], []);
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);

    abortListeners()[0](createMockEvent(owner));
    expect(mockBuiltinAbortStream).toHaveBeenCalledTimes(1);
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(2);
    expect(mockBuiltinStreamChat).toHaveBeenLastCalledWith(other, [{ role: 'user', content: 'queued' }], [], undefined);
  });

  it('removes a queued request on abort from its webContents and never dispatches it', async () => {
    const owner = createMockSender();
    owner.id = 1;
    const other = createMockSender();
    other.id = 2;
    await streamListeners()[0](createMockEvent(owner), [], []);
    await streamListeners()[0](createMockEvent(other), [{ role: 'user', content: 'cancel me' }], []);

    abortListeners()[0](createMockEvent(other));
    owner.send('llm-stream-chunk', { done: true });

    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
    expect(other.send).not.toHaveBeenCalled();
  });
});

describe('provider cleanup ownership', () => {
  it.each(['builtin', 'cloud', 'ollama'])('keeps %s ownership after a terminal chunk until provider cleanup settles', async (provider) => {
    mockLoadSettings.mockReturnValue({ llmProvider: provider });
    mod.setupLLMRouterIPC();
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
    const stream = provider === 'builtin' ? mockBuiltinStreamChat : provider === 'cloud' ? mockCloudStreamChat : mockOllamaStreamChatUnified;
    stream.mockReturnValue(cleanup);
    const owner = createMockSender();
    const next = { ...createMockSender(), id: 2 };
    const start = mockIpcListeners.get('llm-stream')![0];
    const active = start(createMockEvent(owner), [], []);
    await start(createMockEvent(next), [], []);
    owner.send('llm-stream-chunk', { done: true });
    expect(stream).toHaveBeenCalledTimes(1);
    finishCleanup();
    await active;
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('queues the same window’s next turn after terminal delivery while cleanup is pending', async () => {
    mod.setupLLMRouterIPC();
    let finishCleanup!: () => void;
    mockBuiltinStreamChat.mockReturnValue(new Promise<void>(resolve => { finishCleanup = resolve; }));
    const owner = createMockSender();
    const delivered = owner.send;
    const start = mockIpcListeners.get('llm-stream')![0];
    const active = start(createMockEvent(owner), [], []);
    owner.send('llm-stream-chunk', { done: true });
    await start(createMockEvent(owner), [{ role: 'user', content: 'next turn' }], []);
    expect(delivered).not.toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({ error: 'STREAM_BUSY' }));
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
    finishCleanup();
    await active;
    expect(mockBuiltinStreamChat).toHaveBeenLastCalledWith(owner, [{ role: 'user', content: 'next turn' }], [], undefined);
  });

  it('cancels a queued next turn from the same window while its previous provider cleans up', async () => {
    mod.setupLLMRouterIPC();
    let finishCleanup!: () => void;
    mockBuiltinStreamChat.mockReturnValue(new Promise<void>(resolve => { finishCleanup = resolve; }));
    const owner = createMockSender();
    const start = mockIpcListeners.get('llm-stream')![0];
    const active = start(createMockEvent(owner), [], []);
    owner.send('llm-stream-chunk', { done: true });
    await start(createMockEvent(owner), [{ role: 'user', content: 'cancel this turn' }], []);
    mockIpcListeners.get('llm-stream-abort')![0](createMockEvent(owner));
    finishCleanup();
    await active;
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
  });

  it('waits for aborted built-in cleanup before starting another job', async () => {
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
    mockBuiltinStreamChat.mockImplementationOnce(() => cleanup).mockImplementation(async (sender) => {
      sender.send('llm-stream-chunk', { content: 'next', done: true });
    });
    const controller = new AbortController();
    const first = mod.completeJob([], controller.signal).catch(error => error);
    const second = mod.completeJob([], new AbortController().signal);
    controller.abort();
    expect((await first).message).toMatch(/cancel/i);
    expect(mockBuiltinAbortStream).toHaveBeenCalledOnce();
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
    finishCleanup();
    await expect(second).resolves.toBe('next');
  });

  it('aborts a destroyed owner and ignores its late chunks while cleanup is pending', async () => {
    mod.setupLLMRouterIPC();
    let finishCleanup!: () => void;
    mockBuiltinStreamChat.mockReturnValue(new Promise<void>(resolve => { finishCleanup = resolve; }));
    const owner = createMockSender();
    const originalSend = owner.send;
    const next = { ...createMockSender(), id: 2 };
    const start = mockIpcListeners.get('llm-stream')![0];
    const active = start(createMockEvent(owner), [], []);
    await start(createMockEvent(next), [], []);
    owner.isDestroyed.mockReturnValue(true);
    owner.once.mock.calls[0][1]();
    expect(mockBuiltinAbortStream).toHaveBeenCalledOnce();
    owner.send('llm-stream-chunk', { content: 'late', done: true });
    expect(originalSend).not.toHaveBeenCalled();
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(1);
    finishCleanup();
    await active;
    expect(mockBuiltinStreamChat).toHaveBeenCalledTimes(2);
  });
});
