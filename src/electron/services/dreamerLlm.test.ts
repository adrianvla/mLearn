import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMStreamChunk, Settings } from '../../shared/types';

const mockLoadSettings = vi.fn();
vi.mock('./settings', () => ({ loadSettings: mockLoadSettings }));

const mockChatCompletion = vi.fn();
vi.mock('./ollamaService', () => ({ chatCompletion: mockChatCompletion }));

const mockBuiltinStreamChat = vi.fn();
vi.mock('./builtinLLMService', () => ({ builtinStreamChat: mockBuiltinStreamChat }));

const mockCloudComplete = vi.fn();
vi.mock('./llmRouter', () => ({ cloudComplete: mockCloudComplete }));

function settings(partial: Partial<Settings>): Settings {
  return { ...({ llmProvider: 'builtin' } as Settings), ...partial };
}
// resetModules discards the statically-imported graph, so the module under
// test must be re-imported after the mocks are (re)applied.
let mod: typeof import('./dreamerLlm');

describe('dreamerLlm.complete', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockLoadSettings.mockReturnValue(settings({}));
    mod = await import('./dreamerLlm');
  });

  it('routes ollama through non-streaming chatCompletion', async () => {
    mockLoadSettings.mockReturnValue(settings({ llmProvider: 'ollama' }));
    mockChatCompletion.mockResolvedValue({ content: 'dream output' });

    await expect(mod.complete('consolidate this')).resolves.toBe('dream output');

    expect(mockChatCompletion).toHaveBeenCalledWith([{ role: 'user', content: 'consolidate this' }]);
    expect(mockBuiltinStreamChat).not.toHaveBeenCalled();
    expect(mockCloudComplete).not.toHaveBeenCalled();
  });

  it('routes cloud through the llmRouter non-streaming path', async () => {
    mockLoadSettings.mockReturnValue(settings({ llmProvider: 'cloud' }));
    mockCloudComplete.mockResolvedValue('cloud dream');

    await expect(mod.complete('consolidate this')).resolves.toBe('cloud dream');

    expect(mockCloudComplete).toHaveBeenCalledWith([{ role: 'user', content: 'consolidate this' }]);
    expect(mockChatCompletion).not.toHaveBeenCalled();
    expect(mockBuiltinStreamChat).not.toHaveBeenCalled();
  });

  it('collects builtin stream chunks into the full response', async () => {
    mockLoadSettings.mockReturnValue(settings({ llmProvider: 'builtin' }));
    mockBuiltinStreamChat.mockImplementation(async (sender: { send: (channel: string, chunk: LLMStreamChunk) => void }) => {
      sender.send('chan', { content: 'con' });
      sender.send('chan', { content: 'clusion' });
      sender.send('chan', { content: '', done: true });
    });

    await expect(mod.complete('consolidate this')).resolves.toBe('conclusion');
    expect(mockChatCompletion).not.toHaveBeenCalled();
    expect(mockCloudComplete).not.toHaveBeenCalled();
  });

  it('rejects when the builtin stream reports an error chunk', async () => {
    mockLoadSettings.mockReturnValue(settings({ llmProvider: 'builtin' }));
    mockBuiltinStreamChat.mockImplementation(async (sender: { send: (channel: string, chunk: LLMStreamChunk) => void }) => {
      sender.send('chan', { error: 'model not downloaded', done: true });
    });

    await expect(mod.complete('consolidate this')).rejects.toThrow('model not downloaded');
  });

  it('rejects when the builtin model fails to load', async () => {
    mockLoadSettings.mockReturnValue(settings({ llmProvider: 'builtin' }));
    mockBuiltinStreamChat.mockRejectedValue(new Error('Model not loaded'));

    await expect(mod.complete('consolidate this')).rejects.toThrow('Model not loaded');
  });
});
