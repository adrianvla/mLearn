// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

const hash = 'a'.repeat(64);
const entityId = `ja:surface:${hash}`;
const neighborhood = {
  center: { id: entityId, kind: 'surface' as const, label: '猫' }, centerDenseId: 4, relationCount: 2,
  relations: [
    { id: 'ja:pronunciation:x', kind: 'pronunciation' as const, label: 'ねこ', relationType: 'has-pronunciation' as const },
    { id: 'ja:surface:y', kind: 'surface' as const, label: '子猫', relationType: 'semantically-related' as const },
  ],
};

// Shared controls so tests can drive entity switches and fetch races.
let contextCallback: ((context: { entityId: string }) => void) | null = null;
const journalMocks = vi.hoisted(() => ({ rows: vi.fn(), archive: vi.fn() }));
const getNeighborhoodMock = vi.fn();
getNeighborhoodMock.mockResolvedValue(neighborhood);

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: import('solid-js').JSX.Element }) => <>{props.children}</>,
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { language: 'ja' } }),
  useFlashcards: () => ({ store: { meta: { learningSteps: [1], relearnSteps: [1], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 365 } } }),
  useGraph: () => ({ meta: () => ({ ready: true }), readiness: () => 'ready' as const, getNeighborhood: getNeighborhoodMock }),
}));
vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: { onWindowContext: (callback: (context: { entityId: string }) => void) => { contextCallback = callback; callback({ entityId }); return () => {}; }, getWindowContext: vi.fn(), openWindow: vi.fn() },
    knowledgeEvents: {
      getKnowledgeRows: journalMocks.rows,
      getKnowledgeArchive: journalMocks.archive,
    },
  }),
}));

import { GraphInspectorContent } from './App';

const flush = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

describe('GraphInspectorContent', () => {
  beforeEach(() => {
    contextCallback = null;
    getNeighborhoodMock.mockReset();
    getNeighborhoodMock.mockResolvedValue(neighborhood);
    journalMocks.rows.mockReset().mockResolvedValue({ [`ja:${hash}`]: [
      { t: 1, kind: 'rating', source: 'srs', aspect: 'reading', rating: 'good', easeAfter: 2.8, attemptId: 'active' },
      { t: 2, kind: 'rating', source: 'srs', aspect: 'reading', rating: 'easy', easeAfter: 3, attemptId: 'undo' },
      { t: 3, kind: 'retraction', source: 'srs', aspect: 'reading', retracts: 'undo' },
    ].map((event, seq) => ({ event, seq })) });
    journalMocks.archive.mockReset().mockResolvedValue({ key: `ja:${hash}` });
  });

  it('groups support separately and renders active evidence for target states', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <GraphInspectorContent />, container);
    await flush();
    (container.querySelector('.graph-inspector__details') as HTMLButtonElement).click();
    (container.querySelectorAll('.graph-inspector__chip')[1] as HTMLButtonElement).click();
    await flush();
    expect(container.textContent).toContain('mlearn.GraphInspector.State.Known');
    expect(container.textContent).not.toContain('easy');
    expect(container.textContent).toContain('good');
    dispose();
    container.remove();
  });

  it('labels the knowledge panel separately and omits raw graph diagnostics', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <GraphInspectorContent />, container);
    try {
      await flush();
      const knowledgeToggle = container.querySelector<HTMLButtonElement>('.graph-inspector__details')!;
      expect(knowledgeToggle.textContent).toBe('mlearn.GraphInspector.Knowledge');
      expect(knowledgeToggle.getAttribute('aria-expanded')).toBe('false');
      expect(knowledgeToggle.getAttribute('aria-controls')).toBe('graph-inspector-details');
      knowledgeToggle.click();

      expect(knowledgeToggle.getAttribute('aria-expanded')).toBe('true');
      expect(container.textContent).not.toContain(entityId);
      expect(container.textContent).not.toContain('dense: 4');
      expect(container.textContent).not.toContain('relations: 2');
      expect(container.textContent).toContain('mlearn.GraphInspector.Capabilities');
    } finally { dispose(); container.remove(); }
  });

  it.each(['rows', 'archive'] as const)('withholds no-evidence conclusions after %s failure and retries the same scope', async (owner) => {
    journalMocks[owner].mockRejectedValueOnce(new Error('journal unavailable'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <GraphInspectorContent />, container);
    try {
      await flush(); await flush();
      (container.querySelector('.graph-inspector__details') as HTMLButtonElement).click();
      (container.querySelectorAll('.graph-inspector__chip')[1] as HTMLButtonElement).click();
      await flush();
      expect(container.querySelector('[role="alert"]')).toBeTruthy();
      expect(container.textContent).not.toContain('mlearn.GraphInspector.NoDirectEvidence');
      (container.querySelector('[role="alert"] button') as HTMLButtonElement).click();
      await flush(); await flush();
      expect(journalMocks.rows).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain('mlearn.GraphInspector.State.Known');
    } finally { dispose(); container.remove(); }
  });

  it('ignores a superseded neighborhood resolution after the entity changes', async () => {
    // First fetch (initial entity) is held back; the switched entity's fetch
    // resolves immediately — then the stale resolution lands last.
    let resolveStale!: (value: typeof neighborhood) => void;
    getNeighborhoodMock.mockReset();
    getNeighborhoodMock.mockImplementation((query: { entityId: string }) => {
      if (query.entityId === entityId) {
        return new Promise<typeof neighborhood>((resolve) => { resolveStale = resolve; });
      }
      return Promise.resolve({ center: { id: 'ja:surface:z', kind: 'surface' as const, label: 'fresh' }, centerDenseId: 1, relationCount: 1, relations: [{ id: 'ja:surface:w', kind: 'surface' as const, label: 'rel', relationType: 'semantically-related' as const }] });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <GraphInspectorContent />, container);
    await flush();
    // Initial fetch still in flight: no neighborhood content yet.
    expect(container.querySelector('svg')).toBeNull();

    // Switch entity: the fresh neighborhood resolves while the first is pending.
    contextCallback?.({ entityId: 'ja:surface:z' });
    await flush();
    await flush();
    expect(container.textContent).toContain('fresh');

    // The superseded resolution must NOT overwrite the fresh neighborhood.
    resolveStale({ ...neighborhood, center: { ...neighborhood.center, label: 'STALE' } });
    await flush();
    await flush();
    expect(container.textContent).toContain('fresh');
    expect(container.textContent).not.toContain('STALE');

    dispose();
    container.remove();
  });
});
