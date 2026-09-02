// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { GraphNeighborhood } from '../../../../shared/graph/ipc';
import type { TargetState } from '../../../../shared/graph/explanations';
import { GraphNeighborhoodViz, layoutNeighborhood } from './GraphNeighborhoodViz';

vi.mock('../../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => (
      params ? `${key}:${params.shown}/${params.total}` : key
    ),
  }),
}));

/** Spec story: inspecting 殖える exposes entry realization, lemma identity, pronunciation, and 増える as support. */
const neighborhood: GraphNeighborhood = {
  center: { id: 'ja:surface:ueru', kind: 'surface', label: '殖える' },
  centerDenseId: 7,
  relationCount: 4,
  relations: [
    { id: 'ja:entry:1602440', kind: 'dictionary-entry', label: '殖える', relationType: 'realizes', domain: 'common', confidence: 1, provenance: 'jmdict' },
    { id: 'ja:lexeme:ueru', kind: 'lexeme', label: '殖える', relationType: 'lemma-of' },
    { id: 'ja:pronunciation:fueru', kind: 'pronunciation', label: 'ふえる', relationType: 'has-pronunciation' },
    { id: 'ja:surface:fueru', kind: 'surface', label: '増える', relationType: 'semantically-related', confidence: 0.9, provenance: 'coocurrence' },
  ],
};

describe('GraphNeighborhoodViz', () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container.remove();
  });

  function mount(props: { centerState?: TargetState; maxNodes?: number; onSelect?: (id: string) => void } = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => (
      <GraphNeighborhoodViz
        neighborhood={neighborhood}
        centerState={props.centerState}
        maxNodes={props.maxNodes}
        onSelect={props.onSelect}
      />
    ), container);
    return dispose;
  }

  it('renders the center and each relation as nodes and edges', () => {
    mount();
    expect(container.querySelectorAll('.graph-viz__node').length).toBe(5);
    expect(container.querySelectorAll('.graph-viz__edge').length).toBe(4);
    expect(container.querySelector('.graph-viz__node--center .graph-viz__label')?.textContent).toBe('殖える');
    const labels = Array.from(container.querySelectorAll('.graph-viz__node .graph-viz__label'), (node) => node.textContent);
    expect(labels).toContain('ふえる');
    expect(labels).toContain('増える');
  });

  it('distinguishes identity, property, and support edges and nodes', () => {
    mount();
    expect(container.querySelector('.graph-viz__edge--identity')).not.toBeNull();
    expect(container.querySelector('.graph-viz__edge--property')).not.toBeNull();
    expect(container.querySelector('.graph-viz__edge--support')).not.toBeNull();
    expect(container.querySelector('.graph-viz__node--identity')).not.toBeNull();
    expect(container.querySelector('.graph-viz__node--property')).not.toBeNull();
    expect(container.querySelector('.graph-viz__node--support')).not.toBeNull();
    expect(container.querySelectorAll('.graph-viz__edge--property').length).toBe(2);
  });

  it('exposes relation type, domain, confidence, and provenance on inspect', () => {
    mount();
    const pronunciationNode = container.querySelector('g[aria-label="ふえる"]');
    expect(pronunciationNode?.querySelector('title')?.textContent).toContain('has-pronunciation');
    const edgeTitles = Array.from(container.querySelectorAll('.graph-viz__edge title'), (title) => title.textContent);
    expect(edgeTitles).toContain('realizes · common · 1 · jmdict');
    expect(edgeTitles).toContain('semantically-related · 0.9 · coocurrence');
  });

  it('recenters via onSelect when a relation node is clicked or activated by keyboard', () => {
    const onSelect = vi.fn();
    mount({ onSelect });
    const node = container.querySelector<SVGGElement>('g[aria-label="ふえる"]');
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('ja:pronunciation:fueru');
    const supportNode = container.querySelector<SVGGElement>('g[aria-label="増える"]');
    supportNode!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('ja:surface:fueru');
  });

  it('shows the center learner state chip only when a TargetState is provided', () => {
    mount({ centerState: 'predicted' });
    expect(container.querySelector('.graph-viz__chip--predicted')?.textContent).toBe('mlearn.GraphInspector.Neighborhood.State.Predicted');
    expect(container.querySelector('.graph-viz__state-dot--predicted')).not.toBeNull();
    mount();
    expect(container.querySelector('.graph-viz__chip')).toBeNull();
    expect(container.querySelector('.graph-viz__state-dot')).toBeNull();
  });

  it('renders an honest empty state without fake nodes', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    render(() => <GraphNeighborhoodViz neighborhood={{ ...neighborhood, relations: [], relationCount: 0 }} />, container);
    expect(container.querySelector('.graph-viz__empty')?.textContent).toBe('mlearn.GraphInspector.Neighborhood.Empty');
    expect(container.querySelector('.graph-viz__node')).toBeNull();
    expect(container.querySelector('.graph-viz__edge')).toBeNull();
  });

  it('truncates at the node cap and says so', () => {
    mount({ maxNodes: 3 });
    expect(container.querySelectorAll('.graph-viz__node').length).toBe(3);
    expect(container.querySelectorAll('.graph-viz__edge').length).toBe(2);
    expect(container.querySelector('.graph-viz__truncated')?.textContent).toBe('mlearn.GraphInspector.Neighborhood.Truncated:2/4');
  });

  it('lays out deterministically with identity innermost and support outermost', () => {
    const first = layoutNeighborhood(neighborhood);
    const second = layoutNeighborhood(neighborhood);
    expect(first).toEqual(second);
    const radiusOf = (category: string) => {
      const node = first.nodes.find((candidate) => candidate.category === category)!;
      return Math.hypot(node.x - first.center.x, node.y - first.center.y);
    };
    expect(first.nodes.every((node) => node.x >= 0 && node.x <= 660 && node.y >= 0 && node.y <= 400)).toBe(true);
    expect(radiusOf('identity')).toBeLessThan(radiusOf('property'));
    expect(radiusOf('property')).toBeLessThan(radiusOf('support'));
  });
});
