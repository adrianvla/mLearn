// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import { KnowledgeCapabilitySummary } from './KnowledgeCapabilitySummary';
vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));
vi.mock('../../../hooks/useKnowledgeProjection', () => ({ useKnowledgeProjection: () => ({ projection: () => undefined }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
describe('canonical capability summary', () => {
  it('renders applicability including unseen package concepts while preserving evidence and claim basis', async () => {
    const [projection, setProjection] = createSignal<KnowledgeProjection>({ status: 'ready', targets: [{
      targetRef: { kind: 'surface', id: 'synthetic' },
      applicableCapabilities: ['sense-recognition', 'x-package::novel'],
      states: [{ capability: 'sense-recognition', classification: 'known', basis: 'claim', evidence: [], evidenceSourceCounts: {} }],
    }] });
    const container = document.createElement('div'); document.body.append(container);
    dispose = render(() => <KnowledgeCapabilitySummary word="word" language="synthetic" projection={projection()} />, container);
    expect(container.querySelectorAll('.knowledge-capability-summary__item')).toHaveLength(1);
    expect(container.textContent).not.toContain('x-package::novel');
    expect(container.querySelector('.knowledge-capability-summary__item--claim')).not.toBeNull();
    expect(container.querySelector('.knowledge-capability-summary__item--unmeasured')).toBeNull();
    expect(container.textContent).not.toContain('prosodic-pattern');
    setProjection({ status: 'ready', targets: [] });
    await Promise.resolve();
    expect(container.querySelector('.knowledge-capability-summary')).toBeNull();
  });
});
