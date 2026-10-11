// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { LineChart } from './LineChart';

describe('LineChart', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders a polyline with one vertex and one label per data point', () => {
    const dispose = render(
      () => <LineChart data={[{ label: '2026-01', value: 10 }, { label: '2026-02', value: 6 }]} />,
      container,
    );
    const line = container.querySelector('.line-chart-line');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('points')!.split(' ')).toHaveLength(2);
    expect(container.querySelectorAll('.line-chart-label')).toHaveLength(2);
    dispose();
  });

  it('renders a title tooltip per data point', () => {
    const dispose = render(
      () => <LineChart data={[{ label: 'a', value: 5, tooltip: '5 days' }]} />,
      container,
    );
    const title = container.querySelector('.line-chart-tick title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('5 days');
    dispose();
  });

  it('centers a single data point horizontally', () => {
    const dispose = render(
      () => <LineChart data={[{ label: 'a', value: 3 }]} />,
      container,
    );
    const points = container.querySelector('.line-chart-line')!.getAttribute('points')!;
    expect(Number(points.split(',')[0])).toBe(50);
    dispose();
  });

  it('gives sparse time-series labels real width on dense monthly series', () => {
    const data = Array.from({ length: 15 }, (_, index) => ({
      label: `2026-${String(index + 1).padStart(2, '0')}`,
      value: index,
    }));
    const dispose = render(() => <LineChart data={data} />, container);

    const labels = Array.from(container.querySelectorAll('.line-chart-label'));
    expect(labels.map(label => label.textContent)).toEqual(['2026-01', '2026-05', '2026-08', '2026-12', '2026-15']);
    dispose();
  });
});
