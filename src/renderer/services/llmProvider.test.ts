// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMStreamChunk, LLMToolCall, Settings } from '../../shared/types';

// ============================================================================
// Mock setup
// ============================================================================

let streamCallback: ((chunk: LLMStreamChunk) => void) | null = null;
const mockCleanup = vi.fn();

const mockBridge = {
  llm: {
    onLLMStreamChunk: vi.fn((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return mockCleanup;
    }),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
    llmCheckModel: vi.fn(),
    ollamaCheck: vi.fn(),
  },
};

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

const mockIsMobile = vi.fn(() => false);

vi.mock('../../shared/platform', () => ({
  isMobile: () => mockIsMobile(),
}));

const mockCloudAdapterStreamChat = vi.fn();
const mockCloudAdapterAbort = vi.fn();
const mockCloudAdapterCheckAvailability = vi.fn();

class MockCloudLLMAdapter {
  static lastInstance: MockCloudLLMAdapter | null = null;
  constructor(public baseUrl: string, public authToken: string) {
    MockCloudLLMAdapter.lastInstance = this;
  }
  streamChat = mockCloudAdapterStreamChat;
  abort = mockCloudAdapterAbort;
  checkAvailability = mockCloudAdapterCheckAvailability;
}

vi.mock('../../shared/backends/cloudLLMAdapter', () => ({
  CloudLLMAdapter: MockCloudLLMAdapter,
}));

vi.mock('../../shared/backends', () => ({
  resolveCloudApiUrl: vi.fn(() => 'https://api.example.com'),
}));

const mockEnsureCloudAccessToken = vi.fn(async () => 'mock-cloud-token');
const mockGetCloudSessionSettings = vi.fn(() => null);
const mockHandleCloudSessionError = vi.fn(() => false);
const mockIsCloudSessionError = vi.fn(() => false);

vi.mock('./cloudSessionManager', () => ({
  ensureCloudAccessToken: (...args: unknown[]) => mockEnsureCloudAccessToken(...args),
  getCloudSessionSettings: () => mockGetCloudSessionSettings(),
  handleCloudSessionError: (...args: unknown[]) => mockHandleCloudSessionError(...args),
  isCloudSessionError: (...args: unknown[]) => mockIsCloudSessionError(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    llmConfigured: true,
    llmProvider: 'builtin',
    llmEnabled: true,
    ...overrides,
  } as Settings;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}

// ============================================================================
// Tests
// ============================================================================

describe('llmProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    streamCallback = null;
    mockCleanup.mockClear();
    mockBridge.llm.onLLMStreamChunk.mockClear();
    mockBridge.llm.llmStream.mockClear();
    mockBridge.llm.llmStreamAbort.mockClear();
    mockBridge.llm.llmCheckModel.mockClear();
    mockBridge.llm.ollamaCheck.mockClear();
    MockCloudLLMAdapter.lastInstance = null;
    mockCloudAdapterStreamChat.mockClear();
    mockCloudAdapterAbort.mockClear();
    mockCloudAdapterCheckAvailability.mockClear();
    mockIsMobile.mockReturnValue(false);
    mockEnsureCloudAccessToken.mockResolvedValue('mock-cloud-token');
    mockGetCloudSessionSettings.mockReturnValue(null);
    mockHandleCloudSessionError.mockReturnValue(false);
    mockIsCloudSessionError.mockReturnValue(false);

    mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return mockCleanup;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // streamChat
  // --------------------------------------------------------------------------

  describe('streamChat', () => {
    it('registers chunk listener and calls llmStream', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      expect(mockBridge.llm.onLLMStreamChunk).toHaveBeenCalledOnce();
      expect(mockBridge.llm.llmStream).toHaveBeenCalledWith([], []);
    });

    it('accumulates content chunks and calls onChunk', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ content: 'Hello' });
      streamCallback!({ content: ' world' });

      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello', 'Hello');
      expect(onChunk).toHaveBeenNthCalledWith(2, ' world', 'Hello world');
    });

    it('calls onDone with accumulated content and tool calls when chunk.done', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      const toolCall: LLMToolCall = { id: 'tc1', name: 'show_translation', arguments: { phrase: 'hello', translation: 'bonjour' } };

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ content: 'response' });
      streamCallback!({ toolCalls: [toolCall] });
      streamCallback!({ done: true });

      expect(onDone).toHaveBeenCalledOnce();
      expect(onDone).toHaveBeenCalledWith('response', [toolCall], expect.objectContaining({ totalTime: expect.any(Number) }));
    });

    it('calls onToolCall for each tool call in the stream', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      const tc1: LLMToolCall = { id: 'tc1', name: 'show_translation', arguments: {} };
      const tc2: LLMToolCall = { id: 'tc2', name: 'show_explanation', arguments: {} };

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ toolCalls: [tc1, tc2] });
      streamCallback!({ done: true });

      expect(onToolCall).toHaveBeenCalledTimes(2);
      expect(onToolCall).toHaveBeenNthCalledWith(1, tc1);
      expect(onToolCall).toHaveBeenNthCalledWith(2, tc2);
    });

    it('calls onError and cleans up when error chunk arrives', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ error: 'Model crashed' });

      expect(onError).toHaveBeenCalledWith('Model crashed');
      expect(onDone).not.toHaveBeenCalled();
      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('cleans up the listener after done', async () => {
      const { streamChat } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamChat([], [], { onChunk, onDone, onError, onToolCall });

      streamCallback!({ done: true });

      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('calculates tokensPerSecond from evalCount and evalDuration', async () => {
      const { streamChat } = await import('./llmProvider');
      const onDone = vi.fn();

      streamChat([], [], { onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall: vi.fn() });

      streamCallback!({ done: true, evalCount: 100, evalDuration: 2_000_000_000 });

      expect(onDone).toHaveBeenCalledWith(
        '',
        [],
        expect.objectContaining({ tokensPerSecond: 50 }),
      );
    });

    it('returns abort function that calls llmStreamAbort and cleanup', async () => {
      const { streamChat } = await import('./llmProvider');
      const handle = streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      handle.abort();

      expect(mockBridge.llm.llmStreamAbort).toHaveBeenCalledOnce();
      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('retries a cloud stream once after session recovery when the first failure happens before any content', async () => {
      const { streamChat } = await import('./llmProvider');
      const onDone = vi.fn();
      const onError = vi.fn();

      mockIsCloudSessionError.mockReturnValue(true);
      mockEnsureCloudAccessToken
        .mockResolvedValueOnce('initial-cloud-token')
        .mockResolvedValueOnce('recovered-cloud-token');

      streamChat(
        [{ role: 'user', content: 'hello' }],
        [],
        { onChunk: vi.fn(), onDone, onError, onToolCall: vi.fn() },
        makeSettings({ llmProvider: 'cloud' }),
      );

      await flushPromises();
      expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(1);

      streamCallback!({ error: '401 invalid session' });

      await flushPromises();
      await flushPromises();

      expect(mockEnsureCloudAccessToken).toHaveBeenCalledTimes(2);
      expect(mockEnsureCloudAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
      expect(mockBridge.llm.onLLMStreamChunk).toHaveBeenCalledTimes(2);
      expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2);

      streamCallback!({ content: 'Recovered reply' });
      streamCallback!({ done: true });

      expect(onDone).toHaveBeenCalledWith(
        'Recovered reply',
        [],
        expect.objectContaining({ totalTime: expect.any(Number) }),
      );
      expect(onError).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // abortStream
  // --------------------------------------------------------------------------

  describe('abortStream', () => {
    it('calls llmStreamAbort', async () => {
      const { abortStream } = await import('./llmProvider');
      abortStream();
      expect(mockBridge.llm.llmStreamAbort).toHaveBeenCalledOnce();
    });

    it('calls active cleanup if a stream is in progress', async () => {
      const { streamChat, abortStream } = await import('./llmProvider');

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      abortStream();

      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('does not throw if no active stream', async () => {
      const { abortStream } = await import('./llmProvider');
      expect(() => abortStream()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // checkAvailability
  // --------------------------------------------------------------------------

  describe('checkAvailability', () => {
    it('returns not_configured when llmConfigured is false', async () => {
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmConfigured: false }));
      expect(result).toEqual({ available: false, reason: 'not_configured' });
    });

    it('checks built-in model via bridge.llm.llmCheckModel', async () => {
      mockBridge.llm.llmCheckModel.mockResolvedValue({ downloaded: true });
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'builtin' }));
      expect(mockBridge.llm.llmCheckModel).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true });
    });

    it('returns model_not_downloaded when model is not downloaded', async () => {
      mockBridge.llm.llmCheckModel.mockResolvedValue({ downloaded: false });
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'builtin' }));
      expect(result).toEqual({ available: false, reason: 'model_not_downloaded' });
    });

    it('returns model_check_failed when llmCheckModel throws', async () => {
      mockBridge.llm.llmCheckModel.mockRejectedValue(new Error('IPC error'));
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'builtin' }));
      expect(result).toEqual({ available: false, reason: 'model_check_failed' });
    });

    it('checks Ollama via bridge.llm.ollamaCheck', async () => {
      mockBridge.llm.ollamaCheck.mockResolvedValue(true);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'ollama' }));
      expect(mockBridge.llm.ollamaCheck).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true });
    });

    it('returns ollama_unreachable when ollamaCheck returns false', async () => {
      mockBridge.llm.ollamaCheck.mockResolvedValue(false);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'ollama' }));
      expect(result).toEqual({ available: false, reason: 'ollama_unreachable' });
    });

    it('returns ollama_unreachable when ollamaCheck throws', async () => {
      mockBridge.llm.ollamaCheck.mockRejectedValue(new Error('timeout'));
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'ollama' }));
      expect(result).toEqual({ available: false, reason: 'ollama_unreachable' });
    });

    it('uses CloudLLMAdapter for cloud provider', async () => {
      mockCloudAdapterCheckAvailability.mockResolvedValue(true);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'cloud', cloudAuthAccessToken: 'token123' }));
      expect(MockCloudLLMAdapter.lastInstance).not.toBeNull();
      expect(mockCloudAdapterCheckAvailability).toHaveBeenCalledOnce();
      expect(result).toEqual({ available: true });
    });

    it('returns cloud_unreachable when CloudLLMAdapter.checkAvailability returns false', async () => {
      mockCloudAdapterCheckAvailability.mockResolvedValue(false);
      const { checkAvailability } = await import('./llmProvider');
      const result = await checkAvailability(makeSettings({ llmProvider: 'cloud', cloudAuthAccessToken: 'token123' }));
      expect(result).toEqual({ available: false, reason: 'cloud_unreachable' });
    });
  });

  // --------------------------------------------------------------------------
  // streamExplanation / explanation cache
  // --------------------------------------------------------------------------

  describe('streamExplanation', () => {
    it('calls streamChat with the correct system and user messages', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onError = vi.fn();
      const onToolCall = vi.fn();

      streamExplanation('bonjour', 'Bonjour le monde', 'French', { onChunk, onDone, onError, onToolCall });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      const [messages] = mockBridge.llm.llmStream.mock.calls[0] as [{ role: string; content: string }[], unknown];
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('French');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toContain('bonjour');
      expect(messages[1].content).toContain('Bonjour le monde');
    });

    it('omits the word explanation tool in phrase mode', async () => {
      const { streamExplanation } = await import('./llmProvider');

      streamExplanation('', 'Bonjour le monde', 'French', {
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
        onToolCall: vi.fn(),
      }, { mode: 'phrase' });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      const [messages, tools] = mockBridge.llm.llmStream.mock.calls[0] as [
        Array<{ role: string; content: string }>,
        Array<{ name: string }>,
      ];

      expect(messages[0].content).toContain('Do not add a separate word-focused explanation');
      expect(messages[1].content).toContain('Only provide the translation and grammar cards');
      expect(tools.map((tool) => tool.name)).toEqual(['show_translation', 'show_grammar_points']);
    });

    it('parses plain-text fallback tool calls during streaming', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const onChunk = vi.fn();
      const onDone = vi.fn();
      const onToolCall = vi.fn();

      streamExplanation('bonjour', 'Bonjour le monde', 'French', {
        onChunk,
        onDone,
        onError: vi.fn(),
        onToolCall,
      });

      streamCallback!({ content: 'show_translation({"phrase":"Bonjour le monde","translation":"Hello world"})' });
      streamCallback!({ content: '\nshow_explanation({"word":"bonjour","explanation":"Here it means a simple greeting."})' });
      streamCallback!({ content: '\nshow_grammar_points({"points":[{"term":"Greeting phrase","description":"A short declarative expression used to greet someone."}]})' });
      streamCallback!({ done: true });

      expect(onToolCall).toHaveBeenCalledTimes(3);
      expect(onToolCall).toHaveBeenNthCalledWith(3, expect.objectContaining({
        name: 'show_grammar_points',
        arguments: {
          points: [
            {
              term: 'Greeting phrase',
              description: 'A short declarative expression used to greet someone.',
            },
          ],
        },
      }));

      const [finalContent, finalToolCalls] = onDone.mock.calls[0] as [string, LLMToolCall[]];
      expect(finalContent).toBe('');
      expect(finalToolCalls.map((toolCall) => toolCall.name)).toEqual([
        'show_translation',
        'show_explanation',
        'show_grammar_points',
      ]);
      expect(onChunk).toHaveBeenLastCalledWith(expect.any(String), '');
    });

    it('ignores incomplete structured tool-call fragments', async () => {
      const { streamExplanation } = await import('./llmProvider');
      const onDone = vi.fn();
      const onToolCall = vi.fn();

      streamExplanation('bonjour', 'Bonjour le monde', 'French', {
        onChunk: vi.fn(),
        onDone,
        onError: vi.fn(),
        onToolCall,
      });

      streamCallback!({
        toolCalls: [
          { id: 'tc-1', name: 'show_translation', arguments: {} },
          { id: 'tc-2', name: '', arguments: {} },
        ],
      });
      streamCallback!({ done: true });

      expect(onToolCall).not.toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledWith('', [], expect.objectContaining({ totalTime: expect.any(Number) }));
    });

    it('caches the result after onDone and returns it on second call', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');
      const toolCall: LLMToolCall = { id: 'tc1', name: 'show_translation', arguments: { phrase: 'hi', translation: 'salut' } };

      const onDone = vi.fn();
      streamExplanation('hi', 'Hi there', 'French', { onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall: vi.fn() });

      streamCallback!({ toolCalls: [toolCall] });
      streamCallback!({ done: true });

      const cached = getCachedExplanation('hi', 'Hi there');
      expect(cached).not.toBeNull();
      expect(cached!.toolCalls).toEqual([toolCall]);
    });

    it('returns null from getCachedExplanation when entry is missing', async () => {
      const { getCachedExplanation } = await import('./llmProvider');
      expect(getCachedExplanation('unknown', 'no context')).toBeNull();
    });

    it('expires a cache entry older than 24 hours', async () => {
      const { streamExplanation, getCachedExplanation } = await import('./llmProvider');

      const onDone = vi.fn();
      streamExplanation('word', 'context', 'French', { onChunk: vi.fn(), onDone, onError: vi.fn(), onToolCall: vi.fn() });
      streamCallback!({ done: true });

      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
      const cached = getCachedExplanation('word', 'context');
      expect(cached).toBeNull();
      vi.useRealTimers();
    });

    it('second streamExplanation call with same params hits bridge again (no short-circuit in streamExplanation)', async () => {
      const { streamExplanation } = await import('./llmProvider');

      streamExplanation('salut', 'Salut ami', 'French', { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });
      streamCallback!({ done: true });

      mockBridge.llm.llmStream.mockClear();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockCleanup;
      });

      streamExplanation('salut', 'Salut ami', 'French', { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    });
  });

  // --------------------------------------------------------------------------
  // Mobile path via CloudLLMAdapter
  // --------------------------------------------------------------------------

  describe('mobile path (isMobile = true)', () => {
    beforeEach(() => {
      mockIsMobile.mockReturnValue(true);
    });

    it('uses CloudLLMAdapter when isMobile returns true and settings has tethered backendMode', async () => {
      const { streamChat } = await import('./llmProvider');

      mockCloudAdapterStreamChat.mockImplementation(() => {});

      const settings = makeSettings({
        backendMode: 'tethered',
        backendUrl: 'http://desktop.local:7753',
        cloudAuthAccessToken: 'token123',
      } as Partial<Settings>);

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() }, settings);
      await flushPromises();

      expect(MockCloudLLMAdapter.lastInstance).not.toBeNull();
      expect(MockCloudLLMAdapter.lastInstance!.baseUrl).toBe('http://desktop.local:7753');
      expect(mockCloudAdapterStreamChat).toHaveBeenCalledOnce();
      expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
    });

    it('calls onError when no LLM endpoint configured for mobile', async () => {
      const { streamChat } = await import('./llmProvider');
      const onError = vi.fn();

      const settings = makeSettings({
        backendMode: 'local',
      } as Partial<Settings>);

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError, onToolCall: vi.fn() }, settings);

      expect(onError).toHaveBeenCalledWith('No LLM endpoint configured for mobile');
    });

    it('falls back to IPC bridge when isMobile returns true but settings is undefined', async () => {
      const { streamChat } = await import('./llmProvider');

      streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() });

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    });

    it('returns abort that calls adapter.abort', async () => {
      const { streamChat } = await import('./llmProvider');
      mockCloudAdapterStreamChat.mockImplementation(() => {});

      const settings = makeSettings({
        backendMode: 'tethered',
        backendUrl: 'http://desktop.local:7753',
        cloudAuthAccessToken: 'tok',
      } as Partial<Settings>);

      const handle = streamChat([], [], { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onToolCall: vi.fn() }, settings);
      await flushPromises();

      handle.abort();

      expect(mockCloudAdapterAbort).toHaveBeenCalledOnce();
    });

    it('streams content via CloudLLMAdapter onChunk callback', async () => {
      const { streamChat } = await import('./llmProvider');

      let adapterOnChunkCb: ((chunk: LLMStreamChunk) => void) | null = null;
      let adapterOnDoneCb: (() => void) | null = null;

      mockCloudAdapterStreamChat.mockImplementation(
        (_msgs: unknown, _tools: unknown, cbs: { onChunk: (c: LLMStreamChunk) => void; onDone: () => void; onError: (e: string) => void }) => {
          adapterOnChunkCb = cbs.onChunk;
          adapterOnDoneCb = cbs.onDone;
        }
      );

      const onChunk = vi.fn();
      const onDone = vi.fn();

      const settings = makeSettings({
        backendMode: 'tethered',
        backendUrl: 'http://desktop.local:7753',
        cloudAuthAccessToken: 'tok',
      } as Partial<Settings>);

      streamChat([], [], { onChunk, onDone, onError: vi.fn(), onToolCall: vi.fn() }, settings);
      await flushPromises();

      adapterOnChunkCb!({ content: 'Hello' });
      adapterOnChunkCb!({ content: ' world' });
      adapterOnDoneCb!();

      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello', 'Hello');
      expect(onChunk).toHaveBeenNthCalledWith(2, ' world', 'Hello world');
      expect(onDone).toHaveBeenCalledWith('Hello world', [], expect.objectContaining({ totalTime: expect.any(Number) }));
    });
  });

  // --------------------------------------------------------------------------
  // requiresSetup
  // --------------------------------------------------------------------------

  describe('requiresSetup', () => {
    it('returns true when llmConfigured is false', async () => {
      const { requiresSetup } = await import('./llmProvider');
      expect(requiresSetup(makeSettings({ llmConfigured: false }))).toBe(true);
    });

    it('returns false when llmConfigured is true', async () => {
      const { requiresSetup } = await import('./llmProvider');
      expect(requiresSetup(makeSettings({ llmConfigured: true }))).toBe(false);
    });
  });
});
