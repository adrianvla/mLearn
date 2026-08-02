// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { RangeNumberInput } from './RangeNumberInput';

describe('RangeNumberInput', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders range and number inputs synced to the value', () => {
    const dispose = render(() => (
      <RangeNumberInput value={50} min={0} max={100} step={1} onChange={() => undefined} />
    ), container);

    const range = container.querySelector<HTMLInputElement>('input[type="range"]');
    const number = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(range).not.toBeNull();
    expect(number).not.toBeNull();
    expect(range!.value).toBe('50');
    expect(number!.value).toBe('50');

    dispose();
  });

  it('calls onChange with the parsed value when the number input is within range', () => {
    const onChange = vi.fn();
    const dispose = render(() => (
      <RangeNumberInput value={50} min={0} max={100} step={1} onChange={onChange} />
    ), container);

    const number = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    number.value = '75';
    number.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(75);

    dispose();
  });

  it('does not call onChange for out-of-range or NaN input', () => {
    const onChange = vi.fn();
    const dispose = render(() => (
      <RangeNumberInput value={50} min={0} max={100} step={1} onChange={onChange} />
    ), container);

    const number = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    number.value = '150';
    number.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();

    number.value = 'abc';
    number.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();

    dispose();
  });

  it('parses the number input as an integer when integer is set', () => {
    const onChange = vi.fn();
    const dispose = render(() => (
      <RangeNumberInput value={40} min={36} max={78} step={2} integer onChange={onChange} />
    ), container);

    const number = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    number.value = '50.5';
    number.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(50);

    dispose();
  });

  it('renders the unit text and always reserves the unit slot', () => {
    const dispose = render(() => (
      <RangeNumberInput value={1} min={0} max={2} step={0.1} onChange={() => undefined} unit="rem" />
    ), container);

    const unit = container.querySelector('.range-number-input__unit');
    expect(unit).not.toBeNull();
    expect(unit!.textContent).toBe('rem');

    dispose();
  });

  it('renders an empty unit slot when no unit is given', () => {
    const dispose = render(() => (
      <RangeNumberInput value={1} min={0} max={2} step={0.1} onChange={() => undefined} />
    ), container);

    const unit = container.querySelector('.range-number-input__unit');
    expect(unit).not.toBeNull();
    expect(unit!.textContent).toBe('');

    dispose();
  });
});
