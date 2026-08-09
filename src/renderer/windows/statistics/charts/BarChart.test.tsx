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
});
