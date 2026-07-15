// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { Heatmap } from './Heatmap';

describe('Heatmap', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.tooltip-content').forEach((element) => element.remove());
  });

  it('renders cell tooltips through the shared body portal', () => {
    const dispose = render(() => <Heatmap data={{}} weeks={1} />, container);
    const trigger = container.querySelector('.tooltip-trigger');

    expect(trigger).not.toBeNull();
    expect(container.querySelector('.heatmap-cell[data-tooltip]')).toBeNull();

    trigger?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    const tooltip = document.body.querySelector('.tooltip-content');
    expect(tooltip).not.toBeNull();
    expect(container.contains(tooltip)).toBe(false);

    dispose();
  });
});
