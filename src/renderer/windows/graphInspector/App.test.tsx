// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
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

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: import('solid-js').JSX.Element }) => <>{props.children}</>,
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { language: 'ja' } }),
  useFlashcards: () => ({ store: { meta: { learningSteps: [1], relearnSteps: [1], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 365 } } }),
  useGraph: () => ({ meta: () => ({ ready: true }), getNeighborhood: vi.fn().mockResolvedValue(neighborhood) }),
}));
vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: { onWindowContext: (callback: (context: { entityId: string }) => void) => { callback({ entityId }); return () => {}; }, getWindowContext: vi.fn(), openWindow: vi.fn() },
    knowledgeEvents: { getKnowledgeEvents: vi.fn().mockResolvedValue({ [`ja:${hash}`]: [
      { t: 1, kind: 'rating', source: 'srs', aspect: 'reading', rating: 'good', easeAfter: 2.8, attemptId: 'active' },
      { t: 2, kind: 'rating', source: 'srs', aspect: 'reading', rating: 'easy', easeAfter: 3, attemptId: 'undo' },
      { t: 3, kind: 'retraction', source: 'srs', aspect: 'reading', retracts: 'undo' },
    ] }) },
  }),
}));

import { GraphInspectorContent } from './App';

describe('GraphInspectorContent', () => {
  it('groups support separately and renders active evidence for target states', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <GraphInspectorContent />, container);
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(container.textContent).toContain('mlearn.GraphInspector.SupportCaption');
    expect(container.textContent).toContain('mlearn.GraphInspector.identity');
    expect(container.textContent).toContain('mlearn.GraphInspector.property');
    (container.querySelectorAll('.graph-inspector__chip')[1] as HTMLButtonElement).click();
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(container.textContent).toContain('mlearn.GraphInspector.State.Known');
    expect(container.textContent).not.toContain('easy');
    expect(container.textContent).toContain('good');
    dispose();
    container.remove();
  });
});
