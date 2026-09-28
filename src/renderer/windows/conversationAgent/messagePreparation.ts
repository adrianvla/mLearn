import type { Token } from '../../../shared/types';
export interface MessagePreparation { id: string; text: string; tokens?: Token[] }
/** No pointer dependency. The caller prioritizes visible text; work is cancellable by scope. */
export function createMessagePreparationQueue(options: {
  tokenize: (text: string) => Promise<Token[]>;
  warm: (tokens: Token[]) => Promise<void>;
  apply: (id: string, text: string, tokens: Token[]) => void;
  onError: (error: unknown) => void;
  concurrency?: number;
}) {
  const pending: MessagePreparation[] = [];
  const seen = new Set<string>();
  let generation = 0, scope = '', active = 0, disposed = false;
  const drain = (): void => {
    while (!disposed && active < (options.concurrency ?? 2) && pending.length) {
      const message = pending.shift()!, session = generation;
      active++;
      void (async () => {
        try {
          const tokens = message.tokens?.length ? message.tokens : await options.tokenize(message.text);
          if (disposed || session !== generation) return;
          if (!tokens.length) throw new Error('Tokenizer returned no tokens for a non-empty message');
          options.apply(message.id, message.text, tokens);
          await options.warm(tokens);
        } catch (error) { if (!disposed && session === generation) options.onError(error); }
        finally { active--; drain(); }
      })();
    }
  };
  return {
    reset(nextScope: string): void {
      if (nextScope === scope) return;
      scope = nextScope; generation++; pending.length = 0; seen.clear();
    },
    enqueue(messages: readonly MessagePreparation[]): void {
      if (disposed) return;
      for (const message of messages) {
        const key = JSON.stringify([message.id, message.text]);
        if (!message.text.trim() || seen.has(key)) continue;
        seen.add(key); pending.push(message);
      }
      drain();
    },
    dispose(): void { disposed = true; generation++; pending.length = 0; seen.clear(); },
  };
}
