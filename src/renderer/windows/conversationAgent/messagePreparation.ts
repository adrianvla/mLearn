import type { ConversationMessage, Token } from '../../../shared/types';
export interface MessagePreparation { id: string; text: string; tokens?: Token[]; widgetIndex?: number }

/** Both restored and newly committed messages use the same preparation path. */
export function messagePreparations(message: ConversationMessage & { eventId: string }): MessagePreparation[] {
  const widgets = message.widgets ?? (message.widget ? [message.widget] : []);
  return [{ id: message.eventId, text: message.content }, ...widgets.flatMap((widget, widgetIndex) => {
    const text = widget.type === 'quiz' ? widget.data.question || widget.data.textWithBlanks
      : widget.type === 'mistake' ? widget.data.correction || widget.data.errorSpan : undefined;
    return typeof text === 'string' ? [{ id: message.eventId, text, widgetIndex }] : [];
  })];
}
/** No pointer dependency. The caller prioritizes visible text; work is cancellable by scope. */
export function createMessagePreparationQueue(options: {
  tokenize: (text: string) => Promise<Token[]>;
  warm: (tokens: Token[]) => Promise<void>;
  apply: (id: string, text: string, tokens: Token[], widgetIndex?: number) => void;
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
          if (message.widgetIndex === undefined) options.apply(message.id, message.text, tokens);
          else options.apply(message.id, message.text, tokens, message.widgetIndex);
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
        const key = JSON.stringify([message.id, message.widgetIndex, message.text]);
        if (!message.text.trim() || seen.has(key)) continue;
        seen.add(key); pending.push(message);
      }
      drain();
    },
    dispose(): void { disposed = true; generation++; pending.length = 0; seen.clear(); },
  };
}
