// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';

vi.mock('../../../context', () => ({ useLocalization: () => ({ t: (key: string) => key }) }));

const evidenceProjection: KnowledgeProjection = {
  status: 'ready',
  targets: [{ targetRef: { kind: 'surface', id: 'surface-id' }, applicableCapabilities: ['surface-recognition'], states: [{
    capability: 'surface-recognition', classification: 'known', basis: 'evidence',
    evidence: [{ timestamp: 1, source: 'Anki' }, { timestamp: 2, source: 'Flashcards' }],
    evidenceSourceCounts: { Anki: 1, Flashcards: 1 },
  }] }],
};

describe('KnowledgeCapabilityChips', () => {
  it('keeps multiple evidence sources distinct instead of claiming one global source', async () => {
    const { KnowledgeCapabilityChips } = await import('./KnowledgeProjection');
    const host = document.createElement('div');
    render(() => <KnowledgeCapabilityChips projection={evidenceProjection} />, host);
    expect(host.textContent).not.toContain('Source:');
    expect(host.querySelector('.knowledge-chip small')?.getAttribute('title')).toContain('Anki: 1, Flashcards: 1');
  });

  it('renders predicted, unmeasured, and excluded states as distinct non-evidence tokens', async () => {
    const { knowledgeTone } = await import('./KnowledgeProjection');
    expect(knowledgeTone({ basis: 'prediction', classification: 'predicted' })).toBe('predicted');
    expect(knowledgeTone({ basis: 'unmeasured', classification: 'unmeasured' })).toBe('unmeasured');
    expect(knowledgeTone({ basis: 'excluded', classification: 'excluded' })).toBe('excluded');
    expect(knowledgeTone({ basis: 'evidence', classification: 'known' })).toBe('evidence');
  });
});
