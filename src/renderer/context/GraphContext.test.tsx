import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphProvider, useGraph, type GraphContextValue } from './GraphContext';
import type { LanguageDataMap } from '../../shared/types';
import type { GraphMeta } from '../../shared/graph/ipc';

let packageUpdate: ((data: LanguageDataMap) => void) | undefined;
const mockBridge = {
  localization: { onLangData: vi.fn((callback: (data: LanguageDataMap) => void) => { packageUpdate = callback; return () => { packageUpdate = undefined; }; }) },
  graph: {
    getGraphMeta: vi.fn(),
    getGraphNeighborhood: vi.fn().mockResolvedValue(null),
    lookupGraphWord: vi.fn(),
    getGraphRelated: vi.fn(),
    getGraphTargetsForSurfaces: vi.fn(),
  },
};
vi.mock('../../shared/bridges', () => ({ getBridge: () => mockBridge }));
vi.mock('./SettingsContext', () => ({ useSettings: () => ({ settings: { language: 'ja' } }) }));

describe('GraphContext', () => {
  afterEach(() => vi.clearAllMocks());

  it('exposes ready metadata and routes batched surface queries through the bridge', async () => {
    mockBridge.graph.getGraphMeta.mockResolvedValue({ entityCount: 4, relationCount: 4, ready: true, status: 'ready' });
    mockBridge.graph.getGraphTargetsForSurfaces.mockResolvedValue([{ input: { surface: '猫' }, lookup: null }]);
    let graph: GraphContextValue | undefined;
    const dispose = render(() => <GraphProvider><Probe onReady={(value) => { graph = value; }} /></GraphProvider>, document.body);

    await vi.waitFor(() => expect(graph?.meta().ready).toBe(true));
    await graph!.getTargetsForSurfaces([{ surface: '猫' }]);
    expect(mockBridge.graph.getGraphTargetsForSurfaces).toHaveBeenCalledWith('ja', [{ surface: '猫' }]);
    await graph!.getNeighborhood({ entityId: 'ja:surface:x' });
    expect(mockBridge.graph.getGraphNeighborhood).toHaveBeenCalledWith('ja', { entityId: 'ja:surface:x', thresholds: { learning: 1.55, known: 1.8 } });
    dispose();
  });

  it('routes an explicitly scoped inspector through its source package instead of the study language', async () => {
    mockBridge.graph.getGraphMeta.mockResolvedValue({ entityCount: 1, relationCount: 0, ready: true, status: 'ready' });
    mockBridge.graph.lookupGraphWord.mockResolvedValue(null);
    let graph: GraphContextValue | undefined;
    const dispose = render(() => <GraphProvider language={() => 'future-package'}><Probe onReady={(value) => { graph = value; }} /></GraphProvider>, document.body);
    try {
      await vi.waitFor(() => expect(graph?.readiness()).toBe('ready'));
      await graph!.lookupWord({ surface: 'source' });
      expect(mockBridge.graph.getGraphMeta).toHaveBeenCalledWith('future-package');
      expect(mockBridge.graph.lookupGraphWord).toHaveBeenCalledWith('future-package', { surface: 'source' });
    } finally { dispose(); }
  });

  it('invalidates same-language readiness on package activation and admits the new graph revision', async () => {
    mockBridge.graph.getGraphMeta.mockResolvedValueOnce({ entityCount: 4, relationCount: 4, revision: 1, ready: true, status: 'ready' });
    let resolveMeta!: (meta: GraphMeta) => void;
    mockBridge.graph.getGraphMeta.mockImplementationOnce(() => new Promise<GraphMeta>(resolve => { resolveMeta = resolve; }));
    let graph!: GraphContextValue;
    const dispose = render(() => <GraphProvider><Probe onReady={value => { graph = value; }} /></GraphProvider>, document.body);
    try {
      await vi.waitFor(() => expect(graph.readiness()).toBe('ready'));
      packageUpdate!({ ja: { name: 'Source', settings: { fixed: {} }, languageData: { activationGeneration: 'new-generation', assets: [] } } });
      expect(graph.readiness()).toBe('pending');
      resolveMeta({ entityCount: 5, relationCount: 5, revision: 2, ready: true, status: 'ready' });
      await vi.waitFor(() => expect(graph.readiness()).toBe('ready'));
      await graph.getNeighborhood({ entityId: 'center' });
      expect(mockBridge.graph.getGraphNeighborhood).toHaveBeenLastCalledWith('ja', expect.objectContaining({ revision: 2 }));
    } finally { dispose(); }
  });

  it('makes the unavailable capability an explicit no-query fallback', async () => {
    mockBridge.graph.getGraphMeta.mockResolvedValue({ entityCount: 0, relationCount: 0, ready: false, status: 'unavailable' });
    let graph: GraphContextValue | undefined;
    const dispose = render(() => <GraphProvider><Probe onReady={(value) => { graph = value; }} /></GraphProvider>, document.body);

    await vi.waitFor(() => expect(graph?.meta().status).toBe('unavailable'));
    await expect(graph!.lookupWord({ surface: '猫' })).resolves.toBeNull();
    expect(mockBridge.graph.lookupGraphWord).not.toHaveBeenCalled();
    dispose();
  });

  it('projects the probe onto the shared readiness contract', async () => {
    let resolveMeta!: (meta: GraphMeta) => void;
    mockBridge.graph.getGraphMeta.mockReturnValue(new Promise<GraphMeta>((resolve) => { resolveMeta = resolve; }));
    let graph: GraphContextValue | undefined;
    const dispose = render(() => <GraphProvider><Probe onReady={(value) => { graph = value; }} /></GraphProvider>, document.body);

    // While the probe is in flight the meta placeholder must read as pending,
    // never as the terminal unavailable contract.
    expect(graph?.readiness()).toBe('pending');

    resolveMeta({ entityCount: 0, relationCount: 0, ready: false, status: 'not-installed' });
    await vi.waitFor(() => expect(graph?.readiness()).toBe('unavailable'));
    dispose();
  });

  it('reports a failed probe as failed readiness, not as a permanent pending', async () => {
    mockBridge.graph.getGraphMeta.mockRejectedValue(new Error('probe failed'));
    let graph: GraphContextValue | undefined;
    const dispose = render(() => <GraphProvider><Probe onReady={(value) => { graph = value; }} /></GraphProvider>, document.body);

    await vi.waitFor(() => expect(graph?.readiness()).toBe('failed'));
    dispose();
  });
});

function Probe(props: { onReady: (graph: GraphContextValue) => void }) {
  props.onReady(useGraph());
  return null;
}
