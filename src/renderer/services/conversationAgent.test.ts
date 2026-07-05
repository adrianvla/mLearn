// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  LLMStreamChunk,
  ConversationAgentContext,
  AgentConfig,
  AgentMemoryEntry,
  TutorSessionConfig,
  WordFrequencyEntry,
  VoiceMistake,
  Token,
  LLMChatMessage,
  LanguageData,
} from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { createConversationAgent, type StreamCallbacks } from './conversationAgent';
import type { LanguageFeatures } from '../context/LanguageContext';

const DEFAULT_LANGUAGE_FEATURES: LanguageFeatures = {
  supportsReadings: true,
  prosodyRenderer: 'japanese-pitch-accent',
  supportsProsody: true,
  isLogographic: true,
  isRTL: false,
  supportsColorCodes: true,
  usesLatinScript: false,
  supportsFrequencyLevels: true,
  hasFixedSettings: false,
  fixedSettingKeys: [],
  supportsCharacterNames: true,
  supportsVerticalText: true,
  supportsGrammar: true,
  supportsDeferentialRegister: true,
  tokenizerCapabilities: {
    segmentsText: true,
    segmentationQuality: 'linguistic',
    providesLemmas: true,
    providesPartOfSpeech: true,
    providesReadings: true,
    allowsRoughFallback: false,
  },
  casualRegisterPromptGuidelines: [],
  tutorPromptGuidelines: ['Do not quiz the learner on character readings; focus quizzes on vocabulary, usage, and grammar.'],
  correctionPromptGuidelines: [],
  mistakeCheckerPromptGuidelines: [],
};

// ============================================================================
// Mock setup
// ============================================================================

let streamCallback: (chunk: LLMStreamChunk) => void = () => {};
const mockStreamCleanup = vi.fn();

const mockBridge = {
  llm: {
    onLLMStreamChunk: vi.fn((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return mockStreamCleanup;
    }),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
  },
  generic: {
    fetchUrl: vi.fn(),
  },
};

vi.mock('../../shared/bridges', () => ({ getBridge: () => mockBridge }));

const mockBackend = { tokenize: vi.fn().mockResolvedValue([]) };
vi.mock('../../shared/backends', () => ({ getBackend: () => mockBackend }));

// ============================================================================
// Helpers
// ============================================================================

interface MockDeps {
  getSettings: () => typeof DEFAULT_SETTINGS;
  getLanguage: () => string;
  getLanguageName: () => string;
  getLanguageFeatures: () => LanguageFeatures;
  getMediaContext: () => ConversationAgentContext | null;
  getSceneContext: () => string;
  flashcardCtx: {
    getWordKnowledge: (_word: string) => { ease: number; timesSeen: number } | undefined;
    trackGrammarFailed: (_pattern: string) => void;
    trackGrammarEncountered: (_pattern: string) => void;
  };
  getFrequency?: (word: string) => WordFrequencyEntry | null;
  getTargetLevel?: () => number | null;
  getLanguageData?: () => LanguageData | null;
  getLevelName?: (level: number) => string;
  isVoiceMode?: () => boolean;
  onVoiceMistake?: (_mistake: VoiceMistake) => void;
  getTutorConfig?: () => TutorSessionConfig | null;
  getAgentConfig?: () => AgentConfig | null;
  getAgentMemories?: () => AgentMemoryEntry[];
  onMemorySaved?: (_content: string) => void;
  getIncludeKnowledgeInfo?: () => boolean;
  getDisabledTools?: () => Set<string>;
}

function createMockDeps(overrides?: Partial<MockDeps>): MockDeps {
  return {
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    getLanguage: () => 'ja',
    getLanguageName: () => 'Japanese',
    getLanguageFeatures: () => DEFAULT_LANGUAGE_FEATURES,
    getMediaContext: () => null,
    getSceneContext: () => '',
    flashcardCtx: {
      getWordKnowledge: vi.fn<(_word: string) => { ease: number; timesSeen: number } | undefined>(),
      trackGrammarFailed: vi.fn<(_pattern: string) => void>(),
      trackGrammarEncountered: vi.fn<(_pattern: string) => void>(),
    },
    ...overrides,
  };
}

function createCallbacks(): {
  callbacks: StreamCallbacks;
  onChunk: ReturnType<typeof vi.fn>;
  onToolCall: ReturnType<typeof vi.fn>;
  onDone: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
} {
  const onChunk = vi.fn();
  const onToolCall = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  return {
    callbacks: { onChunk, onToolCall, onDone, onError },
    onChunk,
    onToolCall,
    onDone,
    onError,
  };
}

function sendChunk(content: string): void {
  streamCallback({ content });
}

function sendDone(toolCalls?: LLMStreamChunk['toolCalls']): void {
  streamCallback({ done: true, toolCalls });
}

function sendError(error: string): void {
  streamCallback({ error });
}

// ============================================================================
// Tests
// ============================================================================

describe('createConversationAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamCleanup.mockReset();
    mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return mockStreamCleanup;
    });
    mockBackend.tokenize.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==========================================================================
  // Factory
  // ==========================================================================

  describe('factory', () => {
    it('returns an AgentInstance with all required methods', () => {
      const agent = createConversationAgent(createMockDeps());
      expect(typeof agent.processMessage).toBe('function');
      expect(typeof agent.abortStream).toBe('function');
      expect(typeof agent.clearHistory).toBe('function');
      expect(typeof agent.popHistory).toBe('function');
      expect(typeof agent.restartStream).toBe('function');
      expect(typeof agent.tokenize).toBe('function');
      expect(typeof agent.continueWithContext).toBe('function');
      expect(typeof agent.markInterrupted).toBe('function');
    });
  });

  // ==========================================================================
  // processMessage
  // ==========================================================================

  describe('processMessage', () => {
    it('calls llmStream after adding user message', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const userMsg = messages.find((m: { role: string; content: string }) => m.role === 'user');
      expect(userMsg?.content).toBe('hello');
    });

    it('sets up stream chunk listener', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      expect(mockBridge.llm.onLLMStreamChunk).toHaveBeenCalledOnce();
    });

    it('includes a system message in the LLM call', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg).toBeDefined();
      expect(sysMsg.content).toContain('Japanese');
    });

    it('emits deferential-register avoidance directive when language declares deferential forms', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('Avoid formal or deferential register entirely.');
    });

    it('omits deferential-register avoidance directive when language lacks deferential forms', () => {
      const deps = createMockDeps({
        getLanguage: () => 'de',
        getLanguageName: () => 'German',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          usesLatinScript: true,
          prosodyRenderer: undefined,
          tutorPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).not.toContain('deferential');
      expect(sysMsg.content).toContain('German');
    });

    it('keeps generic casual tutor guidance language-agnostic', () => {
      const deps = createMockDeps({
        getLanguage: () => 'ar',
        getLanguageName: () => 'Arabic',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          isRTL: true,
          usesLatinScript: false,
          prosodyRenderer: undefined,
          tutorPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('Arabic');
      expect(sysMsg.content).toContain('everyday vocabulary');
      expect(sysMsg.content).not.toContain('contractions');
    });

    it('includes package-declared casual register guidance without requiring built-in deferential-register policy', () => {
      const deps = createMockDeps({
        getLanguage: () => 'ar',
        getLanguageName: () => 'Arabic',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          isRTL: true,
          usesLatinScript: false,
          prosodyRenderer: undefined,
          casualRegisterPromptGuidelines: ['Use everyday spoken Arabic phrasing; do not over-classicize learner-facing replies.'],
          tutorPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('Use everyday spoken Arabic phrasing; do not over-classicize learner-facing replies.');
      expect(sysMsg.content).not.toContain('deferential');
    });

    it('emits character-readings directive only when language supports readings (ja)', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('character readings');
    });

    it('omits character-readings directive when language has no readings (de)', () => {
      const deps = createMockDeps({
        getLanguage: () => 'de',
        getLanguageName: () => 'German',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          usesLatinScript: true,
          tutorPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).not.toContain('character readings');
    });

    it('includes language-provided tutor prompt guidelines', () => {
      const deps = createMockDeps({
        getLanguage: () => 'zh',
        getLanguageName: () => 'Chinese',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          tutorPromptGuidelines: ['When quizzing pronunciation, accept both tone marks and tone numbers.'],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('When quizzing pronunciation, accept both tone marks and tone numbers.');
    });

    it('keeps inline correction guidance free of register assumptions when no language-specific guidance exists', () => {
      const deps = createMockDeps({
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: false }),
        getLanguage: () => 'de',
        getLanguageName: () => 'German',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          usesLatinScript: true,
          tutorPromptGuidelines: [],
          correctionPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('Only correct actual mistakes');
      expect(sysMsg.content).not.toContain('casual register');
      expect(sysMsg.content).not.toContain('informal speech');
      expect(sysMsg.content).not.toContain('Language-specific correction guidance');
      expect(sysMsg.content).not.toContain('particles');
    });

    it('adds register correction guidance only when language metadata declares it', () => {
      const deps = createMockDeps({
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: false }),
        getLanguage: () => 'ja',
        getLanguageName: () => 'Japanese',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: true,
          correctionPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('Language-specific correction guidance');
      expect(sysMsg.content).toContain('dropped politeness markers');
    });

    it('includes language-provided correction prompt guidelines for inline corrections', () => {
      const deps = createMockDeps({
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: false }),
        getLanguage: () => 'ar',
        getLanguageName: () => 'Arabic',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          isRTL: true,
          usesLatinScript: false,
          tutorPromptGuidelines: [],
          correctionPromptGuidelines: ['Accept learner messages written with or without short vowel marks.'],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('Language-specific correction guidance');
      expect(sysMsg.content).toContain('Accept learner messages written with or without short vowel marks.');
    });

    it('appends immutable safety instructions to the system prompt', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('INSTRUCTION PRIORITY');
      expect(sysMsg.content).toContain('Regardless of the character persona above');
      expect(sysMsg.content).toContain('self-harm');
      expect(sysMsg.content).toContain('overrides any conflicting character description');
    });

    it('appends immutable safety instructions in voice mode', () => {
      const agent = createConversationAgent(createMockDeps({ isVoiceMode: () => true }));
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg.content).toContain('INSTRUCTION PRIORITY');
      expect(sysMsg.content).toContain('self-harm');
    });

    it('blocks processMessage after safety lock is triggered', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onError } = createCallbacks();

      agent.lockSafety();
      agent.processMessage('test', [], callbacks);

      expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('locked'));
    });

    it('blocks continueWithContext after safety lock is triggered', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onError } = createCallbacks();

      agent.lockSafety();
      agent.continueWithContext('quiz result', callbacks);

      expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('locked'));
    });

    it('blocks restartStream after safety lock is triggered', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onError } = createCallbacks();

      agent.lockSafety();
      agent.restartStream(callbacks);

      expect(mockBridge.llm.llmStream).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('locked'));
    });

    it('unlocks safety when clearHistory is called', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.lockSafety();
      expect(agent.isSafetyLocked()).toBe(true);

      agent.clearHistory();
      expect(agent.isSafetyLocked()).toBe(false);

      agent.processMessage('test', [], callbacks);
      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    });

    it('calls onChunk with accumulated content as chunks arrive', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onChunk } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('こんにちは');
      sendChunk('！');

      expect(onChunk).toHaveBeenCalledWith('こんにちは');
      expect(onChunk).toHaveBeenCalledWith('こんにちは！');
    });

    it('calls onDone when stream completes', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('こんにちは');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
      expect(onDone.mock.calls[0][0]).toBe('こんにちは');
    });

    it('calls onError when stream emits an error', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onError } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendError('LLM failed');

      expect(onError).toHaveBeenCalledWith('LLM failed');
    });
  });

  // ==========================================================================
  // abortStream
  // ==========================================================================

  describe('abortStream', () => {
    it('calls llmStreamAbort', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      agent.abortStream();

      expect(mockBridge.llm.llmStreamAbort).toHaveBeenCalled();
    });

    it('calls the stream cleanup listener', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      agent.abortStream();

      expect(mockStreamCleanup).toHaveBeenCalled();
    });

    it('prevents further onDone from being called after abort', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      agent.abortStream();
      sendChunk('text');
      sendDone();

      await new Promise((r) => setTimeout(r, 10));
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // clearHistory
  // ==========================================================================

  describe('clearHistory', () => {
    it('clears internal conversation history', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('message 1', [], callbacks);
      sendChunk('response');
      sendDone();

      agent.clearHistory();

      vi.clearAllMocks();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockStreamCleanup;
      });

      agent.restartStream(callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const nonSystemMessages = messages.filter((m: { role: string }) => m.role !== 'system');
      expect(nonSystemMessages).toHaveLength(0);
    });
  });

  // ==========================================================================
  // popHistory
  // ==========================================================================

  describe('popHistory', () => {
    it('removes last N entries from history', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('msg1', [], callbacks);
      sendChunk('resp1');
      sendDone();

      await vi.waitFor(() => expect(mockBackend.tokenize).toHaveBeenCalled());

      vi.clearAllMocks();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockStreamCleanup;
      });
      mockBackend.tokenize.mockResolvedValue([]);

      agent.processMessage('msg2', [], callbacks);
      sendChunk('resp2');
      sendDone();

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalled());

      // Pop the last 2 entries (msg2 + resp2)
      agent.popHistory(2);

      vi.clearAllMocks();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockStreamCleanup;
      });

      agent.restartStream(callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const nonSystem = messages.filter((m: { role: string }) => m.role !== 'system');
      // Should only have msg1 + resp1
      expect(nonSystem.some((m: { content: string }) => m.content === 'msg2')).toBe(false);
    });

    it('does nothing if count is 0', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('msg', [], callbacks);
      sendDone();

      agent.popHistory(0);

      vi.clearAllMocks();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockStreamCleanup;
      });

      agent.restartStream(callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const nonSystem = messages.filter((m: { role: string }) => m.role !== 'system');
      expect(nonSystem.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // restartStream
  // ==========================================================================

  describe('restartStream', () => {
    it('re-streams without adding new user message to history', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('response');
      sendDone();

      await vi.waitFor(() => expect(mockBackend.tokenize).toHaveBeenCalled());

      vi.clearAllMocks();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockStreamCleanup;
      });
      mockBackend.tokenize.mockResolvedValue([]);

      agent.restartStream(callbacks);

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const userMsgs = messages.filter((m: { role: string }) => m.role === 'user');
      // Should only have the original "hello" once (not added again)
      expect(userMsgs.length).toBe(1);
      expect(userMsgs[0].content).toBe('hello');
    });

    it('pops assistant messages back to the last user message before re-streaming', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('first response');
      sendDone();

      await vi.waitFor(() => expect(mockBackend.tokenize).toHaveBeenCalled());

      vi.clearAllMocks();
      mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
        streamCallback = cb;
        return mockStreamCleanup;
      });
      mockBackend.tokenize.mockResolvedValue([]);

      agent.restartStream(callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const nonSystem = messages.filter((m: { role: string }) => m.role !== 'system');
      expect(nonSystem.length).toBe(1);
      expect(nonSystem[0].role).toBe('user');
      expect(nonSystem[0].content).toBe('hello');
    });
  });

  // ==========================================================================
  // continueWithContext
  // ==========================================================================

  describe('continueWithContext', () => {
    it('adds context as user message then streams', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.continueWithContext('quiz result: correct', callbacks);

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const userMsgs = messages.filter((m: { role: string }) => m.role === 'user');
      expect(userMsgs[0].content).toBe('quiz result: correct');
    });
  });

  // ==========================================================================
  // markInterrupted
  // ==========================================================================

  describe('markInterrupted', () => {
    it('replaces last assistant message with truncated text + interrupted marker', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('こんにちは、今日はどうですか');
      sendDone();

      await vi.waitFor(() => expect(mockBackend.tokenize).toHaveBeenCalled());

      agent.markInterrupted('こんにちは');

      const { callbacks: callbacks2 } = createCallbacks();
      agent.processMessage('next', [], callbacks2);

      const [messages] = mockBridge.llm.llmStream.mock.calls[mockBridge.llm.llmStream.mock.calls.length - 1];
      const assistantMsgs = messages.filter((m: { role: string }) => m.role === 'assistant');
      expect(assistantMsgs[assistantMsgs.length - 1].content).toBe('こんにちは [interrupted by user]');
    });

    it('does nothing if there is no assistant message in history', () => {
      const agent = createConversationAgent(createMockDeps());
      // Should not throw
      expect(() => agent.markInterrupted('something')).not.toThrow();
    });
  });

  // ==========================================================================
  // tokenize
  // ==========================================================================

  describe('tokenize', () => {
    it('calls getBackend().tokenize with the text and language', async () => {
      const mockTokens: Token[] = [{ word: 'こんにちは', actual_word: 'こんにちは', type: '感動詞' }];
      mockBackend.tokenize.mockResolvedValueOnce(mockTokens);

      const agent = createConversationAgent(createMockDeps());
      const result = await agent.tokenize('こんにちは');

      expect(mockBackend.tokenize).toHaveBeenCalledWith('こんにちは', 'ja');
      expect(result).toEqual(mockTokens);
    });

    it('returns empty array for empty string', async () => {
      const agent = createConversationAgent(createMockDeps());
      const result = await agent.tokenize('   ');
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // Tool execution: correct_mistake
  // ==========================================================================

  describe('tool: correct_mistake', () => {
    it('emits a mistake widget via onToolCall for a single correction', async () => {
      const deps = createMockDeps();
      const agent = createConversationAgent(deps);
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('I go to school yesterday', [], callbacks);
      sendChunk('Good try!');
      sendDone([
        {
          id: 'tc1',
          name: 'correct_mistake',
          arguments: {
            corrections: [
              {
                error_span: 'go',
                correction: 'went',
                error_type: 'grammar',
                affected_pattern: 'past tense',
              },
            ],
          },
        },
      ]);

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      expect(onToolCall).toHaveBeenCalledOnce();
      const widget = onToolCall.mock.calls[0][0];
      expect(widget.type).toBe('mistake');
      expect((widget.data as { errorSpan: string }).errorSpan).toBe('go');
      expect((widget.data as { correction: string }).correction).toBe('went');
    });

    it('emits multiple widgets for batched corrections', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('I go to school yesterday and eated lunch', [], callbacks);
      sendChunk('Almost!');
      sendDone([
        {
          id: 'tc1',
          name: 'correct_mistake',
          arguments: {
            corrections: [
              { error_span: 'go', correction: 'went', error_type: 'grammar' },
              { error_span: 'eated', correction: 'ate', error_type: 'word' },
            ],
          },
        },
      ]);

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      expect(onToolCall).toHaveBeenCalledTimes(2);
      expect(onToolCall.mock.calls[0][0].type).toBe('mistake');
      expect(onToolCall.mock.calls[1][0].type).toBe('mistake');
    });

    it('tracks affected grammar pattern via flashcardCtx', async () => {
      const deps = createMockDeps();
      const agent = createConversationAgent(deps);
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendChunk('response');
      sendDone([
        {
          id: 'tc1',
          name: 'correct_mistake',
          arguments: {
            corrections: [
              {
                error_span: 'go',
                correction: 'went',
                error_type: 'grammar',
                affected_pattern: 'past-tense',
              },
            ],
          },
        },
      ]);

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(deps.flashcardCtx.trackGrammarFailed).toHaveBeenCalledWith('past-tense');
    });
  });

  // ==========================================================================
  // Tool execution: create_quiz
  // ==========================================================================

  describe('tool: create_quiz (mcq)', () => {
    it('emits a quiz widget for MCQ type', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendChunk('Quiz time!');
      sendDone([
        {
          id: 'q1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'mcq',
            question: 'What does 食べる mean?',
            options: ['to eat', 'to drink', 'to sleep', 'to run'],
            correct_answer: 'to eat',
          },
        },
      ]);

      // create_quiz triggers a follow-up stream — simulate its completion
      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
      sendChunk('');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      expect(onToolCall).toHaveBeenCalledOnce();
      const widget = onToolCall.mock.calls[0][0];
      expect(widget.type).toBe('quiz');
      expect((widget.data as { type: string }).type).toBe('mcq');
      expect((widget.data as { correctAnswer: string }).correctAnswer).toBe('to eat');
    });

    it('emits a quiz widget for text-input type', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendChunk('Test');
      sendDone([
        {
          id: 'q1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'text-input',
            question: 'How do you say "cat" in Japanese?',
            correct_answer: '猫',
          },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      const widget = onToolCall.mock.calls[0][0];
      expect(widget.type).toBe('quiz');
      expect((widget.data as { type: string }).type).toBe('text-input');
    });

    it('emits fill-in quiz widget with textWithBlanks', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendChunk('Test');
      sendDone([
        {
          id: 'q1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'fill-in',
            question: 'Fill in the blank',
            text_with_blanks: 'I am eating an []',
            correct_answer: 'apple',
          },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      const widget = onToolCall.mock.calls[0][0];
      expect(widget.type).toBe('quiz');
      expect((widget.data as { textWithBlanks: string }).textWithBlanks).toBe('I am eating an []');
    });

    it('degrades fill-in to text-input when text_with_blanks is missing', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendChunk('Test');
      sendDone([
        {
          id: 'q1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'fill-in',
            question: 'Fill in',
            correct_answer: 'apple',
          },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      const widget = onToolCall.mock.calls[0][0];
      expect((widget.data as { type: string }).type).toBe('text-input');
    });

    it('tracks grammar encounter via flashcardCtx when affected_pattern is set', async () => {
      const deps = createMockDeps();
      const agent = createConversationAgent(deps);
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendDone([
        {
          id: 'q1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'mcq',
            question: 'Test',
            correct_answer: 'A',
            affected_pattern: 'て-form',
          },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(deps.flashcardCtx.trackGrammarEncountered).toHaveBeenCalledWith('て-form');
    });
  });

  describe('duplicate tool_call_id handling', () => {
    it('rewrites duplicate tool call IDs so follow-up stream has unique IDs', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('quiz me', [], callbacks);
      sendChunk('Quiz time!');
      sendDone([
        {
          id: 'dup_id_1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'mcq',
            question: 'Q1?',
            options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A',
          },
        },
        {
          id: 'dup_id_1',
          name: 'create_quiz',
          arguments: {
            quiz_type: 'mcq',
            question: 'Q2?',
            options: ['X', 'Y', 'Z', 'W'],
            correct_answer: 'X',
          },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      expect(onToolCall).toHaveBeenCalledTimes(2);
      expect(onToolCall.mock.calls[0][0].data.question).toBe('Q1?');
      expect(onToolCall.mock.calls[1][0].data.question).toBe('Q2?');

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const assistantMsg = followUpMessages.find((m: { role: string }) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.toolCalls).toHaveLength(2);
      expect(assistantMsg.toolCalls[0].id).not.toBe(assistantMsg.toolCalls[1].id);

      sendDone();
      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    });
  });

  // ==========================================================================
  // Tool execution: note_mistake (voice mode)
  // ==========================================================================

  describe('tool: note_mistake (voice mode)', () => {
    it('calls onVoiceMistake with the mistake data', async () => {
      const onVoiceMistake = vi.fn();
      const deps = createMockDeps({
        isVoiceMode: () => true,
        onVoiceMistake,
      });
      const agent = createConversationAgent(deps);
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('I speaked wrong', [], callbacks);
      sendChunk('Good effort!');
      sendDone([
        {
          id: 'nm1',
          name: 'note_mistake',
          arguments: {
            word: 'speaked',
            context: 'I speaked wrong',
            correction: 'spoke',
            type: 'grammar',
          },
        },
      ]);

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      expect(onVoiceMistake).toHaveBeenCalledOnce();
      const mistake = onVoiceMistake.mock.calls[0][0] as VoiceMistake;
      expect(mistake.word).toBe('speaked');
      expect(mistake.correction).toBe('spoke');
      expect(mistake.type).toBe('grammar');
    });

    it('does not emit a widget for note_mistake', async () => {
      const onVoiceMistake = vi.fn();
      const deps = createMockDeps({
        isVoiceMode: () => true,
        onVoiceMistake,
      });
      const agent = createConversationAgent(deps);
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendDone([
        {
          id: 'nm1',
          name: 'note_mistake',
          arguments: {
            word: 'bad',
            context: 'sentence',
            correction: 'good',
            type: 'vocabulary',
          },
        },
      ]);

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(onToolCall).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Tool execution: save_memory
  // ==========================================================================

  describe('tool: save_memory', () => {
    it('calls onMemorySaved with the memory content', async () => {
      const onMemorySaved = vi.fn();
      const deps = createMockDeps({
        onMemorySaved,
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMemoryEnabled: true }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('I love cats', [], callbacks);
      sendChunk('Noted!');
      sendDone([
        {
          id: 'sm1',
          name: 'save_memory',
          arguments: { content: 'The learner loves cats' },
        },
      ]);

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(onMemorySaved).toHaveBeenCalledWith('The learner loves cats');
    });

    it('does not emit a widget for save_memory', async () => {
      const onMemorySaved = vi.fn();
      const agent = createConversationAgent(createMockDeps({ onMemorySaved }));
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendDone([
        {
          id: 'sm1',
          name: 'save_memory',
          arguments: { content: 'Some fact' },
        },
      ]);

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(onToolCall).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Tool execution: fetch_url
  // ==========================================================================

  describe('tool: fetch_url', () => {
    it('calls fetchUrl, strips HTML, and injects result into follow-up stream', async () => {
      const htmlContent = '<html><body><h1>Grammar</h1><p>Use て-form for...</p></body></html>';
      mockBridge.generic.fetchUrl.mockResolvedValueOnce({ content: htmlContent });

      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('explain て-form', [], callbacks);
      sendChunk('Let me look that up.');
      sendDone([
        {
          id: 'fu1',
          name: 'fetch_url',
          arguments: { url: 'https://example.com/grammar' },
        },
      ]);

      // Should trigger a follow-up stream
      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.content).toContain('Grammar');
      expect(toolMsg.content).toContain('て-form');
      expect(toolMsg.content).not.toContain('<html>');

      sendDone();
      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('truncates content longer than 3000 chars with truncation notice', async () => {
      const longContent = 'A'.repeat(4000);
      mockBridge.generic.fetchUrl.mockResolvedValueOnce({ content: longContent });

      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('fetch something', [], callbacks);
      sendDone([
        {
          id: 'fu1',
          name: 'fetch_url',
          arguments: { url: 'https://example.com/long' },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('[Content truncated]');
      expect(toolMsg.content.length).toBeLessThan(4000);
    });

    it('returns error message when fetchUrl returns an error', async () => {
      mockBridge.generic.fetchUrl.mockResolvedValueOnce({ error: 'Connection refused', content: '' });

      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('fetch', [], callbacks);
      sendDone([
        {
          id: 'fu1',
          name: 'fetch_url',
          arguments: { url: 'https://example.com' },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('Error fetching URL');
    });
  });

  // ==========================================================================
  // Tool execution: get_media_stats
  // ==========================================================================

  describe('tool: get_media_stats', () => {
    it('returns formatted stats when media context is available', async () => {
      const mediaCtx: ConversationAgentContext = {
        mediaName: 'My Anime',
        mediaType: 'video',
        mediaHash: 'hash123',
        assessedLevel: 3,
        assessedLevelName: 'N3',
        language: 'ja',
        failedWords: [
          { word: '難しい', ease: 1.5, timesSeen: 3, timesHovered: 2 },
        ],
        failedGrammar: [
          { pattern: 'て-form', ease: 2.0, timesFailed: 1 },
        ],
        wordLevelPercentages: {
          entries: [{ level: 3, levelName: 'N3', uniquePercent: 40, occurrencePercent: 35, uniqueCount: 20, occurrenceCount: 50 }],
          totalUnique: 50,
          totalOccurrences: 142,
        },
        grammarLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
      };

      const deps = createMockDeps({ getMediaContext: () => mediaCtx });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('stats?', [], callbacks);
      sendDone([
        {
          id: 'ms1',
          name: 'get_media_stats',
          arguments: {},
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('My Anime');
      expect(toolMsg.content).toContain('難しい');
      expect(toolMsg.content).toContain('て-form');
    });

    it('returns no-media message when context is null', async () => {
      const deps = createMockDeps({ getMediaContext: () => null });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('stats?', [], callbacks);
      sendDone([
        {
          id: 'ms1',
          name: 'get_media_stats',
          arguments: {},
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('No media');
    });
  });

  // ==========================================================================
  // Tool execution: search_wikipedia
  // ==========================================================================

  describe('tool: search_wikipedia', () => {
    it('fetches wikipedia API and returns formatted results in follow-up stream', async () => {
      const wikiResponse = JSON.stringify({
        query: {
          search: [
            {
              title: 'Samurai',
              snippet: '<b>Samurai</b> were warriors of premodern Japan',
            },
          ],
        },
      });
      mockBridge.generic.fetchUrl.mockResolvedValueOnce({ content: wikiResponse });

      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('tell me about samurai', [], callbacks);
      sendDone([
        {
          id: 'sw1',
          name: 'search_wikipedia',
          arguments: { query: 'samurai' },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('Samurai');
      expect(toolMsg.content).toContain('Wikipedia results');

      sendDone();
    });

    it('returns no-results message when search returns empty', async () => {
      const wikiResponse = JSON.stringify({
        query: { search: [] },
      });
      mockBridge.generic.fetchUrl.mockResolvedValueOnce({ content: wikiResponse });

      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('find nothing', [], callbacks);
      sendDone([
        {
          id: 'sw1',
          name: 'search_wikipedia',
          arguments: { query: 'xyznonexistent' },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('No Wikipedia results found');

      sendDone();
    });
  });

  // ==========================================================================
  // Tool execution: search_fandom
  // ==========================================================================

  describe('tool: search_fandom', () => {
    it('fetches fandom wiki and returns results', async () => {
      const fandomResponse = JSON.stringify({
        query: {
          search: [
            {
              title: 'Naruto Uzumaki',
              snippet: 'Main character of the series',
            },
          ],
        },
      });
      mockBridge.generic.fetchUrl.mockResolvedValueOnce({ content: fandomResponse });

      const agentCfg: AgentConfig = {
        id: 'agent1',
        agentName: 'Sensei',
        userName: '',
        personality: 'roleplay',
        roleplayName: 'Naruto',
        roleplayLore: '',
        setupComplete: true,
        roleplayFandomUrl: 'https://naruto.fandom.com',
      };

      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('who is naruto', [], callbacks);
      sendDone([
        {
          id: 'sf1',
          name: 'search_fandom',
          arguments: { query: 'naruto' },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('Naruto Uzumaki');
      expect(toolMsg.content).toContain('Fandom wiki results');

      sendDone();
    });

    it('returns error when no fandom URL is configured', async () => {
      const agentCfg: AgentConfig = {
        id: 'agent1',
        agentName: '',
        userName: '',
        personality: 'casual',
        roleplayName: '',
        roleplayLore: '',
        setupComplete: true,
      };

      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendDone([
        {
          id: 'sf1',
          name: 'search_fandom',
          arguments: { query: 'something' },
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('No Fandom wiki URL configured');

      sendDone();
    });
  });

  // ==========================================================================
  // Tool execution: recall_backstory
  // ==========================================================================

  describe('tool: recall_backstory', () => {
    it('returns the roleplay backstory context', async () => {
      const agentCfg: AgentConfig = {
        id: 'agent1',
        agentName: '',
        userName: '',
        personality: 'roleplay',
        roleplayName: 'Kira',
        roleplayLore: '',
        setupComplete: true,
        roleplayContext: 'I grew up in Osaka and moved to Tokyo at age 10.',
      };

      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('where did you grow up?', [], callbacks);
      sendDone([
        {
          id: 'rb1',
          name: 'recall_backstory',
          arguments: {},
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('Osaka');

      sendDone();
    });

    it('returns no-backstory message when roleplayContext is empty', async () => {
      const agentCfg: AgentConfig = {
        id: 'agent1',
        agentName: '',
        userName: '',
        personality: 'roleplay',
        roleplayName: 'Kira',
        roleplayLore: '',
        setupComplete: true,
      };

      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendDone([
        {
          id: 'rb1',
          name: 'recall_backstory',
          arguments: {},
        },
      ]);

      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2));

      const followUpMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const toolMsg = followUpMessages.find((m: { role: string }) => m.role === 'tool');
      expect(toolMsg.content).toContain('No backstory');

      sendDone();
    });
  });

  // ==========================================================================
  // Tool calls from content parsing
  // ==========================================================================

  describe('parseToolCallsFromContent', () => {
    it('parses tool call in pattern tool_name({ ... }) from content', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      // Simulate LLM that emits tool calls as plain text with parentheses
      sendChunk('Great response! correct_mistake({"corrections":[{"error_span":"go","correction":"went","error_type":"grammar"}]})');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      expect(onToolCall).toHaveBeenCalledOnce();
      expect(onToolCall.mock.calls[0][0].type).toBe('mistake');
    });

    it('parses tool call in pattern tool_name{ ... } (no parentheses) from content', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onToolCall, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendChunk('Response correct_mistake{"error_span":"bad","correction":"good","error_type":"word"}');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      expect(onToolCall).toHaveBeenCalledOnce();
      expect(onToolCall.mock.calls[0][0].type).toBe('mistake');
    });

    it('strips tool call text from visible content', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onChunk, onDone } = createCallbacks();

      agent.processMessage('test', [], callbacks);
      sendChunk('Nice work! correct_mistake({"corrections":[{"error_span":"x","correction":"y","error_type":"typo"}]})');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      // The last onChunk call (from the cleaned content) should not contain the tool call syntax
      const chunkCalls = onChunk.mock.calls;
      const lastChunkContent = chunkCalls[chunkCalls.length - 1]?.[0] as string;
      expect(lastChunkContent).not.toContain('correct_mistake');
    });
  });

  // ==========================================================================
  // System prompt construction
  // ==========================================================================

  describe('buildSystemPrompt', () => {
    it('includes language name in prompt', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('test', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      const sysMsg = messages[0];
      expect(sysMsg.content).toContain('Japanese');
    });

    it('casual personality: uses casual tone instructions', () => {
      const agentCfg: AgentConfig = {
        id: 'a1', agentName: '', userName: '', personality: 'casual',
        roleplayName: '', roleplayLore: '', setupComplete: true,
      };
      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('casual');
    });

    it('polite personality: uses formal tone instructions', () => {
      const agentCfg: AgentConfig = {
        id: 'a1', agentName: '', userName: '', personality: 'polite',
        roleplayName: '', roleplayLore: '', setupComplete: true,
      };
      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('formal');
      expect(messages[0].content).toContain('Polite');
    });

    it('roleplay personality: uses character name in prompt', () => {
      const agentCfg: AgentConfig = {
        id: 'a1', agentName: '', userName: '', personality: 'roleplay',
        roleplayName: 'Sakura', roleplayLore: 'A ninja from Konoha',
        setupComplete: true,
      };
      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('Sakura');
    });

    it('includes media context when provided', () => {
      const mediaCtx: ConversationAgentContext = {
        mediaName: 'Dragon Ball',
        mediaType: 'video',
        mediaHash: 'h1',
        assessedLevel: 2,
        assessedLevelName: 'N2',
        language: 'ja',
        failedWords: [],
        failedGrammar: [],
        wordLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
        grammarLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
      };
      const deps = createMockDeps({ getMediaContext: () => mediaCtx });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('Dragon Ball');
    });

    it('includes target level restriction when targetLevelName is provided', () => {
      const deps = createMockDeps({
        getTargetLevel: () => 3,
        getLevelName: () => 'N3',
        getFrequency: () => null,
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('N3');
      expect(messages[0].content).toContain('Vocabulary Level Restriction');
    });

    it('includes tutor config grammar when provided', () => {
      const tutorConfig: TutorSessionConfig = {
        selectedGrammar: [{ pattern: 'て-form', meaning: 'te-form connector', level: 5 }],
        selectedWords: [],
        selectedMedia: [],
        customInstructions: '',
      };
      const deps = createMockDeps({
        getTutorConfig: () => tutorConfig,
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: false }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('て-form');
      expect(messages[0].content).toContain('Grammar Focus');
    });

    it('includes memories when agentMemoryEnabled is true', () => {
      const memories: AgentMemoryEntry[] = [
        { id: 'm1', agentId: 'a1', content: 'The learner loves cats', timestamp: Date.now() },
      ];
      const deps = createMockDeps({
        getAgentMemories: () => memories,
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMemoryEnabled: true }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('The learner loves cats');
    });

    it('excludes memories when agentMemoryEnabled is false', () => {
      const memories: AgentMemoryEntry[] = [
        { id: 'm1', agentId: 'a1', content: 'Secret fact', timestamp: Date.now() },
      ];
      const deps = createMockDeps({
        getAgentMemories: () => memories,
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMemoryEnabled: false }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).not.toContain('Secret fact');
    });
  });

  // ==========================================================================
  // Voice mode
  // ==========================================================================

  describe('voice mode', () => {
    it('uses voice system prompt when isVoiceMode returns true', () => {
      const deps = createMockDeps({ isVoiceMode: () => true });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('voice conversation');
    });

    it('includes package-declared casual register guidance in voice prompts', () => {
      const deps = createMockDeps({
        isVoiceMode: () => true,
        getLanguage: () => 'ru',
        getLanguageName: () => 'Russian',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          usesLatinScript: false,
          prosodyRenderer: undefined,
          casualRegisterPromptGuidelines: ['Use natural informal second-person singular unless the session asks for formal address.'],
          tutorPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('Russian');
      expect(messages[0].content).toContain('Use natural informal second-person singular unless the session asks for formal address.');
      expect(messages[0].content).not.toContain('deferential');
    });

    it('includes package-declared mistake checker guidance in voice prompts', () => {
      const deps = createMockDeps({
        isVoiceMode: () => true,
        getLanguage: () => 'ar',
        getLanguageName: () => 'Arabic',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          isRTL: true,
          usesLatinScript: false,
          prosodyRenderer: undefined,
          casualRegisterPromptGuidelines: [],
          tutorPromptGuidelines: [],
          mistakeCheckerPromptGuidelines: ['Accept missing short vowel marks when they do not change meaning.'],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('Speech Correction Guidelines');
      expect(messages[0].content).toContain('Accept missing short vowel marks when they do not change meaning.');
    });

    it('includes package-declared shared correction guidance in voice prompts', () => {
      const deps = createMockDeps({
        isVoiceMode: () => true,
        getLanguage: () => 'fa',
        getLanguageName: () => 'Farsi',
        getLanguageFeatures: () => ({
          ...DEFAULT_LANGUAGE_FEATURES,
          supportsDeferentialRegister: false,
          supportsReadings: false,
          isLogographic: false,
          isRTL: true,
          usesLatinScript: false,
          prosodyRenderer: undefined,
          casualRegisterPromptGuidelines: [],
          tutorPromptGuidelines: [],
          correctionPromptGuidelines: ['Accept Arabic-script and Latin transliteration when the session allows script practice.'],
          mistakeCheckerPromptGuidelines: [],
        }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('salam', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('Speech Correction Guidelines');
      expect(messages[0].content).toContain('Accept Arabic-script and Latin transliteration when the session allows script practice.');
    });

    it('uses VOICE_AGENT_TOOLS (note_mistake included, correct_mistake excluded)', () => {
      const deps = createMockDeps({ isVoiceMode: () => true });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      const [, tools] = mockBridge.llm.llmStream.mock.calls[0];
      const toolNames = (tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('note_mistake');
      expect(toolNames).not.toContain('correct_mistake');
    });

    it('uses text-mode tools (correct_mistake included, note_mistake excluded)', () => {
      const deps = createMockDeps({
        isVoiceMode: () => false,
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: false }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      const [, tools] = mockBridge.llm.llmStream.mock.calls[0];
      const toolNames = (tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).toContain('correct_mistake');
      expect(toolNames).not.toContain('note_mistake');
    });

    it('builds voice system prompt with media context', () => {
      const mediaCtx: ConversationAgentContext = {
        mediaName: 'Attack on Titan',
        mediaType: 'video',
        mediaHash: 'h1',
        assessedLevel: null,
        assessedLevelName: '',
        language: 'ja',
        failedWords: [{ word: '巨人', ease: 1.2, timesSeen: 5, timesHovered: 1 }],
        failedGrammar: [],
        wordLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
        grammarLevelPercentages: { entries: [], totalUnique: 0, totalOccurrences: 0 },
      };
      const deps = createMockDeps({
        isVoiceMode: () => true,
        getMediaContext: () => mediaCtx,
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [messages] = mockBridge.llm.llmStream.mock.calls[0];
      expect(messages[0].content).toContain('Attack on Titan');
      expect(messages[0].content).toContain('巨人');
    });
  });

  // ==========================================================================
  // Level adaptation
  // ==========================================================================

  describe('level adaptation (findDifficultWords)', () => {
    it('triggers reformulation when tokens exceed target level', async () => {
      const hardTokens: Token[] = [
        { word: '難解', actual_word: '難解', type: '形容動詞' },
      ];
      const easyTokens: Token[] = [
        { word: '簡単', actual_word: '簡単', type: '形容動詞' },
      ];
      mockBackend.tokenize.mockResolvedValueOnce(hardTokens).mockResolvedValue(easyTokens);

      const getFrequency = vi.fn((word: string): WordFrequencyEntry | null => {
        if (word === '難解') return { level: 'N1', raw_level: 1, reading: '難解' };
        if (word === '簡単') return { level: 'N5', raw_level: 5, reading: '簡単' };
        return null;
      });

      const deps = createMockDeps({
        getTargetLevel: () => 3,
        getLevelName: () => 'N3',
        getFrequency,
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: false }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hi', [], callbacks);
      sendChunk('難解な問題');
      sendDone();

      // The reformulation call should trigger a second llmStream call
      await vi.waitFor(() => expect(mockBridge.llm.llmStream).toHaveBeenCalledTimes(2), { timeout: 3000 });

      const reformulationMessages = mockBridge.llm.llmStream.mock.calls[1][0];
      const userMsg = reformulationMessages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg.content).toContain('難解');

      // Simulate the reformulation completing
      sendChunk('簡単な問題');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('does not trigger reformulation when no difficult words found', async () => {
      const mockTokens: Token[] = [
        { word: '犬', actual_word: '犬', type: '名詞' },
      ];
      mockBackend.tokenize.mockResolvedValue(mockTokens);

      const getFrequency = vi.fn((): WordFrequencyEntry | null => ({
        level: 'N5', raw_level: 5, reading: '犬',
      }));

      const deps = createMockDeps({
        getTargetLevel: () => 3,
        getLevelName: () => 'N3',
        getFrequency,
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: false }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hi', [], callbacks);
      sendChunk('犬');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
      // Only one stream call — no reformulation needed
      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Timeout handling
  // ==========================================================================

  describe('timeout (90 seconds)', () => {
    it('calls onError with timeout message when no content arrives within 90s', async () => {
      vi.useFakeTimers();

      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onError } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      vi.advanceTimersByTime(90_000);

      expect(onError).toHaveBeenCalledWith('Response timed out');

      vi.useRealTimers();
    });

    it('finalizes with accumulated content when partial response times out', async () => {
      vi.useFakeTimers();

      mockBackend.tokenize.mockResolvedValue([]);

      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('Partial response');

      await vi.advanceTimersByTimeAsync(90_000);

      // onDone should be called with the partial content
      expect(onDone).toHaveBeenCalledWith(
        expect.stringContaining('Partial response'),
        undefined,
        undefined,
        undefined,
      );

      vi.useRealTimers();
    });
  });

  // ==========================================================================
  // Disabled tools
  // ==========================================================================

  describe('disabled tools', () => {
    it('excludes correct_mistake tool when agentMistakeChecker is enabled', () => {
      const deps = createMockDeps({
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMistakeChecker: true }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [, tools] = mockBridge.llm.llmStream.mock.calls[0];
      const toolNames = (tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).not.toContain('correct_mistake');
    });

    it('excludes save_memory tool when agentMemoryEnabled is false', () => {
      const deps = createMockDeps({
        getSettings: () => ({ ...DEFAULT_SETTINGS, agentMemoryEnabled: false }),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [, tools] = mockBridge.llm.llmStream.mock.calls[0];
      const toolNames = (tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).not.toContain('save_memory');
    });

    it('excludes search_fandom when no fandom URL is configured', () => {
      const agentCfg: AgentConfig = {
        id: 'a1', agentName: '', userName: '', personality: 'casual',
        roleplayName: '', roleplayLore: '', setupComplete: true,
      };
      const deps = createMockDeps({ getAgentConfig: () => agentCfg });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [, tools] = mockBridge.llm.llmStream.mock.calls[0];
      const toolNames = (tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).not.toContain('search_fandom');
    });

    it('respects user-disabled tools set', () => {
      const deps = createMockDeps({
        getDisabledTools: () => new Set(['fetch_url', 'search_wikipedia']),
      });
      const agent = createConversationAgent(deps);
      const { callbacks } = createCallbacks();

      agent.processMessage('hi', [], callbacks);

      const [, tools] = mockBridge.llm.llmStream.mock.calls[0];
      const toolNames = (tools as Array<{ name: string }>).map((t) => t.name);
      expect(toolNames).not.toContain('fetch_url');
      expect(toolNames).not.toContain('search_wikipedia');
    });
  });

  // ==========================================================================
  // Stream stats
  // ==========================================================================

  describe('stream stats', () => {
    it('passes stream stats to onDone', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('こんにちは');
      streamCallback({ done: true, evalCount: 50, evalDuration: 2_000_000_000 });

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      const streamStats = onDone.mock.calls[0][3];
      expect(streamStats).toBeDefined();
      expect(streamStats.totalTime).toBeGreaterThanOrEqual(0);
      expect(streamStats.tokensPerSecond).toBeCloseTo(25, 0);
    });
  });

  // ==========================================================================
  // Error propagation
  // ==========================================================================

  describe('error handling', () => {
    it('calls onError and does not call onDone on stream error', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onError, onDone } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendError('LLM backend crashed');

      expect(onError).toHaveBeenCalledWith('LLM backend crashed');
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  describe('history management', () => {
    it('getHistory returns messages after processMessage', () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks } = createCallbacks();

      agent.processMessage('hello', [], callbacks);

      const history = agent.getHistory();
      const userMsg = history.find((m) => m.role === 'user');
      expect(userMsg?.content).toBe('hello');
    });

    it('loadHistory restores previous conversation state', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('response');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      const savedHistory = agent.getHistory();

      const newAgent = createConversationAgent(createMockDeps());
      newAgent.loadHistory(savedHistory);

      expect(newAgent.getHistory()).toEqual(savedHistory);
    });

    it('clearHistory resets both internal and display history', async () => {
      const agent = createConversationAgent(createMockDeps());
      const { callbacks, onDone } = createCallbacks();

      agent.processMessage('hello', [], callbacks);
      sendChunk('response');
      sendDone();

      await vi.waitFor(() => expect(onDone).toHaveBeenCalled());

      agent.clearHistory();
      expect(agent.getHistory()).toEqual([]);
    });
  });

  describe('context compaction', () => {
    it('does nothing when under token limit', () => {
      const agent = createConversationAgent(createMockDeps());
      const history: LLMChatMessage[] = [
        { role: 'user', content: 'short message' },
        { role: 'assistant', content: 'short reply' },
      ];

      agent.loadHistory(history);
      agent.compactHistory(16000);

      expect(agent.getHistory()).toEqual(history);
    });

    it('removes oldest user+assistant pairs when over limit', () => {
      const agent = createConversationAgent(createMockDeps());
      const longContent = 'a'.repeat(16000);
      const history: LLMChatMessage[] = [
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
      ];

      agent.loadHistory(history);
      agent.compactHistory(16000);

      const result = agent.getHistory();
      expect(result.length).toBe(4);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe(longContent);
      expect(result[1].role).toBe('assistant');
      expect(result[2].role).toBe('user');
      expect(result[3].role).toBe('assistant');
    });

    it('uses language metadata when estimating history size for compaction', () => {
      const compactScriptLanguage: LanguageData = {
        name: 'Georgian compact test',
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: ['Geor'] },
          wordIndexStrategy: {
            type: 'character-containment',
          },
        },
      };
      const agent = createConversationAgent(createMockDeps({
        getLanguage: () => 'ka',
        getLanguageData: () => compactScriptLanguage,
      }));
      const compactContent = 'ა'.repeat(15);
      const history: LLMChatMessage[] = [
        { role: 'user', content: compactContent },
        { role: 'assistant', content: compactContent },
        { role: 'user', content: compactContent },
        { role: 'assistant', content: compactContent },
      ];

      agent.loadHistory(history);
      agent.compactHistory(35);

      expect(agent.getHistory()).toEqual(history.slice(2));
    });

    it('preserves the most recent exchange during compaction', () => {
      const agent = createConversationAgent(createMockDeps());
      const longContent = 'a'.repeat(50000);
      const history: LLMChatMessage[] = [
        { role: 'user', content: longContent },
        { role: 'assistant', content: longContent },
      ];

      agent.loadHistory(history);
      agent.compactHistory(16000);

      const result = agent.getHistory();
      expect(result.length).toBe(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });
  });
});
