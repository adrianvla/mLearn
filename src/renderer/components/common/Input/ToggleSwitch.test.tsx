// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { ToggleSwitch } from './ToggleSwitch';

describe('ToggleSwitch', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('exposes the small size variant through its component class', () => {
    const dispose = render(() => (
      <ToggleSwitch size="sm" checked={false} onChange={() => undefined} />
    ), container);

    expect(container.querySelector('.toggle-switch--sm')).toBeTruthy();

    dispose();
  });
});
