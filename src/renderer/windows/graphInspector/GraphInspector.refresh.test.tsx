import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import type { GraphContextValue } from '../../context/GraphContext';
import type { GraphNeighborhood } from '../../../shared/graph/ipc';
import { GraphNeighborhoodViz as ActualViz, type GraphNeighborhoodVizProps } from '../../components/common/GraphNeighborhoodViz/GraphNeighborhoodViz';
import { DEFAULT_SETTINGS } from '../../../shared/types';
const state = vi.hoisted(() => ({ graph: undefined as GraphContextValue | undefined }));
vi.mock('../../context', () => ({
  useGraph: () => state.graph,
  useSettings: () => ({ settings: DEFAULT_SETTINGS }),
  useLocalization: () => ({ t: (key: string) => key }),
  useFlashcards: () => ({ store: { meta: {} } }),
  WindowWrapper: (props: { children: unknown }) => props.children,
}));
vi.mock('../../components/common', () => ({
  GraphNeighborhoodViz: (props: GraphNeighborhoodVizProps) => <ActualViz {...props} />,
  SkeletonText: () => <div>loading</div>, KnowledgeLoadError: () => <div>failed</div>,
}));
import { GraphInspectorContent } from './App';
it('keeps the actual relationship explorer mounted while same-language graph metadata refreshes', async () => {
  const [readiness, setReadiness] = createSignal<'ready' | 'pending'>('ready');
  const neighborhood: GraphNeighborhood = { revision: 1, center: { id: 'opaque-center', kind: 'x-future::utterance', label: 'Source center' }, centerDenseId: 0, relationCount: 0, relations: [] };
  state.graph = { language: () => 'source', readiness, meta: () => ({ ready: true, status: 'ready', entityCount: 1, relationCount: 0 }), getNeighborhood: async () => neighborhood, lookupWord: async () => null, getRelated: async () => [], getTargetsForSurfaces: async () => [] };
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => <GraphInspectorContent initialEntity={() => 'opaque-center'} />, host);
  try {
    await vi.waitFor(() => expect(host.querySelector('.graph-viz')).not.toBeNull());
    const explorer = host.querySelector('.graph-viz');
    setReadiness('pending');
    expect(host.querySelector('.graph-viz')).toBe(explorer);
    expect(host.textContent).toContain('Source center');
    setReadiness('ready'); await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.graph-viz')).toBe(explorer);
  } finally { dispose(); host.remove(); }
});
