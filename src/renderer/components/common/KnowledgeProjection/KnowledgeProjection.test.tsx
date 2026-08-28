// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';

const installLanguageDataMock = vi.fn();
const lookupWordMock = vi.fn();
const getNeighborhoodMock = vi.fn();
let graphMeta: { entityCount: number; relationCount: number; ready: boolean; status: 'ready' | 'not-installed' | 'unavailable' | 'error' } = { entityCount: 4, relationCount: 3, ready: true, status: 'ready' };
vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { language: 'ja' } }),
  useLanguage: () => ({ installLanguageData: installLanguageDataMock }),
}));

vi.mock('../../../context/GraphContext', () => ({
  useOptionalGraph: () => ({
    meta: () => graphMeta,
    lookupWord: lookupWordMock,
    getNeighborhood: getNeighborhoodMock,
    getRelated: async () => [],
    getTargetsForSurfaces: async () => [],
  }),
}));

const evidenceProjection: KnowledgeProjection = {
  status: 'ready',
  targets: [{ targetRef: { kind: 'surface', id: 'surface-id' }, applicableCapabilities: ['surface-recognition'], states: [{
    capability: 'surface-recognition', classification: 'known', basis: 'evidence',
    evidence: [{ timestamp: 1, source: 'Anki' }, { timestamp: 2, source: 'Flashcards' }],
    evidenceSourceCounts: { Anki: 1, Flashcards: 1 },
  }] }],
};

const inspectorProjection: KnowledgeProjection = {
  status: 'ready',
  surfaceId: 'ja:surface:hash',
  targets: [
    {
      targetRef: { kind: 'surface', id: 'ja:surface:hash' },
      applicableCapabilities: ['surface-recognition'],
      states: [{
        capability: 'surface-recognition', classification: 'known', basis: 'claim',
        evidence: [{ timestamp: 1, source: 'Anki' }],
        evidenceSourceCounts: { Anki: 1 },
        retention: { pressure: 0.3, dueAt: 1000 },
        prediction: { value: 0.62, reasons: ['ja:surface:inu → ja:sense:s1 (semantically-related)'] },
      }],
    },
    {
      targetRef: { kind: 'sense', id: 'ja:sense:s1' },
      applicableCapabilities: ['sense-recognition'],
      states: [{
        capability: 'sense-recognition', classification: 'unmeasured', basis: 'unmeasured',
        evidence: [], evidenceSourceCounts: {},
      }],
    },
  ],
};

const journal: KnowledgeEvent[] = [
  { t: 3, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' },
  { t: 2, kind: 'claim', source: 'manual', aspect: 'meaning' },
  { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2.4, attemptId: 'a1', quality: 'fluent' },
];

function neighborhoodLookup() {
  lookupWordMock.mockResolvedValue({
    surfaceId: 'ja:surface:hash',
    entries: [{ id: 'ja:dictionary-entry:e1', kind: 'dictionary-entry', label: '猫' }],
    lexemes: [{ id: 'ja:lexeme:neko', kind: 'lexeme', label: '猫' }],
    senses: [{ id: 'ja:sense:s1', kind: 'sense', label: 'cat' }],
    pronunciations: [{ id: 'ja:pronunciation:neko', kind: 'pronunciation', label: 'ねこ' }],
  });
  getNeighborhoodMock.mockResolvedValue({
    center: { id: 'ja:surface:hash', kind: 'surface', label: '猫' },
    centerDenseId: 0,
    relationCount: 2,
    relations: [
      { id: 'ja:dictionary-entry:e1', kind: 'dictionary-entry', label: '猫', relationType: 'realizes', provenance: 'jmdict' },
      { id: 'ja:surface:inu', kind: 'surface', label: '犬', relationType: 'semantically-related', confidence: 0.9 },
    ],
  });
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

async function renderDrawer(overrides: Partial<{ surface: string; events: KnowledgeEvent[]; initialTab: string }> = {}) {
  const { KnowledgeProjectionDrawer } = await import('./KnowledgeProjection');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <KnowledgeProjectionDrawer
      projection={inspectorProjection}
      open={true}
      onClose={() => undefined}
      surface={overrides.surface ?? '猫'}
      events={overrides.events ?? journal}
      initialTab={overrides.initialTab as 'identity' | 'targets' | 'evidence' | 'prediction' | undefined}
    />
  ), host);
  await flushAsync();
  await flushAsync();
  return { host, dispose };
}

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
    expect(knowledgeTone({ basis: 'claim', classification: 'known' })).toBe('claim');
    expect(knowledgeTone({ basis: 'evidence', classification: 'known' })).toBe('evidence');
  });
});

describe('KnowledgeProjectionDrawer inspector', () => {
  beforeEach(() => {
    installLanguageDataMock.mockReset();
    lookupWordMock.mockReset();
    getNeighborhoodMock.mockReset();
    graphMeta = { entityCount: 4, relationCount: 3, ready: true, status: 'ready' };
    neighborhoodLookup();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows dictionary identity and relations grouped by category with provenance on the identity tab', async () => {
    const { host, dispose } = await renderDrawer();
    expect(host.querySelector('.knowledge-drawer__identity')).not.toBeNull();
    expect(host.textContent).toContain('猫');
    expect(host.textContent).toContain('ねこ');
    // realizes is property; semantically-related is support with the not-knowledge caption.
    const relations = host.querySelectorAll('.knowledge-drawer__relations li');
    expect(relations.length).toBe(2);
    expect(host.textContent).toContain('realizes');
    expect(host.textContent).toContain('semantically-related');
    expect(host.textContent).toContain('jmdict');
    expect(host.textContent).toContain('mlearn.GraphInspector.SupportCaption');
    expect(lookupWordMock).toHaveBeenCalledWith({ surface: '猫' });
    expect(getNeighborhoodMock).toHaveBeenCalledWith({ entityId: 'ja:surface:hash', depth: 1 });
    dispose();
  });

  it('shows basis tokens per target and an explicit-claim override distinctly on the targets tab', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'targets' });
    const targets = host.querySelectorAll('.knowledge-drawer__target');
    expect(targets.length).toBe(2);
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Claim.Known');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.ClaimOverride');
    expect(host.textContent).toContain('mlearn.Knowledge.Basis.Unmeasured');
    expect(host.textContent).not.toContain('mlearn.Knowledge.Basis.Claim');
    dispose();
  });

  it('renders the full journal as an event-first timeline with claims distinct from ratings', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'evidence' });
    const timeline = host.querySelectorAll('.knowledge-timeline__event');
    expect(timeline.length).toBeGreaterThan(0);
    const claimRows = host.querySelectorAll('.knowledge-timeline__event--claim');
    expect(claimRows.length).toBe(2);
    expect(host.textContent).toContain('mlearn.Knowledge.History.Kind.Claim');
    expect(host.textContent).toContain('mlearn.Knowledge.History.Source.Anki');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Provenance');
    expect(host.textContent).toContain('Anki 1');
    dispose();
  });

  it('shows prediction value and reasons visually separate from evidence', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'prediction' });
    expect(host.textContent).toContain('62%');
    expect(host.textContent).toContain('ja:surface:inu → ja:sense:s1 (semantically-related)');
    expect(host.querySelector('.knowledge-drawer__prediction.knowledge-state--predicted')).not.toBeNull();
    dispose();
  });

  it('honestly degrades when the graph is not installed and offers the install affordance', async () => {
    graphMeta = { entityCount: 0, relationCount: 0, ready: false, status: 'not-installed' };
    const { host, dispose } = await renderDrawer();
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.NotInstalled');
    const install = host.querySelector('.knowledge-drawer__install') as HTMLButtonElement | null;
    expect(install).not.toBeNull();
    install?.click();
    expect(installLanguageDataMock).toHaveBeenCalledWith('ja');
    dispose();
  });

  it('honestly degrades when the graph is ready but the surface is absent from it', async () => {
    lookupWordMock.mockResolvedValue(null);
    const { host, dispose } = await renderDrawer();
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.NoGraph');
    dispose();
  });
});