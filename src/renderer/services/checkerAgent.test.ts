// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMStreamChunk } from '../../shared/types';

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
  },
};

vi.mock('../../shared/bridges', () => ({
  getBridge: () => mockBridge,
}));

describe('checkerAgent', () => {
  beforeEach(() => {
    vi.resetModules();
    streamCallback = null;
    mockCleanup.mockClear();
    mockBridge.llm.onLLMStreamChunk.mockClear();
    mockBridge.llm.llmStream.mockClear();
    mockBridge.llm.llmStreamAbort.mockClear();

    mockBridge.llm.onLLMStreamChunk.mockImplementation((cb: (chunk: LLMStreamChunk) => void) => {
      streamCallback = cb;
      return mockCleanup;
    });
  });

  describe('createCheckerAgent', () => {
    it('returns an object with checkMessage and abort', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();
      expect(typeof agent.checkMessage).toBe('function');
      expect(typeof agent.abort).toBe('function');
    });
  });

  describe('checkMessage', () => {
    it('registers stream listener and calls llmStream', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Hello', 'German');

      expect(mockBridge.llm.onLLMStreamChunk).toHaveBeenCalledOnce();
      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();

      streamCallback!({ done: true });
      await promise;
    });

    it('passes system prompt with language name and user text to llmStream', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Ich bin gehen', 'German');
      streamCallback!({ done: true });
      await promise;

      const [messages] = mockBridge.llm.llmStream.mock.calls[0] as [{ role: string; content: string }[], unknown];
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('German');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Ich bin gehen');
    });

    it('resolves with corrections from structured tool calls', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Ich bin gehen', 'German');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [
              {
                error_span: 'bin gehen',
                correction: 'gehe',
                error_type: 'grammar',
              },
            ],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;

      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0]).toMatchObject({
        errorSpan: 'bin gehen',
        correction: 'gehe',
        errorType: 'grammar',
        userMessageIndex: -1,
        source: 'checker',
      });
      expect(result.safety).toBeNull();
    });

    it('resolves with safety from structured tool calls', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('I want to hurt myself', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'flag_self_harm_risk',
          arguments: {
            category: 'self-harm',
            severity: 'urgent',
            flagged_span: 'hurt myself',
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;

      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toMatchObject({
        category: 'self-harm',
        severity: 'urgent',
        flaggedSpan: 'hurt myself',
        source: 'checker',
      });
    });

    it('routes shorthand-like input through the checker stream instead of a local phrase list', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('kms', 'English');

      expect(mockBridge.llm.llmStream).toHaveBeenCalledOnce();

      streamCallback!({ done: true });

      const result = await promise;

      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toBeNull();
    });

    it('ignores safety tool calls that are not grounded in the reviewed message', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Hello, nice to meet you.', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'flag_self_harm_risk',
          arguments: {
            category: 'self-harm-related',
            severity: 'concern',
            flagged_span: 'hurt myself',
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.safety).toBeNull();
    });

    it('ignores mark_safe tool calls and keeps the result unflagged', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Hello there.', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'mark_safe',
          arguments: {},
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toBeNull();
    });

    it('resolves with empty corrections when no tool call and no content', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('This is fine.', 'English');

      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toBeNull();
    });

    it('resolves with empty corrections on error chunk', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Test', 'English');

      streamCallback!({ error: 'LLM failed' });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toBeNull();
    });

    it('collects multiple corrections from a single tool call', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('I goed to store', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [
              { error_span: 'goed', correction: 'went', error_type: 'grammar' },
              { error_span: 'to store', correction: 'to the store', error_type: 'grammar' },
            ],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(2);
    });

    it('accumulates content chunks across multiple content events', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('test input', 'English');

      streamCallback!({ content: 'suggest_corrections(' });
      streamCallback!({ content: JSON.stringify({ corrections: [{ error_span: 'test input', correction: 'test output', error_type: 'word' }] }) });
      streamCallback!({ content: ')' });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0].errorSpan).toBe('test input');
    });

    it('falls back to text-content parsing when no structured tool calls', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const jsonPayload = JSON.stringify({
        corrections: [
          { error_span: 'goed', correction: 'went', error_type: 'grammar' },
        ],
      });
      const content = `suggest_corrections(${jsonPayload})`;

      const promise = agent.checkMessage('I goed', 'English');

      streamCallback!({ content });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(1);
      expect(result.corrections[0].errorSpan).toBe('goed');
      expect(result.safety).toBeNull();
    });

    it('falls back to inline safety tool-call parsing when no structured tool calls', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const jsonPayload = JSON.stringify({
        category: 'self-harm-related',
        severity: 'concern',
        flagged_span: 'I do not want to be here anymore',
      });
      const promise = agent.checkMessage('I do not want to be here anymore', 'English');

      streamCallback!({ content: `flag_self_harm_risk(${jsonPayload})` });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toMatchObject({
        category: 'self-harm-related',
        severity: 'concern',
        flaggedSpan: 'I do not want to be here anymore',
      });
    });

    it('treats inline mark_safe output as unflagged', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Hello there', 'English');

      streamCallback!({ content: 'mark_safe({})' });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toBeNull();
    });

    it('omits correction tools for assistant safety-only scans', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Please tell me how to hurt myself', 'English', undefined, {
        speakerRole: 'assistant',
        includeCorrections: false,
      });

      const [, tools] = mockBridge.llm.llmStream.mock.calls[0] as [unknown, Array<{ name: string }>];
      expect(tools.map((tool) => tool.name)).toEqual(['flag_self_harm_risk', 'mark_safe']);

      streamCallback!({ done: true });
      await promise;
    });

    it('cleans up stream listener after done', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Test', 'English');
      streamCallback!({ done: true });
      await promise;

      expect(mockCleanup).toHaveBeenCalledOnce();
    });

    it('cleans up stream listener after error chunk', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Test', 'English');
      streamCallback!({ error: 'fail' });
      await promise;

      expect(mockCleanup).toHaveBeenCalledOnce();
    });
  });

  describe('abort', () => {
    it('calls llmStreamAbort', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      agent.abort();

      expect(mockBridge.llm.llmStreamAbort).toHaveBeenCalledOnce();
    });

    it('prevents chunk processing after abort is called', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Test', 'English');

      agent.abort();

      const toolChunk: LLMStreamChunk = {
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [{ error_span: 'Test', correction: 'test', error_type: 'typo' }],
          },
        }],
      };

      streamCallback!(toolChunk);

      const sentinel = Symbol('not_resolved');
      const raceResult = await Promise.race([
        promise,
        Promise.resolve(sentinel),
      ]);

      expect(raceResult).toBe(sentinel);
    });

    it('resolves with empty corrections when done chunk arrives and aborted flag set via checkMessage reset', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise1 = agent.checkMessage('Test', 'English');
      streamCallback!({ done: true });
      await promise1;

      const promise2 = agent.checkMessage('Test again', 'English');
      agent.abort();

      const sentinel = Symbol('not_resolved');
      const raceResult = await Promise.race([
        promise2,
        Promise.resolve(sentinel),
      ]);

      expect(raceResult).toBe(sentinel);
    });
  });

  describe('parseToolCallsFromContent (via checkMessage)', () => {
    it('parses suggest_corrections with parentheses pattern', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const args = { corrections: [{ error_span: 'hav', correction: 'have', error_type: 'typo' }] };
      const content = `suggest_corrections(${JSON.stringify(args)})`;

      const promise = agent.checkMessage('I hav a problem', 'English');
      streamCallback!({ content });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections[0].errorSpan).toBe('hav');
      expect(result.corrections[0].correction).toBe('have');
    });

    it('falls back to no-parentheses pattern when parentheses pattern fails and produces no corrections for nested JSON', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const args = { corrections: [{ error_span: 'comming', correction: 'coming', error_type: 'typo' }] };
      const contentWithoutParens = `suggest_corrections\n${JSON.stringify(args)}`;

      const promise = agent.checkMessage('I am comming home', 'English');
      streamCallback!({ content: contentWithoutParens });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
      expect(result.safety).toBeNull();
    });

    it('ignores malformed JSON in content', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const content = 'suggest_corrections({invalid json here})';

      const promise = agent.checkMessage('test', 'English');
      streamCallback!({ content });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
    });
  });

  describe('parseCorrectionEntry (via checkMessage)', () => {
    it('returns null when error_span is missing', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('test', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [{ correction: 'went', error_type: 'grammar' }],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
    });

    it('returns null when correction is missing', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('test', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [{ error_span: 'goed', error_type: 'grammar' }],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
    });

    it('includes optional fields when present', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('she go to store every day', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [
              {
                error_span: 'go',
                correction: 'goes',
                error_type: 'grammar',
                context_before: 'she ',
                context_after: ' to store',
                alternatives: ['walks'],
              },
            ],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections[0].contextBefore).toBe('she ');
      expect(result.corrections[0].contextAfter).toBe(' to store');
      expect(result.corrections[0].alternatives).toEqual(['walks']);
    });

    it('omits alternatives when array is empty', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('test', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [{ error_span: 'tset', correction: 'test', error_type: 'typo', alternatives: [] }],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections[0].alternatives).toBeUndefined();
    });

    it('defaults errorType to other when not provided', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('test', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'suggest_corrections',
          arguments: {
            corrections: [{ error_span: 'tset', correction: 'test' }],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections[0].errorType).toBe('other');
    });
  });

  describe('buildCheckerPrompt (via checkMessage)', () => {
    it('includes the language name in the system prompt', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Test', 'Japanese');
      streamCallback!({ done: true });
      await promise;

      const [messages] = mockBridge.llm.llmStream.mock.calls[0] as [{ role: string; content: string }[], unknown];
      expect(messages[0].content).toContain('Japanese');
    });

    it('appends custom instructions when provided', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Test', 'French', 'Be strict about subjunctive usage.');
      streamCallback!({ done: true });
      await promise;

      const [messages] = mockBridge.llm.llmStream.mock.calls[0] as [{ role: string; content: string }[], unknown];
      expect(messages[0].content).toContain('Be strict about subjunctive usage.');
    });

    it('does not include session instructions section when customInstructions is undefined', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('Test', 'French');
      streamCallback!({ done: true });
      await promise;

      const [messages] = mockBridge.llm.llmStream.mock.calls[0] as [{ role: string; content: string }[], unknown];
      expect(messages[0].content).not.toContain('Session Instructions');
    });

    it('ignores tool calls for names other than suggest_corrections', async () => {
      const { createCheckerAgent } = await import('./checkerAgent');
      const agent = createCheckerAgent();

      const promise = agent.checkMessage('test', 'English');

      streamCallback!({
        toolCalls: [{
          id: 'tc1',
          name: 'unknown_tool',
          arguments: {
            corrections: [{ error_span: 'test', correction: 'Test', error_type: 'typo' }],
          },
        }],
      });
      streamCallback!({ done: true });

      const result = await promise;
      expect(result.corrections).toHaveLength(0);
    });
  });

});
