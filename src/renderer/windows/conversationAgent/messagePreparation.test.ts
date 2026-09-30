import { describe, expect, it, vi } from 'vitest';
import { createMessagePreparationQueue, messagePreparations } from './messagePreparation';
import type { Token } from '../../../shared/types';
const token = (word: string): Token => ({ word, actual_word: word, type: 'NOUN' });

describe('message preparation before hover', () => {
  it('prepares restored quiz text independently from the surrounding message and preserves the widget target', async () => {
    const apply = vi.fn();
    const queue = createMessagePreparationQueue({ tokenize: async text => [token(text)], warm: async () => {}, apply, onError: vi.fn() });
    const work = messagePreparations({ eventId: 'reply', role: 'assistant', content: 'Question', timestamp: 0,
      widgets: [{ type: 'quiz', data: { question: 'Question' } }] });
    queue.enqueue(work);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply).toHaveBeenCalledWith('reply', 'Question', [token('Question')]);
    expect(apply).toHaveBeenCalledWith('reply', 'Question', [token('Question')], 0);
    queue.dispose();
  });
  it('tokenizes a restored message and warms shared reading/dictionary data without pointer input', async () => {
    const apply = vi.fn(), warm = vi.fn(async () => {}), tokenize = vi.fn(async () => [token('word')]);
    const queue = createMessagePreparationQueue({ tokenize, warm, apply, onError: vi.fn() });
    queue.reset('language-v1'); queue.enqueue([{ id: 'a', text: 'word' }]);
    await vi.waitFor(() => expect(warm).toHaveBeenCalledWith([token('word')]));
    expect(apply).toHaveBeenCalledWith('a', 'word', [token('word')]);
    expect(tokenize).toHaveBeenCalledOnce();
    queue.enqueue([{ id: 'a', text: 'word' }]); expect(tokenize).toHaveBeenCalledOnce();
  });
  it('warms already-tokenized persisted/final messages rather than waiting for a hover', async () => {
    const tokenize = vi.fn(), warm = vi.fn(async () => {});
    const queue = createMessagePreparationQueue({ tokenize, warm, apply: vi.fn(), onError: vi.fn() });
    queue.enqueue([{ id: 'a', text: 'word', tokens: [token('word')] }]);
    await vi.waitFor(() => expect(warm).toHaveBeenCalledOnce()); expect(tokenize).not.toHaveBeenCalled();
  });
  it('bounds concurrency and drops stale scope completions', async () => {
    const resolves: ((tokens: Token[]) => void)[] = [];
    const tokenize = vi.fn(() => new Promise<Token[]>(resolve => resolves.push(resolve))), apply = vi.fn(), warm = vi.fn(async () => {});
    const queue = createMessagePreparationQueue({ tokenize, warm, apply, onError: vi.fn(), concurrency: 2 });
    queue.reset('ja'); queue.enqueue([1, 2, 3].map(id => ({ id: String(id), text: String(id) })));
    expect(tokenize).toHaveBeenCalledTimes(2);
    queue.reset('de'); resolves.forEach(resolve => resolve([token('old')]));
    await new Promise(resolve => queueMicrotask(() => queueMicrotask(resolve)));
    expect(apply).not.toHaveBeenCalled(); expect(warm).not.toHaveBeenCalled();
    queue.enqueue([{ id: 'a', text: 'new' }]);
    await vi.waitFor(() => expect(tokenize).toHaveBeenCalledTimes(3));
    resolves.at(-1)!([token('new')]);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith('a', 'new', [token('new')]));
    queue.dispose();
  });
  it('retries an unavailable backend only on explicit reset, never in an infinite render loop', async () => {
    const onError = vi.fn(), tokenize = vi.fn(async () => { throw new Error('offline'); });
    const queue = createMessagePreparationQueue({ tokenize, warm: vi.fn(), apply: vi.fn(), onError });
    queue.enqueue([{ id: 'a', text: 'word' }]);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    queue.enqueue([{ id: 'a', text: 'word' }]); expect(tokenize).toHaveBeenCalledOnce();
    queue.reset('retry'); queue.enqueue([{ id: 'a', text: 'word' }]);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  });
});
