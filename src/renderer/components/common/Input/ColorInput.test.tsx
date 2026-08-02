// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { ColorInput } from './ColorInput';

describe('ColorInput', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders an input[type=color] with the color-input class and current value', () => {
    const dispose = render(() => (
      <ColorInput value="#123456" onChange={() => undefined} />
    ), container);

    const input = container.querySelector<HTMLInputElement>('input[type="color"]');
    expect(input).not.toBeNull();
    expect(input!.className).toContain('color-input');
    expect(input!.value).toBe('#123456');

    dispose();
  });

  it('fires onChange with the new value', () => {
    const onChange = vi.fn();
    const dispose = render(() => (
      <ColorInput value="#000000" onChange={onChange} />
    ), container);

    const input = container.querySelector<HTMLInputElement>('input[type="color"]')!;
    input.value = '#abcdef';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith('#abcdef');

    dispose();
  });

  it('applies a custom class alongside the color-input class', () => {
    const dispose = render(() => (
      <ColorInput value="#000000" onChange={() => undefined} class="my-color" />
    ), container);

    const input = container.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(input.className).toContain('color-input');
    expect(input.className).toContain('my-color');

    dispose();
  });
});
