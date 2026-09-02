import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMChatMessage, LLMStreamChunk } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { createConversationAgent } from '../../services/conversationAgent';
import type { LanguageFeatures } from '../../context/LanguageContext';
import { createVoicePrefetch } from './voicePrefetch';

// ============================================================================
// Agent harness (mirrors conversationAgent.test.ts)
// ============================================================================

const mockBridge = {
  llm: {
    onLLMStreamChunk: vi.fn((_cb: (chunk: LLMStreamChunk) => void) => () => {}),
    llmStream: vi.fn(),
    llmStreamAbort: vi.fn(),
  },
};

vi.mock('../../../shared/bridges', () => ({ getBridge: () => mockBridge }));

const mockBackend = { tokenize: vi.fn().mockResolvedValue([]) };
vi.mock('../../../shared/backends', () => ({ getBackend: () => mockBackend }));

const DEFAULT_LANGUAGE_FEATURES: LanguageFeatures = {
  supportsReadings: true,
  prosodyRenderer: 'japanese-pitch-accent',
  supportsProsody: true,
  isLogographic: true,
  isRTL: false,
  supportsColorCodes: true,
  supportsOcrRamSaver: false,
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
    providesMorphology: true,
    allowsRoughFallback: false,
  },
  casualRegisterPromptGuidelines: [],
  tutorPromptGuidelines: [],
  correctionPromptGuidelines: [],
  mistakeCheckerPromptGuidelines: [],
};

type AgentDeps = Parameters<typeof createConversationAgent>[0];

function createVoiceDeps(overrides?: Partial<AgentDeps>): AgentDeps {
  return {
    getSettings: () => ({ ...DEFAULT_SETTINGS }),
    getLanguage: () => 'ja',
    getLanguageName: () => 'Japanese',
    getLanguageFeatures: () => DEFAULT_LANGUAGE_FEATURES,
    getMediaContext: () => null,
    flashcardCtx: {
      trackGrammarFailed: () => {},
      trackGrammarEncountered: () => {},
    },
    isVoiceMode: () => true,
    ...overrides,
  };
}

/** Run one turn and return the system prompt sent to the LLM. */
function sendPrompt(deps: AgentDeps, message: string): string {
  createConversationAgent(deps).processMessage(message, [], {
    onChunk: () => {},
    onToolCall: () => {},
    onDone: () => {},
    onError: () => {},
  });
  const calls = mockBridge.llm.llmStream.mock.calls;
  const messages = calls[calls.length - 1][0] as LLMChatMessage[];
  return messages[0].content;
}

const SAFETY_MARKER = '### INSTRUCTION PRIORITY';
const REMEMBERED_CONTEXT_MARKER = 'JOURNAL_MEMORY_MARKER';

// ============================================================================
// createVoicePrefetch
// ============================================================================

describe('createVoicePrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the cached compile when the final matches the last partial', () => {
    const compile = vi.fn((text: string) => `ctx:${text}`);
    const prefetch = createVoicePrefetch(compile);

    prefetch.onPartial('what did you do today');
    const resolved = prefetch.resolveFinal('what did you do today');

    expect(resolved).toBe('ctx:what did you do today');
    expect(compile).toHaveBeenCalledTimes(1);
    expect(prefetch.lastStats()).toEqual({ cacheHit: true, compileMs: 0 });
  });

  it('reuses the cache when the final matches after token normalization', () => {
    const compile = vi.fn((text: string) => `ctx:${text}`);
    const prefetch = createVoicePrefetch(compile);

    prefetch.onPartial('Hello there, how are you?');
    prefetch.resolveFinal('hello there how are you');

    expect(compile).toHaveBeenCalledTimes(1);
    expect(prefetch.lastStats().cacheHit).toBe(true);
  });

  it('recompiles when the final differs from the cached partial', () => {
    const compile = vi.fn((text: string) => `ctx:${text}`);
    const prefetch = createVoicePrefetch(compile);

    prefetch.onPartial('what did you do today');
    const resolved = prefetch.resolveFinal('completely different words here');

    expect(resolved).toBe('ctx:completely different words here');
    expect(compile).toHaveBeenCalledTimes(2);
    expect(prefetch.lastStats().cacheHit).toBe(false);
  });

  it('never compiles for partials shorter than 8 characters', () => {
    const compile = vi.fn((text: string) => `ctx:${text}`);
    const prefetch = createVoicePrefetch(compile);

    prefetch.onPartial('hi');
    prefetch.onPartial('hi ther');

    expect(compile).not.toHaveBeenCalled();
    expect(prefetch.lastStats()).toEqual({ cacheHit: false, compileMs: 0 });

    prefetch.onPartial('hi there');
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('compiles once when a partial repeats the last compiled input', () => {
    const compile = vi.fn((text: string) => `ctx:${text}`);
    const prefetch = createVoicePrefetch(compile);

    prefetch.onPartial('and then what happened next');
    prefetch.onPartial('and then what happened next');

    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('compiles synchronously when resolving a final with no prior partial', () => {
    const compile = vi.fn((text: string) => `ctx:${text}`);
    const prefetch = createVoicePrefetch(compile);

    expect(prefetch.resolveFinal('a fresh final transcript')).toBe('ctx:a fresh final transcript');
    expect(compile).toHaveBeenCalledTimes(1);
    // A real compile ran, so this is by definition a miss (compileMs is a
    // wall-clock measurement — assert the flag, not an exact zero).
    expect(prefetch.lastStats().cacheHit).toBe(false);
  });

  it('partitions the cache by scope so one participant never reuses another view', () => {
    const compile = vi.fn((text: string, scopeId: string) => `ctx:${scopeId}:${text}`);
    const prefetch = createVoicePrefetch(compile);

    prefetch.onPartial('what did you do today', 'p1');
    // Same scope: the speculative work pays off.
    expect(prefetch.resolveFinal('what did you do today', 'p1')).toBe('ctx:p1:what did you do today');
    expect(prefetch.lastStats().cacheHit).toBe(true);

    // A different participant's view must be its own compile — p1's cached
    // output is not reusable across scopes.
    expect(prefetch.resolveFinal('what did you do today', 'p2')).toBe('ctx:p2:what did you do today');
    expect(compile).toHaveBeenCalledTimes(2);
    expect(prefetch.lastStats().cacheHit).toBe(false);
  });

  it('invalidates cached speculative work when the world version changes', () => {
    const compile = vi.fn((text: string) => `ctx:${text}`);
    let worldVersion = '0';
    const prefetch = createVoicePrefetch(compile, () => worldVersion);

    prefetch.onPartial('what did you do today', 'p1');
    worldVersion = '1'; // a memory was journaled mid-utterance
    const resolved = prefetch.resolveFinal('what did you do today', 'p1');

    expect(resolved).toBe('ctx:what did you do today');
    expect(compile).toHaveBeenCalledTimes(2);
    expect(prefetch.lastStats().cacheHit).toBe(false);
  });
});

// ============================================================================
// Voice world-context prompt
// ============================================================================

describe('voice world-context prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends Remembered Context before the safety instructions when the dep is provided', () => {
    const getVoiceWorldContext = vi.fn(() => REMEMBERED_CONTEXT_MARKER);
    const prompt = sendPrompt(createVoiceDeps({ getVoiceWorldContext }), 'hello');

    expect(getVoiceWorldContext).toHaveBeenCalledWith('hello');
    expect(prompt).toContain('## Remembered Context');
    expect(prompt).toContain(REMEMBERED_CONTEXT_MARKER);
    const contextIdx = prompt.indexOf('## Remembered Context');
    const safetyIdx = prompt.indexOf(SAFETY_MARKER);
    expect(contextIdx).toBeGreaterThan(-1);
    expect(safetyIdx).toBeGreaterThan(contextIdx);
    expect(prompt.trimEnd().endsWith('conflicting character description.')).toBe(true);
  });

  it('omits Remembered Context when the dep is absent', () => {
    const prompt = sendPrompt(createVoiceDeps(), 'hello');

    expect(prompt).not.toContain('## Remembered Context');
    expect(prompt).toContain(SAFETY_MARKER);
  });

  it('keeps the prompt byte-identical when the dep returns nothing usable', () => {
    const withoutDep = sendPrompt(createVoiceDeps(), 'hello');
    const emptyDep = sendPrompt(createVoiceDeps({ getVoiceWorldContext: () => '   ' }), 'hello');

    expect(emptyDep).toBe(withoutDep);
  });

  it('does not call getVoiceWorldContext in text mode', () => {
    const getVoiceWorldContext = vi.fn(() => REMEMBERED_CONTEXT_MARKER);
    const prompt = sendPrompt(createVoiceDeps({ isVoiceMode: () => false, getVoiceWorldContext }), 'hello');

    expect(getVoiceWorldContext).not.toHaveBeenCalled();
    expect(prompt).not.toContain('## Remembered Context');
  });
});
