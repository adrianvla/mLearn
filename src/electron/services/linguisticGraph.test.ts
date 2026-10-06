import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeCompact } from '../../shared/graph/compact';
import { buildKnowledgeProjection } from './knowledgeProjection';
import { advanceLanguagePackageRevision } from './languagePackageRevision';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/profile' }, ipcMain: { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) } }));
vi.mock('./settings', () => ({
  loadSettings: vi.fn(() => ({ easeThresholdLearning: 1.7, easeThresholdKnown: 2.2 })),
  loadLangData: vi.fn(() => ({ ja: { learning: { capabilities: {} } } })),
}));
vi.mock('./languageDataService', () => ({ getLanguageDataRoot: () => '/unused' }));

vi.mock('./knowledgeProjection', async importOriginal => ({
  ...await importOriginal<typeof import('./knowledgeProjection')>(),
  buildKnowledgeProjection: vi.fn(() => ({ status: 'ready', targets: [] })),
}));
vi.mock('./flashcardStorage', () => ({ loadFlashcards: vi.fn(async () => ({ rev: 0, meta: {
  learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 365,
} })) }));
vi.mock('./knowledgeEvents', () => ({
  getKnowledgeSequence: vi.fn(() => 0),
  ratingLedgerId: vi.fn(() => '/test-ledger'),
  getKnowledgeRows: vi.fn((keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, []]))),
  getAddressedKnowledgeKeys: vi.fn(() => []),
  getAddressedKnowledgeIds: vi.fn(() => []),
  getKnowledgeStates: vi.fn(() => ({})),
  getKnowledgeArchives: vi.fn((keys: readonly string[]) => keys.map((key) => ({ key }))),
}));

function compact(language: string, surface: string, sense = 'meaning') {
  const hash = crypto.createHash('sha256').update(surface).digest('hex');
  const ids = [`${language}:surface:${hash}`, `${language}:dictionary-entry:entry`, `${language}:sense:sense`, `${language}:pronunciation:pronunciation`];
  return {
    schemaVersion: 1,
    language,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sourceVersions: {},
    stringTable: [...ids, surface, sense, 'reading'],
    entities: { kindIds: [2, 0, 3, 4], domainIds: [0, 1, 0, 0], labelStringIds: [4, -1, 5, 6] },
    relations: { offsets: [0, 2, 3, 3, 3], targets: [1, 3, 2], typeIds: [2, 4, 3], confidence: [0.9, 0.8, 0.7], provenanceStringIds: [6, 6, 6] },
    meta: { surfaceHashStringIds: [], surfaceLocalIds: [] },
  };
}

describe('LinguisticGraphService', () => {
  let directory: string;

  beforeEach(() => {
    handlers.clear();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-graph-'));
    fs.mkdirSync(path.join(directory, 'languages'));
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('loads a compact graph once and returns a compact word payload', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫')));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);

    await expect(service.getMeta('ja')).resolves.toMatchObject({ ready: true, status: 'ready', entityCount: 4, relationCount: 3 });
    await expect(service.lookupWord('ja', { surface: '猫' })).resolves.toMatchObject({
      entries: [{ id: 'ja:dictionary-entry:entry' }],
      senses: [{ label: 'meaning' }],
      pronunciations: [{ label: 'reading' }],
    });
    await expect(service.getTargetsForSurfaces('ja', [{ surface: '猫' }, { surface: 'missing' }])).resolves.toHaveLength(2);
  });

  it('replaces cached graph and package authorization together after installed assets change', async () => {
    const file = path.join(directory, 'languages', 'ja.graph.json');
    fs.writeFileSync(file, JSON.stringify(compact('ja', '猫', 'old meaning')));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const settings = await import('./settings');
    const service = new LinguisticGraphService(directory);
    await service.getKnowledgeProjection('ja', '猫');
    const reads = vi.mocked(settings.loadLangData).mock.calls.length;
    fs.writeFileSync(file, JSON.stringify(compact('ja', '猫', 'new meaning')));
    advanceLanguagePackageRevision(directory, 'ja');
    await service.getKnowledgeProjection('ja', '猫');
    expect(vi.mocked(settings.loadLangData).mock.calls.length).toBe(reads + 1);
    expect((await service.lookupWord('ja', { surface: '猫' }))?.senses[0].label).toBe('new meaning');
  });

  it('cannot publish a retired graph load after a package revision changes during the read', async () => {
    const file = path.join(directory, 'languages', 'ja.graph.json');
    const old = JSON.stringify(compact('ja', '猫', 'retired meaning'));
    fs.writeFileSync(file, JSON.stringify(compact('ja', '猫', 'current meaning')));
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const reads = vi.spyOn(fs.promises, 'readFile').mockImplementationOnce(async () => { await waiting; return old; });
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);
    const pending = service.getMeta('ja');
    advanceLanguagePackageRevision(directory, 'ja');
    release();
    await expect(pending).resolves.toMatchObject({ ready: true });
    expect((await service.lookupWord('ja', { surface: '猫' }))?.senses[0].label).toBe('current meaning');
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('preserves unknown structured package features across lookup and neighborhood IPC payloads', async () => {
    const surface = `future:surface:${crypto.createHash('sha256').update('opaque').digest('hex')}`;
    const features = { 'future::unheard-of': { values: ['new', { participant: 7 }], conditional: true } };
    fs.writeFileSync(path.join(directory, 'languages', 'future.graph.json'), JSON.stringify(encodeCompact({
      schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: [{ id: surface, kind: 'surface', label: 'opaque' },
        { id: 'future:entry:opaque', kind: 'dictionary-entry' },
        { id: 'future:sense:opaque', kind: 'sense', features }],
      relations: [{ from: surface, to: 'future:entry:opaque', type: 'realizes' },
        { from: 'future:entry:opaque', to: 'future:sense:opaque', type: 'has-sense' }],
    })));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);
    const payload = await service.lookupWord('future', { surface: 'opaque' });
    expect(JSON.parse(JSON.stringify(payload))?.senses[0].features).toEqual(features);
    const neighborhood = await service.getNeighborhood('future', { entityId: 'future:sense:opaque' });
    expect(neighborhood?.center.features).toEqual(features);
    if (payload?.senses[0].features) payload.senses[0].features['future::unheard-of'] = 'client edit';
    expect((await service.lookupWord('future', { surface: 'opaque' }))?.senses[0].features).toEqual(features);
  });

  it('keeps candidate surfaces whose authoritative sibling carries journal evidence', async () => {
    const surfaceId = (word: string) => `xx:surface:${crypto.createHash('sha256').update(word).digest('hex')}`;
    const key = (word: string) => `xx:${crypto.createHash('sha256').update(word).digest('hex')}`;
    fs.writeFileSync(path.join(directory, 'languages', 'xx.graph.json'), JSON.stringify(encodeCompact({
      schemaVersion: 1, language: 'xx', generatedAt: '2026-01-01', sourceVersions: {},
      entities: [
        { id: surfaceId('form A'), kind: 'surface', label: 'form A' },
        { id: surfaceId('form B'), kind: 'surface', label: 'form B' },
        { id: 'xx:entry:shared', kind: 'dictionary-entry' },
      ],
      relations: [
        { from: surfaceId('form A'), to: 'xx:entry:shared', type: 'realizes' },
        { from: surfaceId('form B'), to: 'xx:entry:shared', type: 'realizes' },
      ],
    })));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);

    await expect(service.getEvidenceLinkedSurfaces('xx', ['form A', 'form B', 'unseen'], [key('form A')]))
      .resolves.toEqual(['form A', 'form B']);
    await expect(service.getEvidenceLinkedSurfaces('xx', ['form A', 'form B', 'unseen'], [key('unseen')]))
      .resolves.toEqual(['unseen']);
  });

  it('loads exact entity observations and a support source without turning source evidence into target knowledge', async () => {
    const hash = (word: string) => crypto.createHash('sha256').update(word).digest('hex');
    const id = (word: string) => `xx:surface:${hash(word)}`;
    const sense = 'xx:sense:target';
    fs.writeFileSync(path.join(directory, 'languages', 'xx.graph.json'), JSON.stringify(encodeCompact({
      schemaVersion: 1, language: 'xx', generatedAt: '', sourceVersions: {},
      entities: [{ id: id('target'), kind: 'surface' }, { id: id('source'), kind: 'surface' },
        { id: 'xx:entry:target', kind: 'dictionary-entry' }, { id: sense, kind: 'sense' }],
      relations: [{ from: id('target'), to: 'xx:entry:target', type: 'realizes' },
        { from: 'xx:entry:target', to: sense, type: 'has-sense' },
        { from: id('source'), to: sense, type: 'semantically-related', transparency: 1 }],
    })));
    const settings = await import('./settings');
    vi.mocked(settings.loadLangData).mockReturnValueOnce({ xx: { name: 'Test package', learning: { capabilities: {
      'sense-recognition': { supportRules: [{ relation: 'semantically-related', sourceCapability: 'sense-recognition', weight: 0.6 }] },
    } } } });
    const journal = await import('./knowledgeEvents');
    vi.mocked(journal.getKnowledgeRows).mockImplementationOnce(keys => Object.fromEntries(keys.map(key => [key,
      key === `xx:${hash('source')}` ? [{ seq: 1, event: { t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: 3 } }] : [],
    ])));
    const real = await vi.importActual<typeof import('./knowledgeProjection')>('./knowledgeProjection');
    vi.mocked(buildKnowledgeProjection).mockImplementationOnce(real.buildKnowledgeProjection);
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const result = await new LinguisticGraphService(directory).getKnowledgeProjection('xx', 'target');
    expect(journal.getKnowledgeRows).toHaveBeenLastCalledWith(expect.arrayContaining([sense, `xx:${hash('source')}`]));
    expect(result.targets.find(target => target.targetRef.id === sense)?.states[0]).toMatchObject({ basis: 'prediction', evidence: [] });
    expect(result.lexical?.overall.basis).toBe('unmeasured');
  });

  it('loads exact journals through an outgoing package path for an unfamiliar source access', async () => {
    const id = `future:surface:${crypto.createHash('sha256').update('target').digest('hex')}`;
    const source = 'future:context:source';
    fs.writeFileSync(path.join(directory, 'languages', 'future.graph.json'), JSON.stringify(encodeCompact({
      schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: { provider: 'v4' },
      entities: [{ id, kind: 'surface', learnableCapabilities: ['future::next'] },
        { id: source, kind: 'future::context', features: { 'future::unknown': { participants: [4, 7] } } }],
      relations: [{ from: id, to: source, type: 'future::context-link', confidence: 0.5 }],
    })));
    const settings = await import('./settings');
    vi.mocked(settings.loadLangData).mockReturnValueOnce({ future: { name: 'Future', learning: { capabilities: {
      'future::next': { supportRules: [{ id: 'future::context-rule', relation: 'future::context-link', direction: 'out',
        sourceCapability: 'future::prior', weight: 0.4 }] },
    } } } });
    const journal = await import('./knowledgeEvents');
    vi.mocked(journal.getKnowledgeRows).mockImplementationOnce(keys => Object.fromEntries(keys.map(key => [key,
      key === source ? [{ seq: 1, event: { t: 1, kind: 'rating', source: 'manual', quality: 'fluent', easeAfter: 3,
        attemptId: 'real-current-witness', targetRef: { kind: 'future::context', id: source, capability: 'future::prior' } } }] : [],
    ])));
    const real = await vi.importActual<typeof import('./knowledgeProjection')>('./knowledgeProjection');
    vi.mocked(buildKnowledgeProjection).mockImplementationOnce(real.buildKnowledgeProjection);
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const result = await new LinguisticGraphService(directory).getKnowledgeProjection('future', 'target');
    expect(journal.getKnowledgeRows).toHaveBeenLastCalledWith(expect.arrayContaining([source]));
    const state = result.targets.find(target => target.targetRef.id === id)?.states.find(state => state.capability === 'future::next');
    expect(state).toMatchObject({ basis: 'prediction', evidence: [], prediction: { model: 'package-support-v2', interpretation: 'heuristic-support',
      contributors: [expect.objectContaining({ source: { entityId: source, capability: 'future::prior' },
        observationIds: ['real-current-witness'], package: { language: 'future', sourceVersions: { provider: 'v4' } } })] } });
  });

  it.each(['raw', 'archived'])('shares %s legacy sibling meaning without inventing direct written recognition', async (mode) => {
    const hash = (w: string) => crypto.createHash('sha256').update(w).digest('hex');
    const id = (w: string) => `xx:surface:${hash(w)}`;
    fs.writeFileSync(path.join(directory, 'languages', 'xx.graph.json'), JSON.stringify(encodeCompact({
      schemaVersion: 1, language: 'xx', generatedAt: '', sourceVersions: {},
      entities: [{ id: id('a'), kind: 'surface' }, { id: id('b'), kind: 'surface' }, { id: 'xx:entry:shared', kind: 'dictionary-entry' }],
      relations: [{ from: id('a'), to: 'xx:entry:shared', type: 'realizes' }, { from: id('b'), to: 'xx:entry:shared', type: 'realizes' }],
    })));
    const journal = await import('./knowledgeEvents');
    const rows = [{ seq: 1, event: { t: 1, kind: 'rating' as const, source: 'manual' as const, aspect: 'meaning' as const, easeAfter: 3 } }];
    const { compactKeyEvents } = await import('../../shared/knowledge/historyArchive');
    const day = 86_400_000;
    const archived = compactKeyEvents([
      { seq: 1, event: { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 3 } },
      { seq: 2, event: { t: 30 * day, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 3 } },
    ], 365 * day).archive;
    expect(archived).toBeDefined();
    vi.mocked(journal.getKnowledgeRows).mockImplementationOnce(() => ({ [`xx:${hash('a')}`]: mode === 'raw' ? rows : [] }));
    vi.mocked(journal.getKnowledgeArchives).mockReturnValueOnce(mode === 'archived' ? [{ key: `xx:${hash('a')}`, archive: archived }] as never : []);
    const real = await vi.importActual<typeof import('./knowledgeProjection')>('./knowledgeProjection');
    vi.mocked(buildKnowledgeProjection).mockImplementationOnce(real.buildKnowledgeProjection);
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const result = await new LinguisticGraphService(directory).getKnowledgeProjection('xx', 'b');
    expect(result.lexical?.sense).toEqual({ classification: 'known', basis: 'evidence' });
    expect(result.lexical?.surfaceRecognition).toEqual({ classification: 'unmeasured', basis: 'unmeasured' });
    expect(rows[0].event).not.toHaveProperty('targetRef');
    // Own-key historical semantics are retained; only sibling transfer changes.
    vi.mocked(journal.getKnowledgeRows).mockImplementationOnce(() => ({ [`xx:${hash('a')}`]: mode === 'raw' ? rows : [] }));
    vi.mocked(journal.getKnowledgeArchives).mockReturnValueOnce(mode === 'archived' ? [{ key: `xx:${hash('a')}`, archive: archived }] as never : []);
    vi.mocked(buildKnowledgeProjection).mockImplementationOnce(real.buildKnowledgeProjection);
    const own = await new LinguisticGraphService(directory).getKnowledgeProjection('xx', 'a');
    expect(own.lexical?.surfaceRecognition).toEqual({ classification: 'known', basis: 'evidence' });

  });

  it('evicts the active language and reloads it after a language switch', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫', 'old')));
    fs.writeFileSync(path.join(directory, 'languages', 'ru.graph.json'), JSON.stringify(compact('ru', 'кот')));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);

    await service.getMeta('ja');
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫', 'new')));
    await service.getMeta('ru');
    await expect(service.lookupWord('ja', { surface: '猫' })).resolves.toMatchObject({ senses: [{ label: 'new' }] });
  });

  it('returns a bounded, relation-class-filtered neighborhood with compact metadata', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫')));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);
    const id = `ja:surface:${crypto.createHash('sha256').update('猫').digest('hex')}`;

    const result = await service.getNeighborhood('ja', { entityId: id, relationClasses: ['property'], limit: 1 });
    expect(result).toMatchObject({ centerDenseId: 0, relationCount: 3, relations: [{ relationType: 'realizes', provenance: 'reading', domain: 'common' }] });
    expect(result?.relations[0]?.confidence).toBeCloseTo(0.9);
    await expect(service.getNeighborhood('ja', { entityId: id, depth: 2 })).resolves.toBeNull();
  });

  it('includes lexical properties of a surface without traversing related surfaces', async () => {
    const id = `xx:surface:${crypto.createHash('sha256').update('word').digest('hex')}`;
    fs.writeFileSync(path.join(directory, 'languages', 'xx.graph.json'), JSON.stringify(encodeCompact({
      schemaVersion: 1, language: 'xx', generatedAt: '2026-01-01', sourceVersions: {},
      entities: [
        { id, kind: 'surface', label: 'word' },
        { id: 'entry', kind: 'dictionary-entry' },
        { id: 'property', kind: 'grammar-pattern', label: 'arbitrary class' },
        { id: 'sibling', kind: 'surface' },
        { id: 'other-property', kind: 'grammar-pattern', label: 'unrelated class' },
      ],
      relations: [
        { from: id, to: 'entry', type: 'realizes' },
        { from: 'entry', to: 'property', type: 'has-pos' },
        { from: id, to: 'sibling', type: 'semantically-related' },
        { from: 'sibling', to: 'other-property', type: 'has-pos' },
      ],
    })));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);
    const result = await service.getNeighborhood('xx', { entityId: id });
    expect(result?.relations).toContainEqual(expect.objectContaining({ id: 'property', relationType: 'has-pos', label: 'arbitrary class', via: expect.objectContaining({ id: 'entry' }) }));
    expect(result?.relations.some((node) => node.id === 'other-property')).toBe(false);
    const limited = await service.getNeighborhood('xx', { entityId: id, limit: 1 });
    expect(limited?.relations).toHaveLength(1);
    const support = await service.getNeighborhood('xx', { entityId: id, relationClasses: ['support'] });
    expect(support?.relations.some((node) => node.id === 'property')).toBe(false);
  });

  it('pages every distinct qualified edge and exposes unknown package types and descriptive labels', async () => {
    const entities = [{ id: 'center', kind: 'x-future::utterance', label: 'Utterance' },
      { id: 'class', kind: 'grammar-pattern', label: 'q7', grammar: { meaning: 'Package-authored description', level: 0 } }];
    const relations = Array.from({ length: 213 }, (_, order) => ({ from: 'center', to: 'class', type: 'x-future::contextual-role', order, role: 'x-future::participant' }));
    fs.writeFileSync(path.join(directory, 'languages', 'xx.graph.json'), JSON.stringify(encodeCompact({
      schemaVersion: 1, language: 'xx', generatedAt: '2026-01-01', sourceVersions: {}, entities, relations,
    })));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);
    const first = await service.getNeighborhood('xx', { entityId: 'center', limit: 200 });
    const last = await service.getNeighborhood('xx', { entityId: 'center', offset: 200 });
    expect(first?.relationCount).toBe(213); expect(first?.relations).toHaveLength(200);
    expect(last?.relations).toHaveLength(13);
    expect(last?.relations[12]).toMatchObject({ id: 'class', order: 212, role: 'x-future::participant', label: 'q7', displayLabel: 'Package-authored description', relationType: 'x-future::contextual-role' });
    expect(new Set([...first!.relations, ...last!.relations].map((row) => row.order)).size).toBe(213);
    expect((await service.getNeighborhood('xx', { entityId: 'center', relationClasses: ['support'] }))?.relations).toEqual([]);
  });

  it.skipIf(!process.env.MLEARN_GRAPH_ASSETS_DIR)('exercises installed sparse and dense neighborhoods without modifying their assets', async () => {
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(path.dirname(process.env.MLEARN_GRAPH_ASSETS_DIR!));
    const results: Record<string, import('../../shared/graph/ipc').GraphNeighborhood> = {};
    for (const [language, words] of [['ja', ['殖える', '会う', '橋', '食べる']], ['de', ['Haus', 'gehen']]] as const) {
      for (const word of words) {
        const id = `${language}:surface:${crypto.createHash('sha256').update(word).digest('hex')}`;
        const result = await service.getNeighborhood(language, { entityId: id });
        expect(result, word).not.toBeNull();
        results[word] = result!;
        const complete = [...result!.relations];
        let received = result!.relations.length;
        while (received < result!.relationCount) {
          const next = await service.getNeighborhood(language, { entityId: id, offset: received });
          expect(next!.relations.length).toBeGreaterThan(0);
          received += next!.relations.length;
          complete.push(...next!.relations);
        }
        expect(received).toBe(result!.relationCount);
        results[`${word}:complete`] = { ...result!, relations: complete };
        for (const neighbor of result!.relations.slice(0, 3)) {
          const around = await service.getNeighborhood(language, { entityId: neighbor.id });
          if (around) results[neighbor.id] = around;
        }
        expect(result!.relations.length).toBeLessThanOrEqual(80);
        for (const relation of result!.relations) expect(relation.id).toBeTruthy();
      }
    }
    // A shared pronunciation has many distinct lexical neighbors in the installed package.
    const lookup = await service.lookupWord('ja', { surface: '橋' });
    const sound = lookup!.pronunciations[0];
    expect(sound).toBeDefined();
    const dense = await service.getNeighborhood('ja', { entityId: sound.id });
    expect(dense!.relationCount).toBeGreaterThan(8);
    results.dense = dense!;
    const more = await service.getNeighborhood('ja', { entityId: sound.id, offset: dense!.relations.length });
    expect(more!.center.id).toBe(sound.id);
    if (process.env.MLEARN_GRAPH_PREVIEW_OUTPUT) fs.writeFileSync(process.env.MLEARN_GRAPH_PREVIEW_OUTPUT, JSON.stringify(results));
  });

  it('rides center-surface capability states on the neighborhood payload and omits them otherwise', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫')));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const buildProjection = vi.mocked(buildKnowledgeProjection);
    const service = new LinguisticGraphService(directory);
    const id = `ja:surface:${crypto.createHash('sha256').update('猫').digest('hex')}`;

    buildProjection.mockReturnValueOnce({
      status: 'ready',
      surfaceId: id,
      targets: [
        { targetRef: { kind: 'surface', id }, applicableCapabilities: ['surface-recognition'], states: [{ capability: 'surface-recognition', classification: 'known', basis: 'evidence', evidence: [], evidenceSourceCounts: {} }] },
        { targetRef: { kind: 'sense', id: 'ja:sense:sense' }, applicableCapabilities: ['sense-recognition'], states: [{ capability: 'sense-recognition', classification: 'unmeasured', basis: 'unmeasured', evidence: [], evidenceSourceCounts: {} }] },
      ],
    });
    const result = await service.getNeighborhood('ja', { entityId: id });
    expect(result?.centerStates).toEqual([{ capability: 'surface-recognition', classification: 'known', basis: 'evidence' }]);

    // Non-surface centers stay unprojected.
    const empty = await service.getNeighborhood('ja', { entityId: 'ja:dictionary-entry:entry' });
    expect(empty?.centerStates).toBeUndefined();
  });

  it('reports a missing graph explicitly and registers only bulk-safe graph IPC handlers', async () => {
    const { LinguisticGraphService, setupLinguisticGraphIPC } = await import('./linguisticGraph');
    await expect(new LinguisticGraphService(directory).getMeta('ja')).resolves.toEqual({ entityCount: 0, relationCount: 0, ready: false, status: 'not-installed' });
    await expect(new LinguisticGraphService(directory).getKnowledgeProjection('ja', '猫')).resolves.toMatchObject({ status: 'ready', graphStatus: 'not-installed', surfaceKnown: false, targets: [] });
    setupLinguisticGraphIPC();
    expect([...handlers.keys()]).toEqual(expect.arrayContaining([
      'graph-get-meta', 'graph-lookup-word', 'graph-get-related', 'graph-get-targets-for-surfaces', 'graph-get-neighborhood', 'knowledge-get-projection', 'knowledge-get-projection-collection',
    ]));
  });

  it('coalesces identical projection collections across callers and reuses the settled snapshot', async () => {
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory, '/profile-a');
    const build = vi.mocked(buildKnowledgeProjection);
    build.mockClear();
    const request = () => service.getKnowledgeProjectionCollection('future', ['novel'], undefined, { learning: 1.7, known: 2.2 });

    const [first, joined] = await Promise.all([request(), request()]);
    expect(first).toEqual(joined);
    expect(first.revision).toEqual({ packageRevision: 0, journalSequence: 0, libraryRevision: 0 });
    expect(Object.keys(first.projections)).toEqual(['novel']);
    expect(build).toHaveBeenCalledTimes(1);

    const cached = await request();
    expect(cached).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('discards a mixed-revision collection and retries once against the latest journal', async () => {
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const journal = await import('./knowledgeEvents');
    let sequence = 0;
    vi.mocked(journal.getKnowledgeSequence).mockImplementation(() => sequence);
    const build = vi.mocked(buildKnowledgeProjection);
    build.mockImplementation(() => {
      sequence = 1;
      return { status: 'ready', targets: [] };
    });
    try {
      const result = await new LinguisticGraphService(directory, '/profile-a')
        .getKnowledgeProjectionCollection('future', ['novel'], undefined, { learning: 1.7, known: 2.2 });
      expect(result.revision?.journalSequence).toBe(1);
      expect(build).toHaveBeenCalledTimes(2);
    } finally {
      vi.mocked(journal.getKnowledgeSequence).mockImplementation(() => 0);
      build.mockImplementation(() => ({ status: 'ready', targets: [] }));
    }
  });

  it('limits admitted projection workers across simultaneous clients to four', async () => {
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory, '/profile-workers');
    const internal = service as unknown as { projectionFor: (...args: unknown[]) => Promise<unknown> };
    let active = 0;
    let maximum = 0;
    let started = 0;
    let announce!: () => void;
    const fourWorkersStarted = new Promise<void>(resolve => { announce = resolve; });
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(internal, 'projectionFor').mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      started += 1;
      if (started === 4) announce();
      try { await hold; }
      finally { active -= 1; }
      return { status: 'ready', targets: [] };
    });

    const first = service.getKnowledgeProjectionCollection('future', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    await fourWorkersStarted;
    const second = service.getKnowledgeProjectionCollection('future', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
    await new Promise<void>(resolve => setImmediate(resolve));
    release();
    await Promise.all([first, second]);
    expect(maximum).toBe(4);
    expect(started).toBe(12);
  });

  it('bounds settled collection cache size and expires entries on access', async () => {
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const build = vi.mocked(buildKnowledgeProjection);
    build.mockClear();
    build.mockImplementation(() => ({ status: 'ready', targets: [] }));
    const service = new LinguisticGraphService(directory, '/profile-cache');
    for (const surface of ['a', 'b', 'c', 'd', 'e']) {
      await service.getKnowledgeProjectionCollection('future', [surface]);
    }
    expect(build).toHaveBeenCalledTimes(5);
    await service.getKnowledgeProjectionCollection('future', ['a']);
    expect(build).toHaveBeenCalledTimes(6);

    let now = 1_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const timed = new LinguisticGraphService(directory, '/profile-ttl');
      await timed.getKnowledgeProjectionCollection('future', ['ttl']);
      await timed.getKnowledgeProjectionCollection('future', ['ttl']);
      expect(build).toHaveBeenCalledTimes(7);
      now += 15_001;
      await timed.getKnowledgeProjectionCollection('future', ['ttl']);
      expect(build).toHaveBeenCalledTimes(8);
    } finally {
      clock.mockRestore();
    }
  });

  it('projects canonical journal knowledge without an optional graph and bounds evidence-linked surfaces', async () => {
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const journal = await import('./knowledgeEvents');
    const original = await vi.importActual<typeof import('./knowledgeProjection')>('./knowledgeProjection');
    const hash = crypto.createHash('sha256').update('authored').digest('hex');
    const id = `future:surface:${hash}`;
    vi.mocked(journal.getKnowledgeRows).mockImplementationOnce(keys => Object.fromEntries(keys.map(key => [key, [{ seq: 1,
      event: { t: 1, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id, capability: 'future::unknown-access' }, toStatus: 'known' },
    }]])));
    vi.mocked(buildKnowledgeProjection).mockImplementationOnce(original.buildKnowledgeProjection);
    const service = new LinguisticGraphService(directory);
    const result = await service.getKnowledgeProjection('future', 'authored');
    expect(result).toMatchObject({ status: 'ready', graphStatus: 'not-installed', surfaceKnown: false, surfaceId: id,
      targets: [{ targetRef: { kind: 'surface', id }, states: [{ capability: 'future::unknown-access', classification: 'known', basis: 'claim' }] }] });
    expect(result.targets.flatMap(target => target.states).every(state => state.prediction === undefined)).toBe(true);
    expect(await service.getEvidenceLinkedSurfaces('future', ['authored', 'unseen'], [`future:${hash}`])).toEqual(['authored']);
  });

  it('recovers exact alias addresses from canonical family containers without borrowing unrelated legacy rows', async () => {
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const journal = await import('./knowledgeEvents');
    const original = await vi.importActual<typeof import('./knowledgeProjection')>('./knowledgeProjection');
    const hash = crypto.createHash('sha256').update('alias').digest('hex');
    const id = `future:surface:${hash}`;
    const family = `future:${'a'.repeat(64)}`;
    vi.mocked(journal.getAddressedKnowledgeKeys).mockReturnValueOnce([family]);
    vi.mocked(journal.getKnowledgeRows).mockImplementationOnce(keys => Object.fromEntries(keys.map(key => [key, key !== family ? [] : [
      { seq: 1, event: { t: 1, kind: 'claim', source: 'manual', aspect: 'reading', toStatus: 'known' } },
      { seq: 2, event: { t: 2, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id, capability: 'sense-recognition' }, toStatus: 'known' } },
    ]])));
    vi.mocked(buildKnowledgeProjection).mockImplementationOnce(original.buildKnowledgeProjection);
    const service = new LinguisticGraphService(directory);
    const result = await service.getKnowledgeProjection('future', 'alias');
    expect(result.targets[0].states).toMatchObject([{ capability: 'sense-recognition', classification: 'known', basis: 'claim' }]);
    expect(result.targets[0].states.some(state => state.capability === 'surface-reading')).toBe(false);
    vi.mocked(journal.getAddressedKnowledgeIds).mockReturnValueOnce([id]);
    expect(await service.getEvidenceLinkedSurfaces('future', ['alias', 'unseen'], [family])).toEqual(['alias']);
  });

  it('uses persisted thresholds by default and the requesting renderer thresholds when supplied', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫')));
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);
    const buildProjection = vi.mocked(buildKnowledgeProjection);
    await service.getKnowledgeProjection('ja', '猫');
    expect(buildProjection.mock.calls.at(-1)?.[6]?.thresholds).toEqual({ learning: 1.7, known: 2.2 });
    const thresholds = { learning: 2.1, known: 2.7 };
    await service.getKnowledgeProjection('ja', '猫', thresholds);
    expect(buildProjection.mock.calls.at(-1)?.[6]?.thresholds).toEqual(thresholds);
    const entityId = `ja:surface:${crypto.createHash('sha256').update('猫').digest('hex')}`;
    await service.getNeighborhood('ja', { entityId, thresholds });
    expect(buildProjection.mock.calls.at(-1)?.[6]?.thresholds).toEqual(thresholds);
  });

  it('loads installed language metadata once per active graph rather than once per projection', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫')));
    const settings = await import('./settings');
    const { LinguisticGraphService } = await import('./linguisticGraph');
    const service = new LinguisticGraphService(directory);

    await service.getKnowledgeProjection('ja', '猫');
    await service.getKnowledgeProjection('ja', '猫');

    expect(settings.loadLangData).toHaveBeenCalledTimes(1);
  });

  it('serves repeated projections from the settled collection and rebuilds it after a package revision', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫', 'old')));
    fs.writeFileSync(path.join(directory, 'languages', 'ru.graph.json'), JSON.stringify(compact('ru', 'кот')));
    const { LinguisticGraphService } = await import('./linguisticGraph'); // dynamic: file convention, module loads after vi.mock registration
    const buildProjection = vi.mocked(buildKnowledgeProjection);
    const service = new LinguisticGraphService(directory);
    const projectionCallsBefore = buildProjection.mock.calls.length;

    await service.getKnowledgeProjection('ja', '猫');
    await service.getKnowledgeProjection('ja', '猫');
    const projectionCalls = buildProjection.mock.calls.slice(projectionCallsBefore);
    expect(projectionCalls).toHaveLength(1);

    // Switching languages evicts the view; returning rebuilds it from the reloaded asset.
    await service.getMeta('ru');
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫', 'rewritten')));
    advanceLanguagePackageRevision(directory, 'ja');
    await service.getKnowledgeProjection('ja', '猫');
    expect(buildProjection.mock.calls.length).toBe(projectionCallsBefore + 2);
    const finalGraph = buildProjection.mock.calls.at(-1)?.[0];
    expect(finalGraph).not.toBe(projectionCalls[0][0]);
    // Reload freshness: the stable sense id's label comes from the REWRITTEN
    // file — a stale view over the old fixture would still say 'old'.
    expect(finalGraph?.nodes.get('ja:sense:sense')?.label).toBe('rewritten');
  });
});
