import { describe, expect, it, vi } from 'vitest';
import { createRuntimeTraceStore } from './runtimeTraceStore';

describe('runtime inspection capture', () => {
  it('captures the actual request before streaming and associates replies with that immutable request', () => {
    const store = createRuntimeTraceStore();
    store.configure(true, 'profile-a');
    const messages = [{ role: 'system', content: 'Original prompt' }];
    const id = store.begin({ kind: 'model', context: { source: 'conversation', roomId: 'room-a' }, input: { messages, tools: [] } });
    messages[0].content = 'Changed later';
    store.start(id); store.chunk(id, { content: 'Hello', done: false });
    expect(store.get(id!)?.input).toEqual({ messages: [{ role: 'system', content: 'Original prompt' }], tools: [] });
    expect(store.get(id!)?.output.content).toBe('Hello');
    store.chunk(id, { content: ' there', done: true });
    expect(store.get(id!)?.status).toBe('completed');
    expect(store.get(id!)?.output.content).toBe('Hello there');
  });
  it('measures first-token latency from provider start, ignoring empty chunks', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const store = createRuntimeTraceStore(); store.configure(true, 'profile-a');
      const id = store.begin({ kind: 'model', context: { source: 'conversation' }, input: { messages: [] } });
      vi.setSystemTime(1_050); store.start(id);
      vi.setSystemTime(1_100); store.chunk(id, { content: '', done: false });
      expect(store.get(id!)?.firstTokenAt).toBeUndefined();
      vi.setSystemTime(1_175); store.chunk(id, { content: 'Hello', done: false });
      vi.setSystemTime(1_200); store.chunk(id, { content: ' world', done: true });
      expect(store.get(id!)).toMatchObject({
        providerStartedAt: 1_050,
        firstTokenAt: 1_175,
        timeToFirstTokenMs: 125,
        status: 'completed',
      });
    } finally { vi.useRealTimers(); }
  });
  it('captures tool arguments, results, errors, and cancellation without fabricating model reasoning', () => {
    const store = createRuntimeTraceStore(); store.configure(true, 'a');
    const id = store.begin({ kind: 'tool', context: { source: 'conversation', requestId: 'request-a' }, input: { name: 'lookup', arguments: { query: 'word' } } });
    store.finish(id, 'failed', { error: 'Unavailable', result: null });
    expect(store.get(id!)?.output).toMatchObject({ error: 'Unavailable', result: null });
    const cancelled = store.begin({ kind: 'model', context: { source: 'dreamer' }, input: {} });
    store.finish(cancelled, 'cancelled');
    expect(store.get(cancelled!)?.status).toBe('cancelled');
  });
  it('does not capture when off, clears on disable/profile change and ignores late chunks', () => {
    const store = createRuntimeTraceStore();
    const input = { kind: 'model' as const, context: { source: 'director' }, input: { messages: [] } };
    expect(store.begin(input)).toBeUndefined();
    store.configure(true, 'a'); const id = store.begin(input);
    store.configure(false, 'a'); store.chunk(id, { content: 'secret', done: true });
    expect(store.list().entries).toEqual([]);
    store.configure(true, 'a'); store.begin(input); store.configure(true, 'b');
    expect(store.list().entries).toEqual([]);
  });
  it('redacts credentials, reports truncation and bounds retained records', () => {
    const store = createRuntimeTraceStore({ maxEntries: 2, maxFieldCharacters: 200 }); store.configure(true, 'a', ['private-credential']);
    const first = store.begin({ kind: 'model', context: { source: 'test' }, input: { Authorization: 'Bearer password', apiKey: 'secret', compatibleApiKey: 'alternate-secret', text: 'private-credential' } });
    expect(JSON.stringify(store.get(first!))).not.toContain('private-credential');
    expect(JSON.stringify(store.get(first!))).not.toContain('password');
    expect(JSON.stringify(store.get(first!))).not.toContain('alternate-secret');
    const second = store.begin({ kind: 'model', context: { source: 'test' }, input: {} });
    store.chunk(second, { content: 'x'.repeat(1000), done: false });
    expect(store.get(second!)?.truncated).toBe(true);
    expect(store.get(second!)!.output.content!.length).toBeLessThanOrEqual(200);
    store.begin({ kind: 'model', context: { source: 'test' }, input: {} });
    expect(store.get(first!)).toBeNull(); expect(store.list().entries).toHaveLength(2);
  });
  it('redacts secrets embedded in source URLs and nested request fields', () => {
    const store = createRuntimeTraceStore(); store.configure(true, 'a');
    const id = store.begin({ kind: 'model', context: { source: 'research' }, input: {
      url: 'https://example.org/page?api_key=url-secret&chapter=3',
      payload: { client_secret: 'nested-secret', access_token: 'another-secret' },
    } });
    const captured = JSON.stringify(store.get(id));
    expect(captured).not.toContain('url-secret');
    expect(captured).not.toContain('nested-secret');
    expect(captured).not.toContain('another-secret');
    expect(captured).toContain('chapter=3');
  });
  it('isolates inspection listener failures from inference and emits changes as they happen', () => {
    const store = createRuntimeTraceStore(); store.configure(true, 'a');
    let changes = 0; const off = store.subscribe(() => { changes++; throw new Error('closed window'); });
    const id = store.begin({ kind: 'model', context: { source: 'test' }, input: {} });
    store.chunk(id, { content: 'a', done: false }); off(); store.chunk(id, { done: true });
    expect(changes).toBe(2); expect(store.get(id!)?.status).toBe('completed');
  });
});
