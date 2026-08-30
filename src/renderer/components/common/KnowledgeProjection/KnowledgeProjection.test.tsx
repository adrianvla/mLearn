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

async function renderDrawer(overrides: Partial<{
  surface: string;
  events: KnowledgeEvent[];
  initialTab: string;
  projection: KnowledgeProjection;
  model: Parameters<typeof assembleWordKnowledgeModel>[0];
  onSelectEntity: (entityId: string) => void;
  onGraph: (entityId: string) => void;
}> = {}) {
  const { KnowledgeProjectionDrawer } = await import('./KnowledgeProjection');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const model = overrides.model ? assembleWordKnowledgeModel(overrides.model) : undefined;
  const dispose = render(() => (
    <KnowledgeProjectionDrawer
      projection={model ? undefined : (overrides.projection ?? inspectorProjection)}
      model={model}
      open={true}
      onClose={() => undefined}
      onGraph={overrides.onGraph}
      onSelectEntity={overrides.onSelectEntity}
      surface={overrides.surface ?? '猫'}
      events={model ? undefined : (overrides.events ?? journal)}
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

  it('renders predicted, unmeasured, and claim/evidence tones as distinct non-evidence tokens', () => {
    expect(knowledgeTone({ basis: 'prediction', classification: 'predicted' })).toBe('predicted');
    expect(knowledgeTone({ basis: 'unmeasured', classification: 'unmeasured' })).toBe('unmeasured');
    expect(knowledgeTone({ basis: 'claim', classification: 'unknown' })).toBe('claim');
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
    // The full pronunciation list renders first; realizes is property;
    // semantically-related is support with the not-knowledge caption.
    const relations = host.querySelectorAll('.knowledge-drawer__relations li');
    expect(relations.length).toBe(3);
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

describe('Identity tab navigation and completeness (REQ63/REQ29)', () => {
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

  it('makes every relation row recenter the drawer and host graph via onSelectEntity', async () => {
    const onSelectEntity = vi.fn();
    const { host, dispose } = await renderDrawer({ onSelectEntity });
    const relationButton = Array.from(host.querySelectorAll('.knowledge-drawer__relation')).find((button) => button.textContent?.includes('realizes')) as HTMLButtonElement | null;
    expect(relationButton).not.toBeNull();
    relationButton!.click();
    await flushAsync();
    await flushAsync();
    expect(onSelectEntity).toHaveBeenCalledWith('ja:dictionary-entry:e1');
    expect(getNeighborhoodMock).toHaveBeenCalledWith({ entityId: 'ja:dictionary-entry:e1', depth: 1 });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Viewing');
    dispose();
  });

  it('keeps openGraphInspector as the secondary affordance per relation row', async () => {
    const onGraph = vi.fn();
    const { host, dispose } = await renderDrawer({ onGraph });
    const relationLi = Array.from(host.querySelectorAll('.knowledge-drawer__relations li')).find((li) => li.textContent?.includes('realizes')) as HTMLLIElement | null;
    expect(relationLi).not.toBeNull();
    const openButton = relationLi!.querySelector('.knowledge-drawer__relation-open') as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();
    openButton!.click();
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
    const { host, dispose } = await renderDrawer({ onSelectEntity });
    (host.querySelector('.knowledge-drawer__relation') as HTMLButtonElement).click();
    await flushAsync();
    await flushAsync();
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.NotInGraph');
    const back = host.querySelector('.knowledge-drawer__degraded .knowledge-drawer__install') as HTMLButtonElement | null;
    expect(back).not.toBeNull();
    back!.click();
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
    const { host, dispose } = await renderDrawer();
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Morphology');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Characters');
    // Each moved relation renders once — no duplication in the category groups.
    expect(host.querySelectorAll('.knowledge-drawer__relations li')).toHaveLength(4);
    dispose();
  });

  it('omits morphology, character, and grammar sections when the payload lacks them', async () => {
    lookupWordMock.mockResolvedValue({ surfaceId: 'ja:surface:hash', entries: [], lexemes: [], senses: [], pronunciations: [] });
    const { host, dispose } = await renderDrawer();
    expect(host.textContent).not.toContain('mlearn.Knowledge.Projection.Identity.Sections.Morphology');
    expect(host.textContent).not.toContain('mlearn.Knowledge.Projection.Identity.Sections.Characters');
    expect(host.textContent).not.toContain('mlearn.Knowledge.Projection.Identity.Sections.Pronunciations');
    expect(host.textContent).not.toContain('mlearn.Knowledge.Projection.Identity.Sections.Grammar');
    dispose();
  });

  it('renders the full pronunciation list, not just the first reading', async () => {
    lookupWordMock.mockResolvedValue({
      surfaceId: 'ja:surface:hash',
      entries: [{ id: 'ja:dictionary-entry:e1', kind: 'dictionary-entry', label: '猫' }],
      lexemes: [{ id: 'ja:lexeme:neko', kind: 'lexeme', label: '猫' }],
      senses: [{ id: 'ja:sense:s1', kind: 'sense', label: 'cat' }],
      pronunciations: [
        { id: 'ja:pronunciation:neko', kind: 'pronunciation', label: 'ねこ' },
        { id: 'ja:pronunciation:neko-kana', kind: 'pronunciation', label: 'ネコ' },
      ],
    });
    const { host, dispose } = await renderDrawer();
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Pronunciations');
    expect(host.textContent).toContain('ねこ');
    expect(host.textContent).toContain('ネコ');
    expect(host.textContent).not.toContain('mlearn.Knowledge.Projection.Identity.Reading');
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
    const { host, dispose } = await renderDrawer({ projection, onSelectEntity });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Identity.Sections.Grammar');
    expect(host.textContent).toContain('ja:grammar:ている');
    const grammarRow = Array.from(host.querySelectorAll('.knowledge-drawer__relation')).find((button) => button.textContent?.includes('ja:grammar:ている')) as HTMLButtonElement;
    grammarRow.click();
    expect(onSelectEntity).toHaveBeenCalledWith('ja:grammar:ている');
    dispose();
  });

  it('shows the center capability states carried on the neighborhood payload', async () => {
    getNeighborhoodMock.mockResolvedValue({
      center: { id: 'ja:surface:hash', kind: 'surface', label: '猫' },
      centerDenseId: 0,
      relationCount: 1,
      relations: [
        { id: 'ja:dictionary-entry:e1', kind: 'dictionary-entry', label: '猫', relationType: 'realizes' },
      ],
      centerStates: [{ capability: 'surface-recognition', classification: 'known', basis: 'evidence' }],
    });
    const { host, dispose } = await renderDrawer();
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Evidence.Known');
    dispose();
  });
});

describe('WHY narrative, exclusion badge, and aggregate in the drawer (REQ29/REQ4/REQ34)', () => {
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

  it('shows a WHY line per capability traceable to the explanation fields', async () => {
    const { host, dispose } = await renderDrawer({ initialTab: 'targets' });
    // Claim basis → 'Your claim'; unmeasured without familiarity → honest unmeasured.
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Why.Claim');
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Why.Unmeasured');
    dispose();
  });

  it('marks teaching-policy exclusion in the drawer header from the model, orthogonal to status', async () => {
    const { host, dispose } = await renderDrawer({
      model: {
        comprehensive: { status: 'unknown', basis: 'unmeasured', evidenceStatus: 'unknown', source: 'None', timesSeen: 0, excluded: true },
        projection: inspectorProjection,
        events: journal,
      },
    });
    expect(host.textContent).toContain('mlearn.Knowledge.Projection.Excluded');
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