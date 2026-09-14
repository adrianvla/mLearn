// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { GraphNeighborhood } from '../../../../shared/graph/ipc';
import { GraphNeighborhoodViz, groupNeighborhood, layoutNeighborhood } from './GraphNeighborhoodViz';
vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}` }) }));
const neighborhood: GraphNeighborhood = {
  center: { id: 'surface', kind: 'surface', label: '殖える' }, centerDenseId: 7, relationCount: 4,
  relations: [
    { id: 'entry', kind: 'dictionary-entry', label: '殖える', relationType: 'realizes', provenance: 'dictionary' },
    { id: 'lexeme', kind: 'lexeme', label: '殖える', relationType: 'lemma-of' },
    { id: 'sound', kind: 'pronunciation', label: 'うえる', relationType: 'has-pronunciation' },
    { id: 'sibling', kind: 'surface', label: '増える', relationType: 'semantically-related', confidence: 0.9 },
  ],
};
const dense: GraphNeighborhood = { ...neighborhood, relationCount: 213, relations: Array.from({ length: 213 }, (_, i) => ({ id: `node:${i}`, kind: 'sense', label: `Meaning ${i} with a complete long description`, relationType: 'has-sense' })) };
let container: HTMLDivElement;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); container?.remove(); });
function mount(data = neighborhood, onSelect = vi.fn()) {
  container = document.createElement('div'); document.body.appendChild(container);
  const [value, setValue] = createSignal(data);
  dispose = render(() => <GraphNeighborhoodViz neighborhood={value()} onSelect={onSelect} />, container);
  return { setValue, onSelect };
}
const button = (key: string) => Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes(key) || el.getAttribute('aria-label')?.endsWith(key))!;
const selectGroup = (type: string) => (Array.from(container.querySelectorAll('.graph-viz__group')).find((el) => el.textContent?.includes(type)) as HTMLButtonElement).click();

describe('neighborhood presentation', () => {
  it('keeps bounded deterministic non-overlapping rows, even for a dense entry', () => {
    const layout = layoutNeighborhood(dense);
    expect(layout.nodes).toHaveLength(8); expect(layout.truncated).toBe(205);
    expect(layout).toEqual(layoutNeighborhood(dense));
    for (let i = 1; i < layout.nodes.length; i++) expect(layout.nodes[i].y - layout.nodes[i - 1].y).toBeGreaterThan(layout.nodes[i].h);
    expect(layoutNeighborhood(neighborhood, 3).truncated).toBe(2);
  });
  it('retains separate relationships and lexical paths for identical entity IDs', () => {
    const a = neighborhood.relations[0];
    const groups = groupNeighborhood({ ...neighborhood, relations: [a, { ...a, relationType: 'lemma-of' }, { ...a, via: { id: 'other', kind: 'lexeme' } }, { ...a, order: 1 }] });
    expect(groups).toHaveLength(3); expect(groups[0].relations).toHaveLength(2);
  });
  it('keeps arbitrary package types visible without assigning them core semantics', () => {
    const data = { ...neighborhood, relations: [{ id: 'x', kind: 'x-future::discourse-role', label: 'Agent perspective', relationType: 'x-future::aligns-with' }] };
    expect(groupNeighborhood(data)[0].category).toBe('extension');
    mount(data); expect(container.textContent).toContain('aligns with'); expect(container.textContent).toContain('Agent perspective');
  });
  it('uses a package-authored display label and keeps raw codes in details', () => {
    mount({ ...neighborhood, relations: [{ ...neighborhood.relations[0], label: 'v5u', displayLabel: 'Package-defined class description' }] });
    expect(container.querySelector('.graph-viz__label')?.textContent).not.toContain('v5u');
    container.querySelector('[data-node]:not([data-node="center"])')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.graph-viz__detail-heading')?.textContent).toContain('Package-defined class description');
    expect(container.querySelector('details')?.textContent).toContain('v5u');
  });
  it('distinguishes same-label nodes by kind, and uses undirected connectors', () => {
    mount(); expect(container.querySelector('.graph-viz__node')?.getAttribute('aria-label')).toContain('DictionaryEntry');
    expect(container.querySelector('[marker-end]')).toBeNull();
    expect(container.querySelectorAll('.graph-viz__edge')).toHaveLength(1);
    selectGroup('LemmaOf'); expect(container.querySelector('.graph-viz__node')?.getAttribute('aria-label')).toContain('Lexeme');
  });
  it('preserves a lexical intermediary instead of implying a direct property edge', () => {
    mount({ ...neighborhood, relations: [{ ...dense.relations[0], via: neighborhood.relations[0] }] });
    expect(container.querySelector('[data-node="via"]')?.textContent).toContain('殖える');
    expect(container.querySelectorAll('.graph-viz__edge')).toHaveLength(2);
    container.querySelector('[data-node="via"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.graph-viz__detail-heading')?.textContent).toContain('殖える');
  });
  it('pages dense groups, searches all loaded labels, and exposes full labels on selection', () => {
    mount(dense); expect(container.querySelectorAll('.graph-viz__node')).toHaveLength(8);
    button('Explore.Next').click(); expect(container.querySelector('.graph-viz__node')?.textContent).toContain('Meaning 8');
    const input = container.querySelector('input')!; input.value = 'Meaning 212 '; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(container.querySelectorAll('.graph-viz__node')).toHaveLength(1);
    container.querySelector('.graph-viz__node')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.graph-viz__detail-heading')?.textContent).toContain('Meaning 212 with a complete long description');
  });
  it('selects with keyboard and navigates using the explicit detail action', () => {
    const { onSelect } = mount(); selectGroup('RelatedMeaning');
    container.querySelector('.graph-viz__node')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(container.querySelector('.graph-viz__detail')?.textContent).toContain('90%');
    button('Explore.Explore').click(); expect(onSelect).toHaveBeenCalledWith('sibling');
  });
  it('restores the group, page and viewport when going back and drops a forward branch on a new visit', () => {
    const { setValue, onSelect } = mount(dense);
    button('Explore.Next').click(); button('Neighborhood.ZoomIn').click();
    setValue({ ...neighborhood, center: { ...neighborhood.center, id: 'second' } }); button('Explore.Back').click(); expect(onSelect).toHaveBeenLastCalledWith('surface');
    setValue(dense); expect(container.querySelector('.graph-viz__node')?.textContent).toContain('Meaning 8');
    expect(container.querySelector('output')?.textContent).toBe('120%');
    expect(button('Explore.Forward').disabled).toBe(false);
    setValue({ ...neighborhood, center: { ...neighborhood.center, id: 'third' } });
    expect(button('Explore.Forward').disabled).toBe(true);
  });
  it('restores the search query for a revisited neighborhood', () => {
    const { setValue } = mount(dense);
    const input = container.querySelector('input')!;
    input.value = 'Meaning 212'; input.dispatchEvent(new Event('input', { bubbles: true }));
    setValue({ ...neighborhood, center: { ...neighborhood.center, id: 'second' } });
    button('Explore.Back').click(); setValue(dense);
    expect(container.querySelector('input')?.value).toBe('Meaning 212');
    expect(container.querySelectorAll('.graph-viz__node')).toHaveLength(1);
  });

  it('uses a separate selected relation even when entity IDs repeat', () => {
    mount({ ...dense, relations: [{ ...dense.relations[0], id: 'same', confidence: 0.2 }, { ...dense.relations[1], id: 'same', confidence: 0.9 }] });
    container.querySelectorAll('.graph-viz__node')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelectorAll('.graph-viz__node--selected')).toHaveLength(1);
    expect(container.querySelector('.graph-viz__detail')?.textContent).toContain('90%');
  });
  it('keeps an isolated entity visible in the heading without invented connections', () => {
    mount({ ...neighborhood, relations: [], relationCount: 0 });
    expect(container.querySelector('.graph-viz__heading')?.textContent).toContain('殖える');
    expect(container.querySelector('.graph-viz__empty')).not.toBeNull(); expect(container.querySelector('.graph-viz__node')).toBeNull();
  });
  it('supports keyboard pan, zoom and fit without changing graph nodes', () => {
    mount(); const canvas = container.querySelector('svg.graph-viz__svg')!;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })); expect(container.querySelector('output')?.textContent).toBe('120%');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(canvas.firstElementChild?.getAttribute('transform')).not.toBe('translate(0 0) scale(1)');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true })); expect(container.querySelector('output')?.textContent).toBe('100%');
  });
});
