import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphProvider, useGraph } from './GraphContext';

const mockBridge = {
  graph: {
    getGraphMeta: vi.fn(),
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
    let graph: ReturnType<typeof useGraph> | undefined;
    const dispose = render(() => <GraphProvider><Probe onReady={(value) => { graph = value; }} /></GraphProvider>, document.body);

    await vi.waitFor(() => expect(graph?.meta().ready).toBe(true));
    await graph!.getTargetsForSurfaces([{ surface: '猫' }]);
    expect(mockBridge.graph.getGraphTargetsForSurfaces).toHaveBeenCalledWith('ja', [{ surface: '猫' }]);
    dispose();
  });

  it('makes the unavailable capability an explicit no-query fallback', async () => {
    mockBridge.graph.getGraphMeta.mockResolvedValue({ entityCount: 0, relationCount: 0, ready: false, status: 'unavailable' });
    let graph: ReturnType<typeof useGraph> | undefined;
    const dispose = render(() => <GraphProvider><Probe onReady={(value) => { graph = value; }} /></GraphProvider>, document.body);

    await vi.waitFor(() => expect(graph?.meta().status).toBe('unavailable'));
    await expect(graph!.lookupWord({ surface: '猫' })).resolves.toBeNull();
    expect(mockBridge.graph.lookupGraphWord).not.toHaveBeenCalled();
    dispose();
  });
});

function Probe(props: { onReady: (graph: ReturnType<typeof useGraph>) => void }) {
  props.onReady(useGraph());
  return null;
}
