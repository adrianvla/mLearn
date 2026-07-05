// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { Token } from '../../../shared/types';

function token(word: string): Token {
  return {
    word,
    actual_word: word,
    type: 'noun',
    partOfSpeech: 'noun',
  };
}

describe('MarkdownRenderer', () => {
  it('preserves visible whitespace between token components', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const dispose = render(
      () => (
        <MarkdownRenderer
          content="hello world"
          tokens={[token('hello'), token('world')]}
          triggerMode="hover"
          triggerKey="Shift"
          renderToken={(props) => <span class="chat-token">{props.token.word}</span>}
        />
      ),
      container,
    );

    expect(container.textContent).toContain('hello world');
    expect(container.textContent).not.toContain('helloworld');

    dispose();
    container.remove();
  });
});
