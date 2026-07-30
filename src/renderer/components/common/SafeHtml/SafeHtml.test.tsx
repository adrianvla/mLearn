// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
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
});
