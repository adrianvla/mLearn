import { createElectronBridge } from './electronBridge';
import { describe, expect, it, vi } from 'vitest';

describe('electron graph bridge', () => {
  it('delegates graph queries to the preload contract', async () => {
    const ipc = {
      getGraphMeta: vi.fn().mockResolvedValue({ ready: true, status: 'ready', entityCount: 1, relationCount: 0 }),
      lookupGraphWord: vi.fn().mockResolvedValue(null),
      getGraphRelated: vi.fn().mockResolvedValue([]),
      getGraphTargetsForSurfaces: vi.fn().mockResolvedValue([]),
      getGraphNeighborhood: vi.fn().mockResolvedValue(null),
      getKnowledgeProjection: vi.fn().mockResolvedValue({ status: 'ready', targets: [] }),
    };
    window.mLearnIPC = ipc as unknown as typeof window.mLearnIPC;
    const graph = createElectronBridge().graph;

    await graph.getGraphMeta('ja');
    await graph.lookupGraphWord('ja', { surface: '猫' });
    await graph.getGraphRelated('ja', 'ja:surface:x', ['realizes']);
    await graph.getGraphTargetsForSurfaces('ja', [{ surface: '猫' }]);
    await graph.getGraphNeighborhood('ja', { entityId: 'ja:surface:x' });
    await graph.getKnowledgeProjection('ja', '猫');

    expect(ipc.getGraphMeta).toHaveBeenCalledWith('ja');
    expect(ipc.lookupGraphWord).toHaveBeenCalledWith('ja', { surface: '猫' });
    expect(ipc.getGraphRelated).toHaveBeenCalledWith('ja', 'ja:surface:x', ['realizes']);
    expect(ipc.getGraphTargetsForSurfaces).toHaveBeenCalledWith('ja', [{ surface: '猫' }]);
    expect(ipc.getGraphNeighborhood).toHaveBeenCalledWith('ja', { entityId: 'ja:surface:x' });
    expect(ipc.getKnowledgeProjection).toHaveBeenCalledWith('ja', '猫');
  });
});
