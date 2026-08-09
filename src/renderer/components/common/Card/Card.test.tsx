// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { Card } from './Card';

function mount(): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

describe('Card', () => {
  it('renders the title in an h3 by default', () => {
    const container = mount();
    const dispose = render(() => <Card title="Default title">Body</Card>, container);
    const heading = container.querySelector('h3');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('Default title');
    expect(container.querySelector('h2')).toBeNull();
    dispose();
    container.remove();
  });

  it('renders the title in an h2 when titleTag="h2"', () => {
    const container = mount();
    const dispose = render(() => <Card title="Big title" titleTag="h2">Body</Card>, container);
    const heading = container.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('Big title');
    expect(container.querySelector('h3')).toBeNull();
    dispose();
    container.remove();
  });
});
