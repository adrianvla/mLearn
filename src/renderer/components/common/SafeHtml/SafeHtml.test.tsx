// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { SafeHtml } from './SafeHtml';

describe('SafeHtml', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = '';
  });

  it.each(['span', 'div', 'p', 'h1'] as const)('renders a <%s> tag', (tag) => {
    const dispose = render(() => <SafeHtml tag={tag} html="hi" />, container);
    expect(container.querySelector(tag)?.textContent).toBe('hi');
    dispose();
  });

  it('applies the class prop', () => {
    const dispose = render(() => <SafeHtml tag="span" class="gloss" html="x" />, container);
    expect(container.querySelector('span')?.className).toBe('gloss');
    dispose();
  });

  it('sanitizes the html before rendering', () => {
    const dispose = render(
      () => <SafeHtml tag="div" html={'<img src=x onerror="window.__poc=1">'} />,
      container,
    );
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.querySelector('img')).not.toBeNull();
    dispose();
  });

  it('renders empty when html is undefined', () => {
    const dispose = render(() => <SafeHtml tag="span" html={undefined} />, container);
    const el = container.querySelector('span');
    expect(el).not.toBeNull();
    expect(el?.innerHTML).toBe('');
    dispose();
  });

  it('opts stored generated word markup into current-theme presentation without rewriting its content', () => {
    const [storedWordPresentation, setStoredWordPresentation] = createSignal(true);
    const html = '<span class="subtitle_word defined" style="color: #ebccfd" data-package-feature="opaque">sample</span>';
    const dispose = render(() => <SafeHtml tag="div" class="example" html={html}
      storedWordPresentation={storedWordPresentation()} />, container);
    try {
      const root = container.querySelector('.example')!;
      expect(root.classList.contains('safe-html--stored-words')).toBe(true);
      const token = root.querySelector<HTMLElement>('.subtitle_word.defined')!;
      expect(token.textContent).toBe('sample');
      expect(token.style.color).toBe('#ebccfd');
      expect(token.dataset.packageFeature).toBe('opaque');
      setStoredWordPresentation(false);
      expect(root.classList.contains('safe-html--stored-words')).toBe(false);
      expect(root.querySelector('.subtitle_word')?.textContent).toBe('sample');
    } finally { dispose(); }
  });
});
