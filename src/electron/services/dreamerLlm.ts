/**
 * Main-process non-streaming completion for background cognition (Dreamer).
 * Routes by settings.llmProvider over the existing provider paths; never
 * touches IPC channels or renderer windows.
 */

import { DEFAULT_SETTINGS, type LLMStreamChunk } from '../../shared/types';
import { loadSettings } from './settings';
import { chatCompletion } from './ollamaService';
import { builtinStreamChat } from './builtinLLMService';
import { cloudComplete } from './llmRouter';

// The builtin provider only exposes a streaming entry point keyed on a
// WebContents `send`; an in-process collector stands in so dream inference
// reuses the real model path without a renderer or an IPC channel.
function builtinComplete(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = '';
    const collector = {
      id: -1,
      isDestroyed: () => false,
      send: (_channel: string, chunk: LLMStreamChunk) => {
        if (chunk.error !== undefined) {
          reject(new Error(chunk.error));
          return;
        }
        if (chunk.content) text += chunk.content;
        if (chunk.done) resolve(text);
      },
    };
    void builtinStreamChat(collector as unknown as Electron.WebContents, [{ role: 'user', content: prompt }], []).catch(reject);
  });
}

export async function complete(prompt: string): Promise<string> {
  const provider = loadSettings().llmProvider || DEFAULT_SETTINGS.llmProvider;
  if (provider === 'ollama') {
    const result = await chatCompletion([{ role: 'user', content: prompt }]);
    return result.content;
  }
  if (provider === 'cloud') {
    return cloudComplete([{ role: 'user', content: prompt }]);
  }
  return builtinComplete(prompt);
}
