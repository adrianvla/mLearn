import { describe, it, expect } from 'vitest';
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

function surfacesByLabel(graph: LingualGraph, label: string): GraphEntity[] {
  return [...graph.nodes.values()].filter((e) => e.kind === 'surface' && e.label === label);
}

describe.skipIf(!hasAsset('ja'))('real ja graph asset — representative items (REQ65)', () => {
  it('loads the real asset with honest schema and scale', async () => {
    const graph = await loadReal('ja');
    expect(graph.nodes.size).toBeGreaterThan(500_000);
  });

  it('殖える and 増える are separate lexemes sharing only support (JMdict entry ≠ pedagogical identity)', async () => {
    const graph = await loadReal('ja');
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

  it('homophones 橋/箸/端 stay lexically independent despite はし pronunciation', async () => {
    const graph = await loadReal('ja');
    const groups = ['橋', '箸', '端'].map((l) => surfacesByLabel(graph, l));
    groups.forEach((g) => expect(g.length).toBeGreaterThan(0));
    const ids = new Set(groups.flat().map((s) => s.id));
    for (const s of groups.flat()) {
      const identity = identityNeighbors(graph, s.id).filter((id) => ids.has(id));
      expect(identity).toHaveLength(0);
    }
  });

  it('食べる resolves to a real surface with linguistic structure (pronunciation/sense/entry)', async () => {
    const graph = await loadReal('ja');
    const taberu = surfacesByLabel(graph, '食べる');
    expect(taberu.length).toBeGreaterThan(0);
    const rels = relationsOf(graph, taberu[0].id);
    expect(rels.length).toBeGreaterThan(0);
    const types = new Set(rels.map((r) => r.type));
    const hasStructure = ['has-pronunciation', 'has-sense', 'realizes', 'has-reading'].some((t) => types.has(t as Parameters<typeof types.has>[0]));
    expect(hasStructure).toBe(true);
  });

  it('人権, 風邪, 青 resolve to real surface entities', async () => {
    const graph = await loadReal('ja');
    for (const label of ['人権', '風邪', '青']) {
      expect(surfacesByLabel(graph, label).length).toBeGreaterThan(0);
    }
  });
  it('食べる realizes an entry carrying part-of-speech property data', async () => {
    const graph = await loadReal('ja');
    const taberu = surfacesByLabel(graph, '食べる');
    expect(taberu.length).toBeGreaterThan(0);
    const entryIds = relationsOf(graph, taberu[0].id).filter((relation) => relation.type === 'realizes')
      .map((relation) => relation.from === taberu[0].id ? relation.to : relation.from);
    const entryRelationTypes = new Set(entryIds.flatMap((id) => relationsOf(graph, id).map((relation) => relation.type)));
    expect(entryRelationTypes.has('has-pos')).toBe(true);
  });
});

describe.skipIf(!hasAsset('de'))('real de graph asset', () => {
  it('German nouns carry gender as a property relation (data-driven capability)', async () => {
    const graph = await loadReal('de');
    const genderRels = [...graph.asset.relations].filter((r) => r.type === 'has-gender');
    expect(genderRels.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasAsset('ru'))('real ru graph asset', () => {
  it('Russian emits inflection identity data', async () => {
    const graph = await loadReal('ru');
    const inflections = [...graph.asset.relations].filter((r) => r.type === 'inflection-of');
    expect(inflections.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasAsset('zh'))('real zh graph asset', () => {
  it('Chinese surfaces carry tone prosody data', async () => {
    const graph = await loadReal('zh');
    const prosody = [...graph.asset.relations].filter((r) => r.type === 'has-prosodic-pattern');
    expect(prosody.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasAsset('es'))('real es graph asset', () => {
  it('Spanish entries carry part-of-speech property relations', async () => {
    const graph = await loadReal('es');
    const pos = [...graph.asset.relations].filter((relation) => relation.type === 'has-pos');
    expect(pos.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasAsset('cu'))('real cu graph asset', () => {
  it('Church Slavonic emits inflection identity and part-of-speech data', async () => {
    const graph = await loadReal('cu');
    expect([...graph.asset.relations].some((relation) => relation.type === 'inflection-of')).toBe(true);
    expect([...graph.asset.relations].some((relation) => relation.type === 'has-pos')).toBe(true);
  });
});
