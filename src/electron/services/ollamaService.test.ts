import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

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
    getPath: vi.fn(() => '/tmp/test'),
    isPackaged: false,
    on: vi.fn(),
  },
}));

const mockLoadSettings = vi.fn();

vi.mock('./settings', () => ({
  loadSettings: mockLoadSettings,
}));

type MockRequest = EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  destroyed: boolean;
};

type MockResponse = EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
};

function createMockRequest(): MockRequest {
  const req = new EventEmitter() as MockRequest;
  req.write = vi.fn();
  req.end = vi.fn();
  req.destroy = vi.fn(() => { req.destroyed = true; });
  req.destroyed = false;
  return req;
}

function createMockResponse(statusCode = 200): MockResponse {
  const res = new EventEmitter() as MockResponse;
  res.statusCode = statusCode;
  res.headers = {};
  return res;
}

const mockHttpRequest = vi.fn();
const mockHttpsRequest = vi.fn();

vi.mock('http', () => ({
  default: {
    request: mockHttpRequest,
  },
  request: mockHttpRequest,
}));

vi.mock('https', () => ({
  default: {
    request: mockHttpsRequest,
  },
  request: mockHttpsRequest,
}));

function createMockSender(id = 1) {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    id,
  };
}

let mod: typeof import('./ollamaService');

beforeEach(async () => {
  vi.resetModules();
  mockIpcHandlers.clear();
  mockIpcListeners.clear();
  vi.clearAllMocks();
  mockLoadSettings.mockReturnValue({
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2',
  });
  mod = await import('./ollamaService');
});

describe('setupOllamaIPC', () => {
  it('registers OLLAMA_CHAT listener', () => {
    mod.setupOllamaIPC();
    expect(mockIpcListeners.has('ollama-chat')).toBe(true);
  });

  it('registers OLLAMA_CHAT_STREAM listener', () => {
    mod.setupOllamaIPC();
    expect(mockIpcListeners.has('ollama-chat-stream')).toBe(true);
  });

  it('registers OLLAMA_CHAT_STREAM_ABORT listener', () => {
    mod.setupOllamaIPC();
    expect(mockIpcListeners.has('ollama-chat-stream-abort')).toBe(true);
  });

  it('registers OLLAMA_LIST_MODELS handler', () => {
    mod.setupOllamaIPC();
    expect(mockIpcHandlers.has('ollama-list-models')).toBe(true);
  });

  it('registers OLLAMA_CHECK handler', () => {
    mod.setupOllamaIPC();
    expect(mockIpcHandlers.has('ollama-check')).toBe(true);
  });

  it('registers FETCH_URL handler', () => {
    mod.setupOllamaIPC();
    expect(mockIpcHandlers.has('fetch-url')).toBe(true);
  });

  it('registers OLLAMA_PULL_MODEL listener', () => {
    mod.setupOllamaIPC();
    expect(mockIpcListeners.has('ollama-pull-model')).toBe(true);
  });
});

describe('OLLAMA_LIST_MODELS handler', () => {
  beforeEach(() => {
    mod.setupOllamaIPC();
  });

  it('returns model names from Ollama API response', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });
    const handler = mockIpcHandlers.get('ollama-list-models');
    const promise = handler!(null);
    res.emit('data', Buffer.from(JSON.stringify({ models: [{ name: 'llama3.2' }, { name: 'qwen3:4b' }] })));
    res.emit('end');
    const result = await promise;
    expect(result).toEqual(['llama3.2', 'qwen3:4b']);
  });

  it('returns empty array when request errors', async () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);
    const handler = mockIpcHandlers.get('ollama-list-models');
    const promise = handler!(null);
    req.emit('error', new Error('connection refused'));
    const result = await promise;
    expect(result).toEqual([]);
  });

  it('returns empty array when response has no models field', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });
    const handler = mockIpcHandlers.get('ollama-list-models');
    const promise = handler!(null);
    res.emit('data', Buffer.from(JSON.stringify({})));
    res.emit('end');
    const result = await promise;
    expect(result).toEqual([]);
  });
});

describe('OLLAMA_CHECK handler', () => {
  beforeEach(() => {
    mod.setupOllamaIPC();
  });

  it('returns true when Ollama is reachable', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });
    const handler = mockIpcHandlers.get('ollama-check');
    const promise = handler!(null);
    res.emit('data', Buffer.from(JSON.stringify({ models: [] })));
    res.emit('end');
    const result = await promise;
    expect(result).toBe(true);
  });

  it('returns false when connection fails', async () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);
    const handler = mockIpcHandlers.get('ollama-check');
    const promise = handler!(null);
    req.emit('error', new Error('ECONNREFUSED'));
    const result = await promise;
    expect(result).toBe(false);
  });
});

describe('OLLAMA_CHAT handler (non-streaming)', () => {
  beforeEach(() => {
    mod.setupOllamaIPC();
  });

  it('replies with message content on success', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const mockReply = vi.fn();
    const sender = createMockSender();
    const event = { sender, reply: mockReply };
    const listeners = mockIpcListeners.get('ollama-chat') || [];

    const callPromise = new Promise<void>(resolve => {
      mockReply.mockImplementation(() => resolve());
      listeners[0](event, [{ role: 'user', content: 'hi' }]);
    });

    res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'Hello!' } })));
    res.emit('end');

    await callPromise;
    expect(mockReply).toHaveBeenCalledWith('ollama-chat', expect.objectContaining({ content: 'Hello!' }));
  });

  it('replies with error message on request failure', async () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);

    const mockReply = vi.fn();
    const event = { sender: createMockSender(), reply: mockReply };
    const listeners = mockIpcListeners.get('ollama-chat') || [];

    const callPromise = new Promise<void>(resolve => {
      mockReply.mockImplementation(() => resolve());
      listeners[0](event, [{ role: 'user', content: 'hi' }]);
    });

    req.emit('error', new Error('timeout'));
    await callPromise;
    expect(mockReply).toHaveBeenCalledWith('ollama-chat', expect.objectContaining({
      content: expect.stringContaining('Error'),
    }));
  });
});

describe('OLLAMA_CHAT_STREAM handler', () => {
  beforeEach(() => {
    mod.setupOllamaIPC();
  });

  it('streams content chunks to sender via OLLAMA_CHAT_STREAM channel', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('ollama-chat-stream') || [];
    listeners[0](event, [{ role: 'user', content: 'hello' }]);

    res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n'));
    expect(sender.send).toHaveBeenCalledWith('ollama-chat-stream', expect.objectContaining({ content: 'Hi' }));
  });

  it('sends done:true chunk at end of stream', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('ollama-chat-stream') || [];
    listeners[0](event, [{ role: 'user', content: 'hello' }]);

    res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'text' }, done: true }) + '\n'));
    res.emit('end');

    const calls = sender.send.mock.calls;
    const doneCall = calls.find(c => c[1]?.done === true);
    expect(doneCall).toBeDefined();
  });

  it('sends error chunk on request error', () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);

    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('ollama-chat-stream') || [];
    listeners[0](event, [{ role: 'user', content: 'hello' }]);

    req.emit('error', new Error('ECONNREFUSED'));
    expect(sender.send).toHaveBeenCalledWith('ollama-chat-stream', expect.objectContaining({
      content: expect.stringContaining('Connection error'),
      done: true,
    }));
  });

  it('does not send to destroyed sender', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    sender.isDestroyed.mockReturnValue(true);
    const event = { sender };
    const listeners = mockIpcListeners.get('ollama-chat-stream') || [];
    listeners[0](event, [{ role: 'user', content: 'hello' }]);

    res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n'));
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe('OLLAMA_CHAT_STREAM_ABORT handler', () => {
  beforeEach(() => {
    mod.setupOllamaIPC();
  });

  it('destroys the active stream request when aborted', () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);

    const sender = createMockSender(42);
    const streamEvent = { sender };
    const streamListeners = mockIpcListeners.get('ollama-chat-stream') || [];
    streamListeners[0](streamEvent, [{ role: 'user', content: 'hello' }]);

    const abortListeners = mockIpcListeners.get('ollama-chat-stream-abort') || [];
    abortListeners[0]({ sender });
    expect(req.destroy).toHaveBeenCalled();
  });

  it('does nothing when no active stream for sender', () => {
    const abortListeners = mockIpcListeners.get('ollama-chat-stream-abort') || [];
    expect(() => abortListeners[0]({ sender: createMockSender(99) })).not.toThrow();
  });
});

describe('FETCH_URL handler', () => {
  beforeEach(() => {
    mod.setupOllamaIPC();
  });

  it('returns fetched content on success', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });
    const handler = mockIpcHandlers.get('fetch-url');
    const promise = handler!(null, 'http://example.com/page');
    res.emit('data', Buffer.from('page content'));
    res.emit('end');
    const result = await promise;
    expect(result).toEqual({ content: 'page content' });
  });

  it('returns error on fetch failure', async () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);
    const handler = mockIpcHandlers.get('fetch-url');
    const promise = handler!(null, 'http://example.com/page');
    req.emit('error', new Error('fetch failed'));
    const result = await promise as { content: string; error: string };
    expect(result.content).toBe('');
    expect(result.error).toBe('fetch failed');
  });

  it('uses https for https URLs', async () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpsRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });
    const handler = mockIpcHandlers.get('fetch-url');
    const promise = handler!(null, 'https://example.com/page');
    res.emit('data', Buffer.from('secure content'));
    res.emit('end');
    const result = await promise;
    expect(mockHttpsRequest).toHaveBeenCalled();
    expect(result).toEqual({ content: 'secure content' });
  });
});

describe('OLLAMA_PULL_MODEL handler', () => {
  beforeEach(() => {
    mod.setupOllamaIPC();
  });

  it('sends progress updates to sender', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('ollama-pull-model') || [];
    listeners[0](event, 'llama3.2');

    res.emit('data', Buffer.from(JSON.stringify({ status: 'pulling', completed: 50, total: 100 }) + '\n'));
    expect(sender.send).toHaveBeenCalledWith('ollama-pull-model-progress', expect.objectContaining({ status: 'pulling' }));
  });

  it('sends success status at end', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('ollama-pull-model') || [];
    listeners[0](event, 'llama3.2');
    res.emit('end');
    expect(sender.send).toHaveBeenCalledWith('ollama-pull-model-progress', { status: 'success' });
  });

  it('sends error status on request error', () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);

    const sender = createMockSender();
    const event = { sender };
    const listeners = mockIpcListeners.get('ollama-pull-model') || [];
    listeners[0](event, 'llama3.2');
    req.emit('error', new Error('network error'));
    expect(sender.send).toHaveBeenCalledWith('ollama-pull-model-progress', expect.objectContaining({
      status: 'error',
      error: 'network error',
    }));
  });
});

describe('ollamaStreamChatUnified (exported)', () => {
  it('uses LLM_STREAM_CHUNK channel for unified streaming', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'Hello' }, done: false }) + '\n'));
    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({ content: 'Hello' }));
  });

  it('handles thinking content by wrapping in think tags', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    res.emit('data', Buffer.from(JSON.stringify({ message: { thinking: 'thought', content: '' }, done: false }) + '\n'));
    const calls = sender.send.mock.calls;
    const thinkCall = calls.find(c => c[1]?.content?.includes('<think>'));
    expect(thinkCall).toBeDefined();
  });

  it('sends done:true at end of stream', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    res.emit('data', Buffer.from(JSON.stringify({ message: { content: 'text' }, done: true }) + '\n'));
    res.emit('end');

    const calls = sender.send.mock.calls;
    const doneCall = calls.find(c => c[1]?.done === true);
    expect(doneCall).toBeDefined();
  });

  it('sends done:true when stream ends with no final done', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);
    res.emit('end');

    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', { done: true });
  });

  it('handles tool_calls in response', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    const toolCallData = {
      message: {
        content: '',
        tool_calls: [{ function: { name: 'my_tool', arguments: { key: 'val' } } }],
      },
      done: false,
    };
    res.emit('data', Buffer.from(JSON.stringify(toolCallData) + '\n'));

    const calls = sender.send.mock.calls;
    const toolCall = calls.find(c => c[1]?.toolCalls);
    expect(toolCall).toBeDefined();
    expect(toolCall[1].toolCalls[0].name).toBe('my_tool');
  });

  it('sends error chunk on response error', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    res.emit('error', new Error('stream error'));
    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
      error: 'stream error',
      done: true,
    }));
  });

  it('sends error chunk on request error', () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    req.emit('error', new Error('connection failed'));
    expect(sender.send).toHaveBeenCalledWith('llm-stream-chunk', expect.objectContaining({
      error: 'connection failed',
      done: true,
    }));
  });

  it('converts unified LLM messages to ollama format', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hello' },
    ], []);

    const body = JSON.parse(req.write.mock.calls[0][0]);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.think).toBe(false);
  });
});

describe('ollamaAbortStream (exported)', () => {
  it('destroys the request for the given senderId', () => {
    const req = createMockRequest();
    mockHttpRequest.mockImplementation(() => req);

    const sender = createMockSender(55);
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);
    mod.ollamaAbortStream(55);
    expect(req.destroy).toHaveBeenCalled();
  });

  it('does nothing for unknown senderId', () => {
    expect(() => mod.ollamaAbortStream(9999)).not.toThrow();
  });
});

describe('settings-based URL', () => {
  it('uses custom Ollama URL from settings', () => {
    mockLoadSettings.mockReturnValue({
      ollamaUrl: 'http://192.168.1.5:11434',
      ollamaModel: 'custom-model',
    });

    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    const opts = mockHttpRequest.mock.calls[0][0] as { hostname: string; port: number };
    expect(opts.hostname).toBe('192.168.1.5');
    expect(opts.port).toBe(11434);
  });

  it('uses default URL when ollamaUrl is not set', () => {
    mockLoadSettings.mockReturnValue({ ollamaUrl: undefined, ollamaModel: undefined });

    const req = createMockRequest();
    const res = createMockResponse();
    mockHttpRequest.mockImplementation((_opts: unknown, cb: (r: MockResponse) => void) => {
      cb(res);
      return req;
    });

    const sender = createMockSender();
    mod.ollamaStreamChatUnified(sender, [{ role: 'user', content: 'hi' }], []);

    const opts = mockHttpRequest.mock.calls[0][0] as { hostname: string };
    expect(opts.hostname).toBe('localhost');
  });
});
