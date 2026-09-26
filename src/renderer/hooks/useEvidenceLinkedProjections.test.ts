import { describe, it, expect, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useEvidenceLinkedProjections } from './useEvidenceLinkedProjections';
const keys = vi.hoisted(() => vi.fn());
const linked = vi.hoisted(() => vi.fn());
const project = vi.hoisted(() => vi.fn());
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings: { easeThresholdKnown: 1.8, easeThresholdLearning: 1.55 } }) }));
vi.mock('../services/knowledgeEvents', () => ({ queryLanguageKeys: keys, wordEventsVersion: () => 0 }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ graph: { getEvidenceLinkedSurfaces: linked, getKnowledgeProjection: project } }) }));

describe('evidence-linked summary contract', () => {
  it('waits for the journal, resolves a sibling through the graph, and leaves unseen surfaces unmeasured', async () => {
    let finish!: (keys: string[]) => void;
    keys.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    linked.mockResolvedValue(['variant']);
    project.mockResolvedValue({ status: 'ready', targets: [], lexical: { overall: { classification: 'known', basis: 'evidence' } } });
    const root = createRoot(dispose => ({ dispose, state: useEvidenceLinkedProjections(() => ({ language: 'x-new', surfaces: ['variant', 'unseen'], materializedKeys: ['x-new:stored'] })) }));
    await Promise.resolve();
    expect(root.state.ready()).toBe(false);
    finish(['x-new:sibling']);
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    expect(linked).toHaveBeenCalledWith('x-new', ['variant', 'unseen'], ['x-new:sibling', 'x-new:stored']);
    expect(root.state.resolveState('variant')).toEqual({ status: 'known', basis: 'evidence' });
    expect(root.state.resolveState('unseen')).toEqual({ status: 'unknown', basis: 'unmeasured' });
    root.dispose();
  });

  it('does not publish the previous language after a switch or treat failed reads as empty success', async () => {
    keys.mockResolvedValue([]);
    linked.mockResolvedValue([]);
    const [language, setLanguage] = createSignal('old');
    const root = createRoot(dispose => ({ dispose, state: useEvidenceLinkedProjections(() => ({ language: language(), surfaces: [], materializedKeys: [] })) }));
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    keys.mockRejectedValueOnce(new Error('unavailable'));
    setLanguage('new');
    expect(root.state.ready()).toBe(false);
    await vi.waitFor(() => expect(root.state.failed()).toBe(true));
    expect(root.state.ready()).toBe(false);
    root.state.retry();
    await vi.waitFor(() => expect(root.state.ready()).toBe(true));
    root.dispose();
  });
});
