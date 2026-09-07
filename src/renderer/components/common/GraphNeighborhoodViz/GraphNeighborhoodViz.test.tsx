// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { GraphNeighborhood } from '../../../../shared/graph/ipc';
import type { TargetState } from '../../../../shared/graph/explanations';
import { GraphNeighborhoodViz, layoutNeighborhood } from './GraphNeighborhoodViz';

vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

/** Spec story: inspecting 殖える exposes entry realization, lemma identity, pronunciation, and 増える as support. */
const neighborhood: GraphNeighborhood = {
  center: { id: 'ja:surface:ueru', kind: 'surface', label: '殖える' },
  centerDenseId: 7,
  relationCount: 4,
  relations: [
    { id: 'ja:dictionary-entry:ueru', kind: 'dictionary-entry', label: '殖える', relationType: 'realizes', provenance: 'jmdict' },
    { id: 'ja:lexeme:ueru', kind: 'lexeme', label: '殖える', relationType: 'lemma-of' },
    { id: 'ja:pronunciation:ueru', kind: 'pronunciation', label: 'うえる', relationType: 'has-pronunciation' },
    { id: 'ja:surface:fueru', kind: 'surface', label: '増える', relationType: 'semantically-related', confidence: 0.9 },
  ],
};

describe('layoutNeighborhood', () => {
  it('places the center plus every relation as nodes, honestly counting truncation', () => {
    const layout = layoutNeighborhood(neighborhood, 3);
    // maxNodes includes the center: 3 → center + 2 relations, 2 truncated.
    expect(layout.nodes).toHaveLength(2);
    expect(layout.truncated).toBe(2);
    const full = layoutNeighborhood(neighborhood);
    expect(full.nodes).toHaveLength(4);
    expect(full.truncated).toBe(0);
    expect(full.center.label).toBe('殖える');
  });

  it('never overlaps chips and keeps the center pinned at the viewport middle', () => {
    const layout = layoutNeighborhood(neighborhood);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const overlapX = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
        const overlapY = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
        expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      }
    }
    expect(layout.center.x).toBeGreaterThan(0);
  });

  it('is deterministic for identical payloads', () => {
    expect(layoutNeighborhood(neighborhood)).toEqual(layoutNeighborhood(neighborhood));
  });
});

describe('GraphNeighborhoodViz', () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container.remove();
  });

  function mount(props: { centerState?: TargetState; onSelect?: (id: string) => void } = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <GraphNeighborhoodViz
          neighborhood={neighborhood}
          centerState={props.centerState}
          onSelect={props.onSelect}
        />
      ),
      container,
    );
    return dispose;
  }

  const chips = () => container.querySelectorAll('.graph-viz__node .graph-viz__chip');

  it('renders the center and each relation as labeled chip nodes with typed edges', () => {
    const dispose = mount();
    expect(chips()).toHaveLength(5); // center + 4 relations
    expect(container.querySelectorAll('.graph-viz__edge')).toHaveLength(4);
    expect(container.textContent).toContain('殖える');
    expect(container.textContent).toContain('増える');
    dispose();
  });

  it('exposes legend chips with counts that filter categories', () => {
    const dispose = mount();
    const legend = Array.from(container.querySelectorAll('.graph-viz__legend-chip'));
    expect(legend).toHaveLength(3);
    const support = legend.find((chip) => chip.textContent?.includes('mlearn.GraphInspector.support')) as HTMLButtonElement;
    expect(support.textContent).toContain('1');
    support.click();
    // Support node filtered out of the layout.
    expect(chips()).toHaveLength(4);
    dispose();
  });

  it('selects a relation node on click and shows a humanized detail panel', () => {
    const dispose = mount();
    const node = Array.from(container.querySelectorAll('.graph-viz__node')).find((el) => el.getAttribute('aria-label') === '増える')!;
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(node.classList.contains('graph-viz__node--selected')).toBe(true);
    const detail = container.querySelector('.graph-viz__detail');
    expect(detail?.textContent).toContain('mlearn.GraphInspector.Kind.Surface');
    expect(detail?.textContent).toContain('mlearn.GraphInspector.PhraseOf');
    expect(detail?.textContent).toContain('90%');
    // Raw relation type stays out of the primary panel copy.
    expect(detail?.textContent).not.toContain('semantically-related');
    dispose();
  });

  it('navigates via double-click and via the detail-panel action', () => {
    const onSelect = vi.fn();
    const dispose = mount({ onSelect });
    const node = Array.from(container.querySelectorAll('.graph-viz__node')).find((el) => el.getAttribute('aria-label') === '増える')!;
    node.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('ja:surface:fueru');
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const navigate = Array.from(container.querySelectorAll('.graph-viz__detail button')).find((button) => button.textContent === 'mlearn.GraphInspector.SelectEntity') as HTMLButtonElement;
    navigate.click();
    expect(onSelect).toHaveBeenCalledWith('ja:surface:fueru');
    dispose();
  });

  it('tints the center chip by the learner state only when provided', () => {
    const dispose = mount({ centerState: 'evidence-backed-known' });
    expect(container.querySelector('.graph-viz__center-ring--evidence-backed-known')).not.toBeNull();
    dispose();
  });

  it('renders an honest empty state without fake nodes', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(
      () => <GraphNeighborhoodViz neighborhood={{ ...neighborhood, relations: [], relationCount: 0 }} />,
      container,
    );
    expect(container.querySelector('.graph-viz__empty')?.textContent).toBe('mlearn.GraphInspector.Neighborhood.Empty');
    expect(chips()).toHaveLength(0);
    dispose();
  });

  it('reveals beyond the initial node budget only on demand', () => {
    const many: GraphNeighborhood = {
      ...neighborhood,
      relationCount: 22,
      relations: Array.from({ length: 22 }, (_, index) => ({
        id: `ja:surface:rel${index}`,
        kind: 'surface' as const,
        label: `関係${index}`,
        relationType: 'semantically-related' as const,
      })),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <GraphNeighborhoodViz neighborhood={many} />, container);

    expect(chips()).toHaveLength(18); // center + 17 initial (budget counts the center)
    const showAll = Array.from(container.querySelectorAll('.graph-viz__show-all')).find((button) => button.textContent?.includes('mlearn.GraphInspector.Neighborhood.ShowAll')) as HTMLButtonElement;
    showAll.click();
    expect(chips()).toHaveLength(23); // center + all 22

    dispose();
  });
});
