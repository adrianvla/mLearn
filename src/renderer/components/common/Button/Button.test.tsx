// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

vi.mock('../Icons/Icon', () => ({
  default: () => <span class="mock-icon" />,
}));

describe('Button', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders a single shared spinner and hides the icon while loading', async () => {
    const { Button } = await import('./Button');

    const dispose = render(
      () => (
        <Button
          loading
          icon="check"
          label="Test connection"
        />
      ),
      container,
    );

    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(container.querySelectorAll('.btn-loading-spinner .loader-spinner-circle')).toHaveLength(1);
    expect(container.querySelector('.btn-spinner')).toBeNull();
    expect(container.querySelector('.btn-svg-icon')).toBeNull();

    dispose();
  });

  it('marks pill icons as fixed-size flex items', async () => {
    const { Button } = await import('./Button');
    const dispose = render(() => <Button buttonType="pill" icon="cross2" label="Unknown" />, container);

    expect(container.querySelector('.btn-pill > .btn-icon-content')).not.toBeNull();

    dispose();
  });

  it('renders icon actions through the shared button mode', async () => {
    const { Button } = await import('./Button');
    const dispose = render(() => <Button buttonType="icon" aria-label="Close" icon="cross2" />, container);

    expect(container.querySelector('button.btn-icon')?.getAttribute('aria-label')).toBe('Close');

    dispose();
  });
});
