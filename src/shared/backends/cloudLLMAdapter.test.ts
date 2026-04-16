import { CloudLLMAdapter } from './cloudLLMAdapter';
import type { LLMChatMessage, LLMToolDefinition, LLMStreamChunk } from '../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createSSEResponse(lines: string[]): Response {
  const text = lines.join('\n') + '\n';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function makeCallbacks() {
  return {
    onChunk: vi.fn<[LLMStreamChunk], void>(),
    onDone: vi.fn<[], void>(),
    onError: vi.fn<[string], void>(),
  };
}

const baseMessages: LLMChatMessage[] = [
  { role: 'user', content: 'Hello' },
];

const baseTools: LLMToolDefinition[] = [];

describe('CloudLLMAdapter', () => {
  describe('constructor', () => {
    it('strips trailing slashes from baseUrl', async () => {
      const adapter = new CloudLLMAdapter('https://example.com///', 'token');
      mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
      const cb = makeCallbacks();
      await adapter.streamChat(baseMessages, baseTools, cb);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://example.com/api/llm/stream');
    });

    it('strips single trailing slash', async () => {
      const adapter = new CloudLLMAdapter('https://example.com/', 'token');
      mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
      const cb = makeCallbacks();
      await adapter.streamChat(baseMessages, baseTools, cb);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe('https://example.com/api/llm/stream');
    });
  });

  describe('streamChat', () => {
    describe('request construction', () => {
      it('sends POST to ${baseUrl}/api/llm/stream', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', 'tok');
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.example.com/api/llm/stream',
          expect.objectContaining({ method: 'POST' }),
        );
      });

      it('includes Authorization header when authToken is provided', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', 'my-secret');
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-secret');
      });

      it('omits Authorization header when authToken is empty', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
      });

      it('sends Content-Type: application/json', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      });
    });

    describe('toOpenAIMessages conversion', () => {
      it('sends messages in OpenAI format', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const messages: LLMChatMessage[] = [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ];
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(messages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(init.body as string);
        expect(body.messages).toEqual([
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ]);
      });

      it('converts toolCalls to tool_calls with stringified object arguments', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const messages: LLMChatMessage[] = [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call_1', name: 'myFunc', arguments: { key: 'value' } },
            ],
          },
        ];
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(messages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(init.body as string);
        expect(body.messages[0].tool_calls).toEqual([
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'myFunc', arguments: '{"key":"value"}' },
          },
        ]);
      });

      it('keeps tool_calls arguments as string when already a string', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const messages: LLMChatMessage[] = [
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call_2', name: 'fn', arguments: '{"already":"string"}' as unknown as Record<string, unknown> },
            ],
          },
        ];
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(messages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(init.body as string);
        expect(body.messages[0].tool_calls[0].function.arguments).toBe('{"already":"string"}');
      });

      it('converts tool role message with toolName to tool_call_id', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const messages: LLMChatMessage[] = [
          { role: 'tool', content: 'result', toolName: 'call_abc' },
        ];
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(messages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(init.body as string);
        expect(body.messages[0].tool_call_id).toBe('call_abc');
      });

      it('does not add tool_calls key for messages without toolCalls', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(init.body as string);
        expect(body.messages[0].tool_calls).toBeUndefined();
      });
    });

    describe('toOpenAITools conversion', () => {
      it('sends tools in OpenAI format', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const tools: LLMToolDefinition[] = [
          {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: {} },
          },
        ];
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, tools, cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(init.body as string);
        expect(body.tools).toEqual([
          {
            type: 'function',
            function: {
              name: 'search',
              description: 'Search the web',
              parameters: { type: 'object', properties: {} },
            },
          },
        ]);
      });

      it('omits tools key when tools array is empty', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, [], cb);
        const init = mockFetch.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(init.body as string);
        expect(body.tools).toBeUndefined();
      });
    });

    describe('SSE parsing — OpenAI format', () => {
      it('parses delta.content and calls onChunk with content', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] });
        mockFetch.mockResolvedValue(createSSEResponse([line, 'data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello' }));
      });

      it('parses [DONE] → calls onChunk({done:true}) and onDone', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith({ done: true });
        expect(cb.onDone).toHaveBeenCalledOnce();
      });

      it('parses finish_reason:stop → chunk.done = true', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const line = 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        mockFetch.mockResolvedValue(createSSEResponse([line]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith(expect.objectContaining({ done: true }));
        expect(cb.onDone).toHaveBeenCalledOnce();
      });

      it('parses tool_calls delta → chunk.toolCalls', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const event = {
          choices: [{
            delta: {
              tool_calls: [{
                id: 'tc_1',
                function: { name: 'doThing', arguments: '{"x":1}' },
              }],
            },
          }],
        };
        const line = 'data: ' + JSON.stringify(event);
        mockFetch.mockResolvedValue(createSSEResponse([line, 'data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        const chunkCall = cb.onChunk.mock.calls.find(c => c[0].toolCalls !== undefined);
        expect(chunkCall).toBeDefined();
        expect(chunkCall![0].toolCalls).toEqual([
          { id: 'tc_1', name: 'doThing', arguments: { x: 1 } },
        ]);
      });

      it('buffers partial tool_call argument fragments until the JSON is complete', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const lines = [
          'data: ' + JSON.stringify({
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'tc_streamed',
                  function: {
                    name: 'show_translation',
                    arguments: '{"phrase":"Bonjour le monde",',
                  },
                }],
              },
            }],
          }),
          'data: ' + JSON.stringify({
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: {
                    arguments: '"translation":"Hello world"}',
                  },
                }],
              },
            }],
          }),
          'data: [DONE]',
        ];

        mockFetch.mockResolvedValue(createSSEResponse(lines));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);

        const toolCallChunks = cb.onChunk.mock.calls.filter(c => c[0].toolCalls !== undefined);
        expect(toolCallChunks).toHaveLength(1);
        expect(toolCallChunks[0][0].toolCalls).toEqual([
          {
            id: 'tc_streamed',
            name: 'show_translation',
            arguments: {
              phrase: 'Bonjour le monde',
              translation: 'Hello world',
            },
          },
        ]);
      });

      it('handles tool_calls with empty arguments string', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const event = {
          choices: [{
            delta: {
              tool_calls: [{
                id: 'tc_2',
                function: { name: 'fn', arguments: '' },
              }],
            },
          }],
        };
        const line = 'data: ' + JSON.stringify(event);
        mockFetch.mockResolvedValue(createSSEResponse([line, 'data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        const chunkCall = cb.onChunk.mock.calls.find(c => c[0].toolCalls !== undefined);
        expect(chunkCall![0].toolCalls![0].arguments).toEqual({});
      });
    });

    describe('SSE parsing — direct mLearn format', () => {
      it('parses top-level content field', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const line = 'data: ' + JSON.stringify({ content: 'Hi there', done: false });
        mockFetch.mockResolvedValue(createSSEResponse([line, 'data: [DONE]']));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hi there' }));
      });

      it('parses top-level done:true → calls onDone', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const line = 'data: ' + JSON.stringify({ done: true });
        mockFetch.mockResolvedValue(createSSEResponse([line]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith(expect.objectContaining({ done: true }));
        expect(cb.onDone).toHaveBeenCalledOnce();
      });
    });

    describe('SSE parsing — stats', () => {
      it('parses eval_count → chunk.evalCount', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const line = 'data: ' + JSON.stringify({ eval_count: 42, done: true });
        mockFetch.mockResolvedValue(createSSEResponse([line]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith(expect.objectContaining({ evalCount: 42 }));
      });

      it('parses eval_duration → chunk.evalDuration', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const line = 'data: ' + JSON.stringify({ eval_duration: 123456789, done: true });
        mockFetch.mockResolvedValue(createSSEResponse([line]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith(expect.objectContaining({ evalDuration: 123456789 }));
      });
    });

    describe('SSE parsing — line filtering', () => {
      it('skips comment lines starting with :', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse([
          ': this is a comment',
          'data: [DONE]',
        ]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledTimes(1);
        expect(cb.onChunk).toHaveBeenCalledWith({ done: true });
      });

      it('skips blank lines', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse([
          '',
          '   ',
          'data: [DONE]',
        ]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledTimes(1);
        expect(cb.onChunk).toHaveBeenCalledWith({ done: true });
      });

      it('skips malformed JSON without crashing', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(createSSEResponse([
          'data: {not valid json',
          'data: [DONE]',
        ]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onError).not.toHaveBeenCalled();
        expect(cb.onDone).toHaveBeenCalledOnce();
      });
    });

    describe('error handling', () => {
      it('calls onError with status + body text on non-ok response', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockResolvedValue(
          new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
        );
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining('401'));
        expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));
      });

      it('calls onError when response has no body', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const noBodyResponse = new Response(null, { status: 200 });
        mockFetch.mockResolvedValue(noBodyResponse);
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onError).toHaveBeenCalledWith('Cloud LLM: no response body');
      });

      it('calls onError when fetch throws a network error', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        mockFetch.mockRejectedValue(new Error('Network failure'));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onError).toHaveBeenCalledWith('Network failure');
      });
    });

    describe('stream end without [DONE]', () => {
      it('calls onChunk({done:true}) and onDone when stream ends without [DONE]', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const line = 'data: ' + JSON.stringify({ content: 'partial' });
        mockFetch.mockResolvedValue(createSSEResponse([line]));
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        const calls = cb.onChunk.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall.done).toBe(true);
        expect(cb.onDone).toHaveBeenCalledOnce();
      });
    });

    describe('abort handling', () => {
      it('calls onChunk({done:true}) and onDone on AbortError, not onError', async () => {
        const adapter = new CloudLLMAdapter('https://api.example.com', '');
        const abortError = new Error('The user aborted a request.');
        abortError.name = 'AbortError';
        mockFetch.mockRejectedValue(abortError);
        const cb = makeCallbacks();
        await adapter.streamChat(baseMessages, baseTools, cb);
        expect(cb.onChunk).toHaveBeenCalledWith({ done: true });
        expect(cb.onDone).toHaveBeenCalledOnce();
        expect(cb.onError).not.toHaveBeenCalled();
      });
    });

    it('multiple content chunks are all forwarded', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      const lines = [
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'foo' } }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: { content: 'bar' } }] }),
        'data: [DONE]',
      ];
      mockFetch.mockResolvedValue(createSSEResponse(lines));
      const cb = makeCallbacks();
      await adapter.streamChat(baseMessages, baseTools, cb);
      const contents = cb.onChunk.mock.calls
        .filter(c => c[0].content !== undefined)
        .map(c => c[0].content);
      expect(contents).toEqual(['foo', 'bar']);
    });
  });

  describe('abort()', () => {
    it('is safe to call when no stream is active', () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      expect(() => adapter.abort()).not.toThrow();
    });

    it('aborts an in-progress stream via the AbortController', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');

      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: unknown, init: RequestInit) => {
        capturedSignal = init.signal as AbortSignal;
        adapter.abort();
        const abortErr = new Error('AbortError');
        abortErr.name = 'AbortError';
        return Promise.reject(abortErr);
      });

      const cb = makeCallbacks();
      await adapter.streamChat(baseMessages, baseTools, cb);

      expect(capturedSignal?.aborted).toBe(true);
      expect(cb.onDone).toHaveBeenCalledOnce();
      expect(cb.onError).not.toHaveBeenCalled();
    });

    it('sets abortController to null after abort', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      mockFetch.mockResolvedValue(createSSEResponse(['data: [DONE]']));
      await adapter.streamChat(baseMessages, baseTools, makeCallbacks());
      expect(() => adapter.abort()).not.toThrow();
    });
  });

  describe('checkAvailability()', () => {
    it('sends GET to ${baseUrl}/api/health', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      await adapter.checkAvailability();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/health',
        expect.objectContaining({}),
      );
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect((init as { method?: string }).method).toBeUndefined();
    });

    it('includes Authorization header when authToken is set', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', 'tok');
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      await adapter.checkAvailability();
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    });

    it('returns true when response is ok', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
      const result = await adapter.checkAvailability();
      expect(result).toBe(true);
    });

    it('returns false when response is not ok', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      mockFetch.mockResolvedValue(new Response(null, { status: 503 }));
      const result = await adapter.checkAvailability();
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      mockFetch.mockRejectedValue(new Error('Connection refused'));
      const result = await adapter.checkAvailability();
      expect(result).toBe(false);
    });

    it('returns false when AbortController times out', async () => {
      const adapter = new CloudLLMAdapter('https://api.example.com', '');
      const abortErr = new Error('The user aborted a request.');
      abortErr.name = 'AbortError';
      mockFetch.mockRejectedValue(abortErr);
      const result = await adapter.checkAvailability();
      expect(result).toBe(false);
    });
  });
});
