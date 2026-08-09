// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { Heatmap } from './Heatmap';

const localizationMock = vi.fn((key: string) => key);

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: localizationMock }),
}));

describe('Heatmap', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    localizationMock.mockImplementation((key: string) => key);
  });

  afterEach(() => {
    container.remove();
    document.querySelectorAll('.tooltip-content').forEach((element) => { element.remove(); });
    vi.clearAllMocks();
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

  it('renders a legend with Less/More labels and one swatch per color scale entry', () => {
    const dispose = render(() => <Heatmap data={{}} weeks={1} />, container);
    expect(container.textContent).toContain('mlearn.Statistics.Dashboard.Heatmap.Less');
    expect(container.textContent).toContain('mlearn.Statistics.Dashboard.Heatmap.More');
    expect(container.querySelectorAll('.heatmap-legend-swatch')).toHaveLength(5);
    expect(container.textContent).toContain('mlearn.Statistics.Dashboard.Heatmap.Max');
    dispose();
  });

  it('renders the legend max via formatMax when provided', () => {
    const dispose = render(() => <Heatmap data={{}} weeks={1} formatMax={(m) => `${m} min`} />, container);
    expect(container.textContent).toContain('1 min');
    expect(container.textContent).not.toContain('mlearn.Statistics.Dashboard.Heatmap.Max');
    dispose();
  });

  it('renders month labels above the weeks', () => {
    const dispose = render(() => <Heatmap data={{}} weeks={2} />, container);
    expect(container.querySelectorAll('.heatmap-month-label').length).toBeGreaterThan(0);
    dispose();
  });

  it('makes every cell focusable with an aria-label', () => {
    const dispose = render(() => <Heatmap data={{ '2024-01-01': 3 }} weeks={1} />, container);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.heatmap-cell'));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.getAttribute('tabindex')).toBe('0');
      expect(cell.getAttribute('aria-label')).not.toBeNull();
    }
    dispose();
  });
});
