// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { knowledgeTone, knowledgeWhyNarrative } from './KnowledgeProjection';
import { assembleWordKnowledgeModel } from './wordKnowledgeModel';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';

const installLanguageDataMock = vi.fn();
const lookupWordMock = vi.fn();
const getNeighborhoodMock = vi.fn();
let graphMeta: { entityCount: number; relationCount: number; ready: boolean; status: 'ready' | 'not-installed' | 'unavailable' | 'error' } = { entityCount: 4, relationCount: 3, ready: true, status: 'ready' };
vi.mock('../../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({ settings: { language: 'ja' } }),
  useLanguage: () => ({
    installLanguageData: installLanguageDataMock,
    getLanguageDataStatus: () => ({ assets: [{ path: 'ja.graph.json' }] }),
  }),
}));

vi.mock('../../../context/GraphContext', () => ({
  useOptionalGraph: () => ({
    meta: () => graphMeta,
    readiness: () => (graphMeta.ready ? 'ready' : 'unavailable'),
    lookupWord: (input: { surface?: string }) => lookupWordMock(input),
    getNeighborhood: (query: { entityId: string; depth?: number }) => getNeighborhoodMock(query),
  }),
}));

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
        prediction: { value: 0.62, reasons: ['ja:surface:inu → ja:dictionary-entry:e1 (realizes)'] },
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

const comprehensive = {
  status: 'known' as const,
  basis: 'claim' as const,
  evidenceStatus: 'unknown' as const,
  source: 'Manual' as const,
  timesSeen: 0,
  excluded: false,
  claim: 'known' as const,
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

const flushAsync = () => { const { promise, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 0); return promise; };

async function renderDrawer(overrides: Partial<{
  initialTab: string;
  projection: KnowledgeProjection;
  events: KnowledgeEvent[];
  onWordClaim: (claim: string | null) => void;
  onAccessClaim: (capability: string, claim: string | null) => void;
  onSelectEntity: (entityId: string) => void;
  onGraph: (entityId: string) => void;
}> = {}) {
  const { KnowledgeProjectionDrawer } = await import('./KnowledgeProjection');
  const host = document.createElement('div');
  document.body.appendChild(host);
  // The drawer portals itself to document.body (transform-ancestors escape),
  // so queries must target the document, not the render host. The facade keeps
  // every assertion unchanged.
  const portalScope = {
    querySelector: (selector: string) => document.querySelector(selector),
    querySelectorAll: (selector: string) => document.querySelectorAll(selector),
    get textContent() { return document.body.textContent ?? ''; },
  } as unknown as HTMLDivElement;
  const model = assembleWordKnowledgeModel({ comprehensive, projection: overrides.projection ?? inspectorProjection, events: 'events' in overrides ? overrides.events : journal });
  const dispose = render(() => (
    <KnowledgeProjectionDrawer
      model={model}
      open={true}
      onClose={() => undefined}
      onGraph={overrides.onGraph}
      onSelectEntity={overrides.onSelectEntity}
      surface="猫"
      initialTab={overrides.initialTab as 'overview' | 'relations' | 'history' | 'prediction' | undefined}
      onWordClaim={overrides.onWordClaim}
      onAccessClaim={overrides.onAccessClaim as never}
    />
  ), host);
  await flushAsync();
  await flushAsync();
  return { host: portalScope, dispose };
}

describe('knowledgeTone', () => {
  it('renders predicted, unmeasured, and claim/evidence tones as distinct non-evidence tokens', () => {
    expect(knowledgeTone({ basis: 'prediction', classification: 'predicted' })).toBe('predicted');
    expect(knowledgeTone({ basis: 'unmeasured', classification: 'unmeasured' })).toBe('unmeasured');
    expect(knowledgeTone({ basis: 'claim', classification: 'unknown' })).toBe('claim');
    expect(knowledgeTone({ basis: 'claim', classification: 'known' })).toBe('claim');
    expect(knowledgeTone({ basis: 'evidence', classification: 'known' })).toBe('evidence');
  });
});

describe('KnowledgeProjectionDrawer overview', () => {
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

  it('opens on the overview tab with the word header, overall status, and basis', async () => {
    const { host, dispose } = await renderDrawer();
    expect(host.querySelector('.knowledge-drawer__surface')?.textContent).toBe('猫');
    expect(host.querySelector('.knowledge-drawer__overall-status')?.textContent).toBe('mlearn.WordHover.Status.Known');
    expect(host.querySelector('.knowledge-drawer__overall-basis')?.textContent).toBe('mlearn.Knowledge.Basis.Claim');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Tabs.Overview');
    expect(lookupWordMock).toHaveBeenCalledWith({ surface: '猫' });
    dispose();
  });

  it('presents capabilities as readable cards with friendly labels and why lines', async () => {
    const { host, dispose } = await renderDrawer();
    const cards = host.querySelectorAll('.knowledge-card');
    expect(cards.length).toBeGreaterThan(1);
    const overall = host.querySelector('.knowledge-card--overall');
    expect(overall?.textContent).toContain('mlearn.Knowledge.Popup.Overall');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Why.Claim');
    // No raw entity id leaks anywhere; capability labels resolve through keys.
    expect(host.textContent).not.toContain('ja:surface:');
    expect(host.textContent).toContain('mlearn.Knowledge.Capability.surface-recognition');
    dispose();
  });

  it('keeps claim editing behind the Adjust disclosure and routes word claims', async () => {
    const onWordClaim = vi.fn();
    const { host, dispose } = await renderDrawer({ onWordClaim });
    // Editing controls are hidden until Adjust.
    expect(host.querySelector('.knowledge-claim-controls')).toBeNull();
    const adjust = Array.from(host.querySelectorAll('.knowledge-card--overall button')).find((button) => button.textContent === 'mlearn.Knowledge.Projection.Adjust') as HTMLButtonElement;
    adjust.click();
    const controls = host.querySelector('.knowledge-card--overall .knowledge-claim-controls')!;
    expect(controls).not.toBeNull();
    const known = Array.from(controls.querySelectorAll('button')).find((button) => button.textContent === 'mlearn.WordHover.Status.Known') as HTMLButtonElement;
    known.click();
    expect(onWordClaim).toHaveBeenCalledWith('known');
    dispose();
  });

  it('falls back to passive familiarity, never evidence, when the graph is absent', async () => {
    const { KnowledgeProjectionDrawer } = await import('./KnowledgeProjection');
    const mountHost = document.createElement('div');
    document.body.appendChild(mountHost);
    const model = assembleWordKnowledgeModel({
      comprehensive: { ...comprehensive, status: 'unknown', basis: 'unmeasured', claim: undefined, timesSeen: 7 },
      projection: { status: 'ready', targets: [] },
      events: [],
    });
    const dispose = render(() => (
      <KnowledgeProjectionDrawer model={model} open onClose={() => undefined} surface="猫" />
    ), mountHost);
    await flushAsync();
    expect(document.body.textContent).toContain('mlearn.Knowledge.Projection.Why.Passive');
    expect(document.body.textContent).not.toContain('mlearn.Knowledge.Projection.Why.Evidence');
    dispose();
  });

  it('marks exclusion from the model aggregate', async () => {
    const { KnowledgeProjectionDrawer } = await import('./KnowledgeProjection');
    const mountHost = document.createElement('div');
    document.body.appendChild(mountHost);
    const model = assembleWordKnowledgeModel({
      comprehensive: { ...comprehensive, excluded: true, claim: undefined, status: 'unknown', basis: 'unmeasured' },
      projection: inspectorProjection,
      events: [],
    });
    const dispose = render(() => (
      <KnowledgeProjectionDrawer model={model} open onClose={() => undefined} surface="猫" />
    ), mountHost);
    await flushAsync();
    expect(document.body.textContent).toContain('mlearn.Knowledge.Projection.Excluded');
    dispose();
  });
});

describe('KnowledgeProjectionDrawer relations', () => {
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

  it('groups relations as human concepts without leaking raw ontology names', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'relations' });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Pronunciations');
    expect(host.textContent).toContain('ねこ');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Relations.Sections.Forms');
    expect(host.textContent).toContain('猫');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Relations.Sections.Related');
    expect(host.textContent).toContain('犬');
    // Raw relation type and provenance stay behind the advanced toggle.
    expect(host.textContent).not.toContain('realizes');
    expect(host.textContent).not.toContain('semantically-related');
    expect(host.textContent).not.toContain('jmdict');
    dispose();
  });

  it('reveals raw ontology metadata only under the advanced details toggle', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'relations' });
    const toggle = host.querySelector('.knowledge-relations__meta-toggle') as HTMLButtonElement;
    toggle.click();
    expect(host.textContent).toContain('realizes');
    expect(host.textContent).toContain('jmdict');
    dispose();
  });

  it('makes every relation row recenter the drawer and host graph via onSelectEntity', async () => {
    const onSelectEntity = vi.fn();
    const { host, dispose } = await renderDrawer({ initialTab: 'relations', onSelectEntity });
    const row = Array.from(host.querySelectorAll('.knowledge-relations__row')).find((button) => button.textContent?.includes('猫')) as HTMLButtonElement;
    row.click();
    await flushAsync();
    await flushAsync();
    expect(onSelectEntity).toHaveBeenCalledWith('ja:dictionary-entry:e1');
    expect(getNeighborhoodMock).toHaveBeenCalledWith({ entityId: 'ja:dictionary-entry:e1', depth: 1 });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Viewing');
    dispose();
  });

  it('keeps openGraphInspector as the secondary affordance per relation row', async () => {
    const onGraph = vi.fn();
    const { host, dispose } = await renderDrawer({ initialTab: 'relations', onGraph });
    const item = Array.from(host.querySelectorAll('.knowledge-relations__item')).find((li) => li.textContent?.includes('猫')) as HTMLLIElement;
    const openButton = item.querySelector('.knowledge-relations__open') as HTMLButtonElement;
    openButton.click();
    expect(onGraph).toHaveBeenCalledWith('ja:dictionary-entry:e1');
    dispose();
  });

  it('shows the honest NotInGraph state when a relation target has no neighborhood, and recovers', async () => {
    getNeighborhoodMock.mockResolvedValueOnce({
      center: { id: 'ja:surface:hash', kind: 'surface', label: '猫' },
      centerDenseId: 0,
      relationCount: 1,
      relations: [
        { id: 'ja:dictionary-entry:e1', kind: 'dictionary-entry', label: '猫', relationType: 'realizes', provenance: 'jmdict' },
      ],
    }).mockResolvedValue(null);
    const onSelectEntity = vi.fn();
    const { host, dispose } = await renderDrawer({ initialTab: 'relations', onSelectEntity });
    (host.querySelector('.knowledge-relations__row') as HTMLButtonElement).click();
    await flushAsync();
    await flushAsync();
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.NotInGraph');
    const back = host.querySelector('.knowledge-drawer__degraded .knowledge-drawer__install') as HTMLButtonElement;
    back.click();
    await flushAsync();
    await flushAsync();
    expect(host.textContent).not.toContain('mlearn.Knowledge.Projection.Identity.NotInGraph');
    dispose();
  });

  it('renders morphology and character sections exactly when the payload carries them', async () => {
    getNeighborhoodMock.mockResolvedValue({
      center: { id: 'ja:surface:hash', kind: 'surface', label: '猫' },
      centerDenseId: 0,
      relationCount: 4,
      relations: [
        { id: 'ja:lexeme:neko', kind: 'lexeme', label: '猫', relationType: 'lemma-of' },
        { id: 'ja:morpheme:neko', kind: 'morpheme', label: 'ね', relationType: 'has-morpheme' },
        { id: 'ja:char:neko', kind: 'character', label: '糸', relationType: 'has-character' },
        { id: 'ja:surface:inu', kind: 'surface', label: '犬', relationType: 'component-of' },
      ],
    });
    lookupWordMock.mockResolvedValue({ surfaceId: 'ja:surface:hash', entries: [], lexemes: [], senses: [], pronunciations: [] });
    const { host, dispose } = await renderDrawer({ initialTab: 'relations' });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Morphology');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Characters');
    // lemma-of is identity → Written forms; each moved relation renders once.
    const rows = host.querySelectorAll('.knowledge-relations__row');
    expect(rows.length).toBe(4);
    dispose();
  });

  it('renders grammar connections from projection grammar-pattern targets and navigates them', async () => {
    const onSelectEntity = vi.fn();
    const projection: KnowledgeProjection = {
      ...inspectorProjection,
      targets: [
        ...inspectorProjection.targets,
        {
          targetRef: { kind: 'grammar-pattern', id: 'ja:grammar:ている' },
          applicableCapabilities: ['grammar-recognition'],
          states: [{
            capability: 'grammar-recognition', classification: 'unmeasured', basis: 'unmeasured',
            evidence: [], evidenceSourceCounts: {},
          }],
        },
      ],
    };
    const { host, dispose } = await renderDrawer({ initialTab: 'relations', projection, onSelectEntity });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Grammar');
    const grammarRow = Array.from(host.querySelectorAll('.knowledge-relations__row')).find((button) => button.textContent?.includes('mlearn.Knowledge.Projection.Relations.GrammarPattern')) as HTMLButtonElement;
    grammarRow.click();
    expect(onSelectEntity).toHaveBeenCalledWith('ja:grammar:ている');
    dispose();
  });

  it('honestly degrades when the graph is not installed and offers the install affordance', async () => {
    graphMeta = { entityCount: 0, relationCount: 0, ready: false, status: 'not-installed' };
    const { host, dispose } = await renderDrawer({ initialTab: 'relations' });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.NotInstalled');
    const install = host.querySelector('.knowledge-drawer__install') as HTMLButtonElement;
    install.click();
    expect(installLanguageDataMock).toHaveBeenCalledWith('ja');
    dispose();
  });

  it('honestly degrades when the graph is ready but the surface is absent from it', async () => {
    lookupWordMock.mockResolvedValue(null);
    const { host, dispose } = await renderDrawer({ initialTab: 'relations' });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.NoGraph');
    dispose();
  });
});

describe('KnowledgeProjectionDrawer history and prediction', () => {
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

  it('renders the journal through the aggregated timeline with claims distinct', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'history' });
    expect(host.querySelector('.knowledge-timeline')).not.toBeNull();
    expect(host.textContent).toContain('mlearn.Knowledge.History.Kind.Claim');
    expect(host.textContent).toContain('mlearn.Knowledge.History.Source.Anki');
    dispose();
  });

  it('shows the honest empty history state when the journal is empty', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'history', events: [] });
    expect(host.textContent).toContain('mlearn.Knowledge.History.Empty');
    dispose();
  });

  it('shows prediction confidence and support paths resolved to words, never ids', async () => {
    const projection: KnowledgeProjection = {
      ...inspectorProjection,
      targets: [{
        targetRef: { kind: 'grammar-pattern', id: 'ja:grammar:pattern' },
        applicableCapabilities: ['grammar-recognition'],
        states: [{
          capability: 'grammar-recognition', classification: 'predicted', basis: 'prediction',
          evidence: [], evidenceSourceCounts: {},
          prediction: { value: 0.62, reasons: ['ja:surface:inu → ja:dictionary-entry:e1 (realizes)'] },
        }],
      }],
    };
    const { host, dispose } = await renderDrawer({ initialTab: 'prediction', projection });
    expect(host.textContent).toContain('62%');
    expect(host.textContent).toContain('mlearn.GraphInspector.PredictionFirewall');
    // Both path ids resolve against the neighborhood (犬, 猫); the raw ids never render.
    expect(host.textContent).toContain('犬 → 猫');
    expect(host.textContent).not.toContain('ja:surface:inu');
    dispose();
  });

  it('maps narrative lines purely from payload fields', () => {
    expect(knowledgeWhyNarrative({ basis: 'claim', classification: 'known', evidence: [], evidenceSourceCounts: {} }).key).toBe('mlearn.Knowledge.Projection.Why.Claim');
    const evidence = knowledgeWhyNarrative({ basis: 'evidence', classification: 'known', evidence: [{ timestamp: 1, source: 'Anki' }], evidenceSourceCounts: { Anki: 3 } });
    expect(evidence.key).toBe('mlearn.Knowledge.Projection.Why.Evidence');
    expect(evidence.params).toEqual({ count: '3' });
    const prediction = knowledgeWhyNarrative({ basis: 'prediction', classification: 'predicted', evidence: [], evidenceSourceCounts: {}, prediction: { value: 0.5, reasons: ['a', 'b'] } });
    expect(prediction.key).toBe('mlearn.Knowledge.Projection.Why.PredictedLinks');
    expect(prediction.params).toEqual({ count: '2' });
    expect(knowledgeWhyNarrative({ basis: 'prediction', classification: 'predicted', evidence: [], evidenceSourceCounts: {} }).key).toBe('mlearn.Knowledge.Projection.Why.Predicted');
    const passive = knowledgeWhyNarrative({ basis: 'unmeasured', classification: 'unmeasured', evidence: [], evidenceSourceCounts: {}, strength: { ease: 2.5, timesSeen: 4, timesHovered: 1 } });
    expect(passive.key).toBe('mlearn.Knowledge.Projection.Why.Passive');
    expect(passive.params).toEqual({ count: '4' });
    expect(knowledgeWhyNarrative({ basis: 'unmeasured', classification: 'unmeasured', evidence: [], evidenceSourceCounts: {} }).key).toBe('mlearn.Knowledge.Projection.Why.Unmeasured');
  });
});
