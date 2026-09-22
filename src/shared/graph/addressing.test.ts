import { describe, expect, it } from 'vitest';
import { loadLinguisticGraph, type LingualGraph } from './load';
import type { GraphEntity, GraphRelation } from './types';
import type { KnowledgeEvent } from '../knowledgeEvents';
import type { LearnableTarget } from './types';
import {
  eventAppliesToTarget,
  journalKeyOfSurfaceEntity,
  lexicalContextEntryIds,
  realizedEntryIds,
  sharesLexicalIdentity,
  siblingJournalKeys,
} from './addressing';

/**
 * Fixture mirroring the real authoritative Jitendex data:
 * - entry 1604730: 苗字 + 名字 realize ONE entry, both → みょうじ (variants)
 * - entries 1237410/1476410/1581610: 橋/箸/端(はし) share a pronunciation but
 *   are DIFFERENT entries (homophone firewall)
 * - 取る: one surface realizing TWO entries (ambiguous homograph)
 */
function buildGraph(): LingualGraph {
  const entities: GraphEntity[] = [
    { id: 'ja:entry:1604730', kind: 'dictionary-entry', label: '苗字' },
    { id: 'ja:sense:1604730:1', kind: 'sense', label: 'surname' },
    { id: 'ja:surface:myoji-kanji1', kind: 'surface', label: '苗字' },
    { id: 'ja:surface:myoji-kanji2', kind: 'surface', label: '名字' },
    { id: 'ja:pron:みょうじ', kind: 'pronunciation', label: 'みょうじ' },
    { id: 'ja:entry:1237410', kind: 'dictionary-entry', label: '橋' },
    { id: 'ja:surface:hashi-hashiki', kind: 'surface', label: '橋' },
    { id: 'ja:entry:1476410', kind: 'dictionary-entry', label: '箸' },
    { id: 'ja:surface:hashi-hashi', kind: 'surface', label: '箸' },
    { id: 'ja:entry:1581610', kind: 'dictionary-entry', label: '端' },
    { id: 'ja:surface:hashi-hashime', kind: 'surface', label: '端' },
    { id: 'ja:pron:はし', kind: 'pronunciation', label: 'はし' },
    { id: 'ja:surface:toru', kind: 'surface', label: '取る' },
    { id: 'ja:entry:toru-a', kind: 'dictionary-entry', label: '取る A' },
    { id: 'ja:entry:toru-b', kind: 'dictionary-entry', label: '取る B' },
    { id: 'ja:sense:toru-a:1', kind: 'sense', label: 'to take' },
    { id: 'ja:sense:toru-b:1', kind: 'sense', label: 'to record' },
    { id: 'ja:surface:toru-variant', kind: 'surface', label: '取るＢ' },
  ];
  const relations: GraphRelation[] = [
    { from: 'ja:surface:myoji-kanji1', to: 'ja:entry:1604730', type: 'realizes' },
    { from: 'ja:surface:myoji-kanji2', to: 'ja:entry:1604730', type: 'realizes' },
    { from: 'ja:surface:myoji-kanji1', to: 'ja:pron:みょうじ', type: 'has-pronunciation' },
    { from: 'ja:surface:myoji-kanji2', to: 'ja:pron:みょうじ', type: 'has-pronunciation' },
    { from: 'ja:entry:1604730', to: 'ja:sense:1604730:1', type: 'has-sense' },
    { from: 'ja:surface:hashi-hashiki', to: 'ja:entry:1237410', type: 'realizes' },
    { from: 'ja:surface:hashi-hashiki', to: 'ja:pron:はし', type: 'has-pronunciation' },
    { from: 'ja:surface:hashi-hashi', to: 'ja:entry:1476410', type: 'realizes' },
    { from: 'ja:surface:hashi-hashi', to: 'ja:pron:はし', type: 'has-pronunciation' },
    { from: 'ja:surface:hashi-hashime', to: 'ja:entry:1581610', type: 'realizes' },
    { from: 'ja:surface:hashi-hashime', to: 'ja:pron:はし', type: 'has-pronunciation' },
    { from: 'ja:surface:toru', to: 'ja:entry:toru-a', type: 'realizes' },
    { from: 'ja:surface:toru', to: 'ja:entry:toru-b', type: 'realizes' },
    { from: 'ja:surface:toru-variant', to: 'ja:entry:toru-b', type: 'realizes' },
    { from: 'ja:entry:toru-a', to: 'ja:sense:toru-a:1', type: 'has-sense' },
    { from: 'ja:entry:toru-b', to: 'ja:sense:toru-b:1', type: 'has-sense' },
  ];
  return loadLinguisticGraph({
    schemaVersion: 1,
    language: 'ja',
    generatedAt: '2026-01-01T00:00:00Z',
    sourceVersions: {},
    entities,
    relations,
  });
}

const MYOJI = 'ja:surface:myoji-kanji1'; // 苗字
const NAZI = 'ja:surface:myoji-kanji2'; // 名字
const TARGET_SENSE: LearnableTarget = { entityId: 'ja:sense:1604730:1', capability: 'sense-recognition' };
const MYOJI_SPOKEN: LearnableTarget = { entityId: MYOJI, capability: 'spoken-recognition' };
const MYOJI_SURFACE: LearnableTarget = { entityId: MYOJI, capability: 'surface-recognition' };
const NAZI_SURFACE: LearnableTarget = { entityId: NAZI, capability: 'surface-recognition' };

function surfaceEvent(capability: string, id: string, to?: string): KnowledgeEvent {
  return {
    t: 1,
    kind: 'rating',
    source: 'srs',
    quality: 'good',
    targetRef: { kind: 'surface', id, capability: capability as never, ...(to !== undefined ? { to } : {}) },
  };
}

describe('graph-relative access addressing', () => {
  it('transfers entry-level evidence across authoritative variant surfaces', () => {
    const graph = buildGraph();
    // 名字 heard → recognized; speaks for the shared entry, so 苗字 sees it.
    expect(eventAppliesToTarget(graph, surfaceEvent('spoken-recognition', NAZI), MYOJI_SPOKEN, MYOJI)).toBe(true);
    // 名字 meaning evidence transfers to the entry's sense (shared identity).
    expect(eventAppliesToTarget(graph, surfaceEvent('sense-recognition', NAZI), TARGET_SENSE, MYOJI)).toBe(true);
  });

  it('keeps surface-scoped accesses bound to the exact presented surface', () => {
    const graph = buildGraph();
    // 名字 recognized in writing proves NOTHING about 苗字's written bridge.
    expect(eventAppliesToTarget(graph, surfaceEvent('surface-recognition', NAZI), MYOJI_SURFACE, MYOJI)).toBe(false);
    expect(eventAppliesToTarget(graph, surfaceEvent('surface-recognition', NAZI), NAZI_SURFACE, NAZI)).toBe(true);
    expect(eventAppliesToTarget(graph, surfaceEvent('surface-reading', NAZI), { entityId: MYOJI, capability: 'surface-reading' }, MYOJI)).toBe(false);
  });

  it('never transfers through shared pronunciation alone (橋/箸/端 firewall)', () => {
    const graph = buildGraph();
    const hashi = 'ja:surface:hashi-hashiki';
    const hashiSpoken: LearnableTarget = { entityId: hashi, capability: 'spoken-recognition' };
    // 橋 heard → 箸 does NOT inherit: different entries despite identical audio.
    expect(eventAppliesToTarget(graph, surfaceEvent('spoken-recognition', 'ja:surface:hashi-hashi'), hashiSpoken, hashi)).toBe(false);
    expect(sharesLexicalIdentity(graph, 'ja:surface:hashi-hashiki', 'ja:surface:hashi-hashi')).toBe(false);
    expect(sharesLexicalIdentity(graph, 'ja:surface:hashi-hashiki', 'ja:surface:hashi-hashime')).toBe(false);
  });

  it('honors an explicit retrieved identity (targetRef.to) over derivation', () => {
    const graph = buildGraph();
    // Writer knew the claim was about the surname entry: transfers.
    expect(eventAppliesToTarget(graph, surfaceEvent('sense-recognition', 'ja:surface:hashi-hashiki', 'ja:entry:1604730'), TARGET_SENSE, MYOJI)).toBe(true);
  });

  it('lets an entry-ambiguous homograph speak only for itself', () => {
    const graph = buildGraph();
    const toru = 'ja:surface:toru';
    const toruSenseA: LearnableTarget = { entityId: 'ja:sense:toru-a:1', capability: 'sense-recognition' };
    // Self: the presented surface's own sense targets still see its evidence.
    expect(eventAppliesToTarget(graph, surfaceEvent('sense-recognition', toru), toruSenseA, toru)).toBe(true);
    // Sibling sharing only one of the ambiguous entries inherits nothing.
    expect(eventAppliesToTarget(graph, surfaceEvent('sense-recognition', toru), { entityId: 'ja:sense:toru-b:1', capability: 'sense-recognition' }, 'ja:surface:toru-variant')).toBe(false);
    // No sibling journal keys for ambiguous surfaces.
    expect(siblingJournalKeys(graph, toru)).toEqual([journalKeyOfSurfaceEntity(toru)]);
  });

  it('enumerates variant sibling journal keys through the unique shared entry', () => {
    const graph = buildGraph();
    expect(siblingJournalKeys(graph, MYOJI)).toEqual([
      journalKeyOfSurfaceEntity(MYOJI),
      journalKeyOfSurfaceEntity(NAZI),
    ]);
    expect(journalKeyOfSurfaceEntity(MYOJI)).toBe('ja:myoji-kanji1');
    expect(siblingJournalKeys(graph, 'ja:surface:hashi-hashiki')).toEqual([journalKeyOfSurfaceEntity('ja:surface:hashi-hashiki')]);
  });

  it('derives lexical identity contexts and realizations', () => {
    const graph = buildGraph();
    expect(realizedEntryIds(graph, MYOJI)).toEqual(['ja:entry:1604730']);
    expect(lexicalContextEntryIds(graph, 'ja:sense:1604730:1')).toEqual(['ja:entry:1604730']);
    expect(lexicalContextEntryIds(graph, 'ja:entry:1604730')).toEqual(['ja:entry:1604730']);
    expect(lexicalContextEntryIds(graph, 'ja:pron:はし')).toEqual([]);
    // Legacy flat events (no targetRef) keep capability-only caller scoping.
    expect(eventAppliesToTarget(graph, { t: 1, kind: 'rating', source: 'srs', aspect: 'meaning' }, TARGET_SENSE, MYOJI)).toBe(true);
  });

  it('routes package-declared opaque accesses by their declared scope', () => {
    const graph = buildGraph();
    const languageData = {
      name: 'Test language',
      learning: {
        capabilities: {
          'x-test::evidentiality': { scope: 'family' as const, shareAcrossIdentity: true },
          'x-test::register': { scope: 'surface' as const },
        },
      },
    };
    const familyTarget: LearnableTarget = { entityId: MYOJI, capability: 'x-test::evidentiality' };
    const surfaceTarget: LearnableTarget = { entityId: MYOJI, capability: 'x-test::register' };
    expect(eventAppliesToTarget(graph, surfaceEvent('x-test::evidentiality', NAZI), familyTarget, MYOJI, languageData)).toBe(true);
    expect(eventAppliesToTarget(graph, surfaceEvent('x-test::register', NAZI), surfaceTarget, MYOJI, languageData)).toBe(false);
    expect(eventAppliesToTarget(graph, surfaceEvent('x-test::register', MYOJI), surfaceTarget, MYOJI, languageData)).toBe(true);
  });
});
