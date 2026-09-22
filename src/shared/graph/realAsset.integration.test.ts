import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadLinguisticGraph, relationsOf, identityNeighbors, type LingualGraph } from './load';
import type { GraphEntity } from './types';

/**
 * REQ55/REQ65 integration: runs the REAL generated language assets through the
 * REAL loader and traces the representative audit items end-to-end (identity,
 * relations, capability applicability). Skips when an asset is not generated
 * locally (assets are produced by scripts/language-data builders).
 */
const ASSET_DIR = join(__dirname, '../../../scripts/language-data/source/root-of-app/languages');

const assetPath = (lang: string) => join(ASSET_DIR, `${lang}.graph.json`);
const hasAsset = (lang: string) => existsSync(assetPath(lang));

async function loadReal(lang: string): Promise<LingualGraph> {
  const { readFileSync } = await import('node:fs');
  const asset = JSON.parse(readFileSync(assetPath(lang), 'utf-8')) as Parameters<typeof loadLinguisticGraph>[0];
  return loadLinguisticGraph(asset);
}

/** Each language owns one graph; release it before the next language loads. */
function realGraphFixture(language: string): () => LingualGraph {
  let graph: LingualGraph | undefined;
  beforeAll(async () => {
    graph = await loadReal(language);
  }, 60_000);
  afterAll(() => { graph = undefined; });
  return () => {
    if (!graph) throw new Error(`Real ${language} graph fixture was not loaded`);
    return graph;
  };
}

function surfacesByLabel(graph: LingualGraph, label: string): GraphEntity[] {
  return [...graph.nodes.values()].filter((e) => e.kind === 'surface' && e.label === label);
}

describe.skipIf(!hasAsset('ja'))('real ja graph asset — representative items (REQ65)', () => {
  const getGraph = realGraphFixture('ja');
  it('loads the real asset with honest schema and scale', () => {
    const graph = getGraph();
    expect(graph.nodes.size).toBeGreaterThan(500_000);
  });

  it('殖える and 増える are separate lexemes sharing only support (JMdict entry ≠ pedagogical identity)', () => {
    const graph = getGraph();
    const aeru = surfacesByLabel(graph, '殖える');
    const fueru = surfacesByLabel(graph, '増える');
    expect(aeru.length).toBeGreaterThan(0);
    expect(fueru.length).toBeGreaterThan(0);
    for (const a of aeru) {
      const identitySiblingIds = identityNeighbors(graph, a.id)
        .map((id) => graph.nodes.get(id))
        .filter((n): n is GraphEntity => Boolean(n));
      expect(identitySiblingIds.some((n) => n.label === '増える')).toBe(false);
    }
  });

  it('homophones 橋/箸/端 stay lexically independent despite はし pronunciation', () => {
    const graph = getGraph();
    const groups = ['橋', '箸', '端'].map((l) => surfacesByLabel(graph, l));
    groups.forEach((g) => expect(g.length).toBeGreaterThan(0));
    const ids = new Set(groups.flat().map((s) => s.id));
    for (const s of groups.flat()) {
      const identity = identityNeighbors(graph, s.id).filter((id) => ids.has(id));
      expect(identity).toHaveLength(0);
    }
  });

  it('食べる resolves to a real surface with linguistic structure (pronunciation/sense/entry)', () => {
    const graph = getGraph();
    const taberu = surfacesByLabel(graph, '食べる');
    expect(taberu.length).toBeGreaterThan(0);
    const rels = relationsOf(graph, taberu[0].id);
    expect(rels.length).toBeGreaterThan(0);
    const types = new Set(rels.map((r) => r.type));
    const hasStructure = ['has-pronunciation', 'has-sense', 'realizes', 'has-reading'].some((t) => types.has(t as Parameters<typeof types.has>[0]));
    expect(hasStructure).toBe(true);
  });

  it('人権, 風邪, 青 resolve to real surface entities', () => {
    const graph = getGraph();
    for (const label of ['人権', '風邪', '青']) {
      expect(surfacesByLabel(graph, label).length).toBeGreaterThan(0);
    }
  });
  it('食べる realizes an entry carrying part-of-speech property data', () => {
    const graph = getGraph();
    const taberu = surfacesByLabel(graph, '食べる');
    expect(taberu.length).toBeGreaterThan(0);
    const entryIds = relationsOf(graph, taberu[0].id).filter((relation) => relation.type === 'realizes')
      .map((relation) => relation.from === taberu[0].id ? relation.to : relation.from);
    const entryRelationTypes = new Set(entryIds.flatMap((id) => relationsOf(graph, id).map((relation) => relation.type)));
    expect(entryRelationTypes.has('has-pos')).toBe(true);
  });
});

describe.skipIf(!hasAsset('de'))('real de graph asset', () => {
  const getGraph = realGraphFixture('de');
  it('German package carries its own capability id and relation type', () => {
    const graph = getGraph();
    const genderRels = [...graph.asset.relations].filter((r) => r.type === 'de::has-gender');
    expect(genderRels.length).toBeGreaterThan(0);
    expect([...graph.nodes.values()].some((entity) => entity.learnableCapabilities?.includes('de::gender'))).toBe(true);
  });
});

describe.skipIf(!hasAsset('ru'))('real ru graph asset', () => {
  const getGraph = realGraphFixture('ru');
  it('Russian emits inflection identity data', () => {
    const graph = getGraph();
    const inflections = [...graph.asset.relations].filter((r) => r.type === 'inflection-of');
    expect(inflections.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasAsset('zh'))('real zh graph asset', () => {
  const getGraph = realGraphFixture('zh');
  it('Chinese surfaces carry tone prosody data', () => {
    const graph = getGraph();
    const prosody = [...graph.asset.relations].filter((r) => r.type === 'has-prosodic-pattern');
    expect(prosody.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasAsset('es'))('real es graph asset', () => {
  const getGraph = realGraphFixture('es');
  it('Spanish entries carry part-of-speech property relations', () => {
    const graph = getGraph();
    const pos = [...graph.asset.relations].filter((relation) => relation.type === 'has-pos');
    expect(pos.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasAsset('cu'))('real cu graph asset', () => {
  const getGraph = realGraphFixture('cu');
  it('Church Slavonic emits inflection identity and part-of-speech data', () => {
    const graph = getGraph();
    expect([...graph.asset.relations].some((relation) => relation.type === 'inflection-of')).toBe(true);
    expect([...graph.asset.relations].some((relation) => relation.type === 'has-pos')).toBe(true);
  });
});
