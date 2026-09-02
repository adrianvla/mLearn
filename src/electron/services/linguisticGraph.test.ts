import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as loadModule from '../../shared/graph/load';
import type { LinguisticGraphAsset } from '../../shared/graph/types';
import { buildKnowledgeProjection } from './knowledgeProjection';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((channel, handler) => handlers.set(channel, handler)) } }));
vi.mock('./languageDataService', () => ({ getLanguageDataRoot: () => '/unused' }));

const loadState = vi.hoisted(() => ({ plainReplicaAssets: [] as unknown[] }));
vi.mock('../../shared/graph/load', async (importOriginal) => {
  const actual = await importOriginal<typeof loadModule>();
  return {
    ...actual,
    loadLinguisticGraph: (asset: LingualGraphAsset) => {
      loadState.plainReplicaAssets.push(asset);
      return actual.loadLinguisticGraph(asset);
    },
  };
});
vi.mock('./knowledgeProjection', () => ({ buildKnowledgeProjection: vi.fn(() => ({ status: 'ready', targets: [] })) }));
vi.mock('./flashcardStorage', () => ({ loadFlashcards: vi.fn(async () => ({ meta: {} })) }));
vi.mock('./knowledgeEvents', () => ({ getKnowledgeEvents: vi.fn(() => ({})) }));

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
    expect(result).toMatchObject({ centerDenseId: 0, relationCount: 1, relations: [{ relationType: 'realizes', provenance: 'reading', domain: 'common' }] });
    expect(result?.relations[0]?.confidence).toBeCloseTo(0.9);
    await expect(service.getNeighborhood('ja', { entityId: id, depth: 2 })).resolves.toBeNull();
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
    await expect(new LinguisticGraphService(directory).getKnowledgeProjection('ja', '猫')).resolves.toEqual({ status: 'not-installed', targets: [] });
    setupLinguisticGraphIPC();
    expect([...handlers.keys()]).toEqual(expect.arrayContaining([
      'graph-get-meta', 'graph-lookup-word', 'graph-get-related', 'graph-get-targets-for-surfaces', 'graph-get-neighborhood', 'knowledge-get-projection',
    ]));
  });

  it('serves repeated projections from one cached plain graph and rebuilds it after a reload', async () => {
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫', 'old')));
    fs.writeFileSync(path.join(directory, 'languages', 'ru.graph.json'), JSON.stringify(compact('ru', 'кот')));
    const { LinguisticGraphService } = await import('./linguisticGraph'); // dynamic: file convention, module loads after vi.mock registration
    const buildProjection = vi.mocked(buildKnowledgeProjection);
    const service = new LinguisticGraphService(directory);
    const replicaAssetsBefore = loadState.plainReplicaAssets.length;
    const projectionCallsBefore = buildProjection.mock.calls.length;

    await service.getKnowledgeProjection('ja', '猫');
    await service.getKnowledgeProjection('ja', '猫');
    const projectionCalls = buildProjection.mock.calls.slice(projectionCallsBefore);
    expect(projectionCalls).toHaveLength(2);
    // Both projections share the same cached plain-graph replica instance; exactly one rebuild happened.
    expect(projectionCalls[0][0]).toBe(projectionCalls[1][0]);
    expect(loadState.plainReplicaAssets.length).toBe(replicaAssetsBefore + 1);

    // Switching languages evicts the replica; returning rebuilds it from the reloaded asset.
    await service.getMeta('ru');
    fs.writeFileSync(path.join(directory, 'languages', 'ja.graph.json'), JSON.stringify(compact('ja', '猫', 'rewritten')));
    await service.getKnowledgeProjection('ja', '猫');
    expect(buildProjection.mock.calls.length).toBe(projectionCallsBefore + 3);
    const rebuiltAsset = loadState.plainReplicaAssets.at(-1) as LinguisticGraphAsset;
    expect(rebuiltAsset.entities.some((entity) => entity.label === 'rewritten')).toBe(true);
    const finalGraph = buildProjection.mock.calls.at(-1)?.[0];
    expect(finalGraph).not.toBe(projectionCalls[0][0]);
  });
});
