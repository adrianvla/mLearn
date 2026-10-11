// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { BarChart } from './BarChart';

describe('BarChart', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.tooltip-content').forEach((element) => { element.remove(); });
  });

  it('renders a bar per data point', () => {
    const dispose = render(
      () => <BarChart data={[{ label: 'a', value: 5 }, { label: 'b', value: 3 }]} />,
      container,
    );
    expect(container.querySelectorAll('.bar-chart-column')).toHaveLength(2);
    expect(container.querySelectorAll('.bar-chart-bar')).toHaveLength(2);
    dispose();
  });

  it('supports a fixed scale so percentages are not normalized to the largest observed value', () => {
    const dispose = render(
      () => <BarChart data={[{ label: '2026-01', value: 50 }, { label: '2026-02', value: 25 }]} valueMax={100} />,
      container,
    );

    const bars = container.querySelectorAll<HTMLElement>('.bar-chart-bar');
    expect(bars[0].style.height).toBe('50%');
    expect(bars[1].style.height).toBe('25%');
    dispose();
  });

  it('does not render a tooltip trigger when a point has no tooltip', () => {
    const dispose = render(() => <BarChart data={[{ label: 'a', value: 5 }]} />, container);
    expect(container.querySelector('.tooltip-trigger')).toBeNull();
    dispose();
  });

  it('wraps a tooltip point in the shared Tooltip with tabindex and aria-label', () => {
    const dispose = render(
      () => <BarChart data={[{ label: 'a', value: 5, tooltip: '5 reviews' }]} />,
      container,
    );
    const trigger = container.querySelector('.tooltip-trigger');
    expect(trigger).not.toBeNull();
    const wrapper = container.querySelector('.bar-chart-bar-wrapper');
    expect(wrapper!.getAttribute('tabindex')).toBe('0');
    expect(wrapper!.getAttribute('aria-label')).toBe('5 reviews');
    dispose();
  });

  it('shows the tooltip content on hover through the body portal', () => {
    const dispose = render(
      () => <BarChart data={[{ label: 'a', value: 5, tooltip: '5 reviews' }]} />,
      container,
    );
    const trigger = container.querySelector('.tooltip-trigger')!;
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const tooltip = document.body.querySelector('.tooltip-content');
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe('5 reviews');
    expect(container.contains(tooltip)).toBe(false);
    dispose();
  });
  it('thins axis labels to what the rendered width can carry', () => {
    // happy-dom reports zero layout, so the measured column width is 0 and the
    // policy keeps only the range endpoints rather than a fixed stride.
    const data = Array.from({ length: 30 }, (_, index) => ({ label: `d${index + 1}`, value: index }));
    const dispose = render(() => <BarChart data={data} />, container);
    const labels = Array.from(container.querySelectorAll('.bar-chart-label'))
      .map((element) => element.textContent)
      .filter(Boolean);
    // Every column still renders; only the labels are thinned.
    expect(container.querySelectorAll('.bar-chart-column')).toHaveLength(30);
    expect(labels.length).toBeLessThan(30);
    dispose();
  });

  it('keeps selected date labels readable across the chart instead of clipping them to one bar', () => {
    const data = Array.from({ length: 15 }, (_, index) => ({
      label: `2026-${String(index + 1).padStart(2, '0')}`,
      value: index + 1,
    }));
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const boundsDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('bar-chart') ? 320 : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        const width = this.style.position === 'absolute' ? (this.textContent?.length ?? 0) * 6 : 0;
        return new DOMRect(0, 0, width, 10);
      },
    });

    let dispose: (() => void) | undefined;
    try {
      dispose = render(() => <BarChart data={data} />, container);
      const visibleLabels = Array.from(container.querySelectorAll<HTMLElement>('.bar-chart-label'))
        .filter(label => label.textContent);
      expect(visibleLabels.map(label => label.textContent)).toEqual(['2026-01', '2026-08', '2026-15']);
      expect(visibleLabels.map(label => label.classList.contains('bar-chart-label-positioned')))
        .toEqual([true, true, true]);
      expect(visibleLabels.map(label => label.getAttribute('title')))
        .toEqual(['2026-01', '2026-08', '2026-15']);
    } finally {
      dispose?.();
      if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      if (boundsDescriptor) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', boundsDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
    }
  });

});
