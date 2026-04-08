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
    const { Btn } = await import('./Button');

    const dispose = render(
      () => (
        <Btn
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
});