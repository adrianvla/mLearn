import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildKnowledgeProjection } from './knowledgeProjection';
import { COMPACT_RELATION_TYPES, decodeCompact, type CompactAssetJSON, type RuntimeCompactGraph } from '../../shared/graph/compact';
import { loadLinguisticGraph, relationsOf, type LingualGraph } from '../../shared/graph/load';
import { learnableTargetsFor } from '../../shared/graph/targets';
import type { RetentionPolicy } from '../../shared/srs/retentionScheduler';
import type { GraphRelation, LinguisticGraphAsset } from '../../shared/graph/types';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

/**
 * §26 graph-inspector validation on REAL built graph assets (not fixtures).
 *
 * Skips unless MLEARN_GRAPH_ASSETS_DIR points at a directory containing
 * `<language>.graph.json` compact assets (the packager's output). Run after a
 * local build:
 *   MLEARN_GRAPH_ASSETS_DIR=/path/to/catalog/graph npx vitest run graphInspectorValidation
 *
 * For each representative item the test asserts the inspector's honest
 * separations: identity vs support relations, evidence vs prediction vs
 * unmeasured, claim visibility, and no fabricated knowledge from support.
 */

const ASSETS_DIR = process.env.MLEARN_GRAPH_ASSETS_DIR;

const POLICY: RetentionPolicy = {
  learningSteps: [1, 10],
  relearnSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  reviewIntervalModifier: 100,
  maxInterval: 36500,
};

/** Mirrors LinguisticGraphService.toLingualGraph — decode compact → asset graph. */
function decodeToGraph(compact: CompactAssetJSON): LingualGraph {
  const graph: RuntimeCompactGraph = decodeCompact(compact);
  const domains = [undefined, 'common', 'names', 'archaic', 'technical', 'dialectal'] as const;
  const entities = graph.persistentOf.map((id, dense) => {
    const labelId = graph.entityLabelStringIds[dense];
    const domain = domains[graph.entityDomainIds[dense]];
    return {
      id,
      kind: graph.nodeKind(id)!,
      ...(domain ? { domain } : {}),
      ...(labelId >= 0 ? { label: graph.stringTable[labelId] } : {}),
    };
  });
  const relations: GraphRelation[] = [];
  for (let dense = 0; dense < graph.persistentOf.length; dense += 1) {
    for (let edge = graph.relationOffsets[dense]; edge < graph.relationOffsets[dense + 1]; edge += 1) {
      const confidence = graph.relationConfidence?.[edge];
      const transparency = graph.relationTransparency?.[edge];
      const predictability = graph.relationPredictability?.[edge];
      const provenance = graph.relationProvenanceStringIds?.[edge];
      relations.push({
        from: graph.persistentOf[dense],
        to: graph.persistentOf[graph.relationTargets[edge]],
        type: COMPACT_RELATION_TYPES[graph.relationTypeIds[edge]],
        ...(confidence !== undefined && confidence >= 0 ? { confidence } : {}),
        ...(transparency !== undefined && transparency >= 0 ? { transparency } : {}),
        ...(predictability !== undefined && predictability >= 0 ? { predictability } : {}),
        ...(provenance !== undefined && provenance >= 0 ? { provenance: graph.stringTable[provenance] } : {}),
      });
    }
  }
  const asset: LinguisticGraphAsset = {
    schemaVersion: 1,
    language: compact.language,
    generatedAt: '',
    sourceVersions: {},
    entities,
    relations,
  };
  return loadLinguisticGraph(asset);
}

function loadGraph(language: string): LingualGraph | null {
  if (!ASSETS_DIR) return null;
  const file = path.join(ASSETS_DIR, `${language}.graph.json`);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as
    | CompactAssetJSON
    | LinguisticGraphAsset;
  // Builder output is the plain asset; the packager's catalog output is the
  // compact encoding. Both validate the same runtime graph.
  if ('entities' in parsed && Array.isArray(parsed.entities)) {
    return loadLinguisticGraph(parsed as LinguisticGraphAsset);
  }
  return decodeToGraph(parsed as CompactAssetJSON);
}

function surfaceIdFor(graph: LingualGraph, surface: string): string | undefined {
  for (const [id, entity] of graph.nodes) {
    if (entity.kind === 'surface' && (entity.label === surface || id.endsWith(`:${surface}`))) return id;
  }
  return undefined;
}

function relationsOfSurface(graph: LingualGraph, surface: string) {
  const id = surfaceIdFor(graph, surface);
  if (!id) return [];
  return relationsOf(graph, id).map((relation) => ({
    type: relation.type,
    other: relation.from === id ? relation.to : relation.from,
    direction: relation.from === id ? 'out' : 'in',
  }));
}

describe('graph inspector validation (real assets)', () => {
  const ja = loadGraph('ja');
  const de = loadGraph('de');

  it.skipIf(!ja)('食べた: inflected surfaces are honestly absent until enumerated — no fabricated identity', () => {
    // The ja asset enumerates dictionary headwords, not inflected forms.
    // 食べた therefore has NO surface node: the graph degrades honestly
    // (runtime resolves the lemma via word-variant lookup) rather than
    // inventing an identity. When inflected surfaces land, this test flips
    // to assert the inflection-of relation.
    const id = surfaceIdFor(ja!, '食べた');
    if (id) {
      const relations = relationsOfSurface(ja!, '食べた');
      expect(relations.some((relation) => relation.type === 'inflection-of' || relation.type === 'lemma-of')).toBe(true);
    } else {
      expect(id).toBeUndefined();
    }
  });

  it.skipIf(!ja)('増える/殖える: variant spellings may share a dictionary entry; surface identities stay distinct', () => {
    const graph = ja!;
    const okiru = surfaceIdFor(graph, '増える');
    const hayeru = surfaceIdFor(graph, '殖える');
    if (!okiru || !hayeru) return;
    // Two distinct surface nodes (surface-recognition is per-form)…
    expect(okiru).not.toBe(hayeru);
    // …and never a DIRECT identity relation between the two spellings —
    // shared identity, when it exists, flows through the dictionary entry.
    const relations = relationsOfSurface(graph, '増える');
    const directIdentity = relations.some(
      (relation) => (relation.type === 'inflection-of' || relation.type === 'lemma-of') && relation.other === hayeru,
    );
    expect(directIdentity).toBe(false);
  });

  it.skipIf(!ja)('kanji components: no source wired yet — has-character stays honestly absent, never fabricated', () => {
    // 学校 has no has-character edges until a kanji-component source ships.
    // Locking the honest absence: the day components land, flip this to
    // require the relation.
    const relations = relationsOfSurface(ja!, '学校');
    expect(relations.some((relation) => relation.type === 'has-character')).toBe(false);
  });

  it.skipIf(!de)('a gendered German noun carries has-gender on its dictionary entry (via realizes)', () => {
    const graph = de!;
    const surface = surfaceIdFor(graph, 'Haus') ? 'Haus' : surfaceIdFor(graph, 'Handschuh') ? 'Handschuh' : undefined;
    if (!surface) return;
    const surfaceId = surfaceIdFor(graph, surface)!;
    const entryIds = relationsOf(graph, surfaceId)
      .filter((relation) => relation.type === 'realizes')
      .map((relation) => (relation.from === surfaceId ? relation.to : relation.from));
    const entryGendered = entryIds.some((entryId) =>
      relationsOf(graph, entryId).some((relation) => relation.type === 'has-gender'),
    );
    expect(entryGendered).toBe(true);
  });
  it.skipIf(!ja)('projection separates claim from evidence: claim learning over evidence known', () => {
    const id = surfaceIdFor(ja!, '人権');
    if (!id) return;
    const events: KnowledgeEvent[] = [
      { t: 1000, kind: 'review', source: 'srs', aspect: 'meaning', rating: 'good', easeAfter: 2.6, toStatus: 'known' },
      { t: 2000, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'learning' },
    ];
    const projection = buildKnowledgeProjection(ja!, id, events, POLICY, 3000);
    expect(projection.status).toBe('ready');
    const meaningStates = projection.targets.flatMap((target) => target.states)
      .filter((state) => state.capability === 'sense-recognition' || state.capability === 'surface-recognition');
    expect(meaningStates.length).toBeGreaterThan(0);
    for (const state of meaningStates) {
      expect(state.basis).toBe('claim');
      expect(state.classification).toBe('learning');
    }
  });

  it.skipIf(!ja)('no events → every applicable target is unmeasured, never evidence by omission', () => {
    const id = surfaceIdFor(ja!, '橋');
    if (!id) return;
    const projection = buildKnowledgeProjection(ja!, id, [], POLICY);
    const states = projection.targets.flatMap((target) => target.states);
    for (const state of states) {
      if (state.basis === 'evidence') throw new Error(`expected no evidence for an empty log, got ${state.capability}`);
    }
  });

  it.skipIf(!ja)('applicable targets exist and are typed capabilities', () => {
    const id = surfaceIdFor(ja!, '食べる');
    if (!id) return;
    const surface = ja!.nodes.get(id)!;
    const targets = learnableTargetsFor(ja!, [surface]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(typeof target.capability).toBe('string');
      expect(ja!.nodes.has(target.entityId)).toBe(true);
    }
  });
});
