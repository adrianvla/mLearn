// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { AnkiHoverPreview, type AnkiCardFields } from './AnkiHoverPreview';

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => {
      if (key === 'mlearn.WordDbEditor.Anki.NoCardFound') return 'No Anki card found for this word';
      if (key === 'mlearn.Global.Loading') return 'Loading';
      if (key === 'mlearn.Flashcards.Card.Unseen') return 'Unseen';
      return key;
    },
  }),
}));

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AnkiHoverPreview', () => {
  it('keeps tooltip content reactive after card fields are loaded', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const [fields, setFields] = createSignal<AnkiCardFields | null>(null);

    const dispose = render(() => (
      <AnkiHoverPreview loading={false} fields={fields()} position="bottom">
        Anki
      </AnkiHoverPreview>
    ), container);

    setFields({ Expression: { value: '会う', order: 0 } });
    await flushAsync();

    const trigger = container.querySelector('.tooltip-trigger');
    expect(trigger).not.toBeNull();
    trigger!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await flushAsync();

    expect(document.body.textContent).toContain('会う');
    expect(document.body.textContent).not.toContain('No Anki card found for this word');

    dispose();
    container.remove();
  });
});
