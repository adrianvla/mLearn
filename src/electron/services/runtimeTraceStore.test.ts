import { describe, expect, it } from 'vitest';
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
    const first = store.begin({ kind: 'model', context: { source: 'test' }, input: { Authorization: 'Bearer password', apiKey: 'secret', text: 'private-credential' } });
    expect(JSON.stringify(store.get(first!))).not.toContain('private-credential');
    expect(JSON.stringify(store.get(first!))).not.toContain('password');
    const second = store.begin({ kind: 'model', context: { source: 'test' }, input: {} });
    store.chunk(second, { content: 'x'.repeat(1000), done: false });
    expect(store.get(second!)?.truncated).toBe(true);
    expect(store.get(second!)!.output.content!.length).toBeLessThanOrEqual(200);
    store.begin({ kind: 'model', context: { source: 'test' }, input: {} });
    expect(store.get(first!)).toBeNull(); expect(store.list().entries).toHaveLength(2);
  });
  it('isolates inspection listener failures from inference and emits changes as they happen', () => {
    const store = createRuntimeTraceStore(); store.configure(true, 'a');
    let changes = 0; const off = store.subscribe(() => { changes++; throw new Error('closed window'); });
    const id = store.begin({ kind: 'model', context: { source: 'test' }, input: {} });
    store.chunk(id, { content: 'a', done: false }); off(); store.chunk(id, { done: true });
    expect(changes).toBe(2); expect(store.get(id!)?.status).toBe('completed');
  });
});
