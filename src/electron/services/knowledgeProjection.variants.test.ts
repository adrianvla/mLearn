import { describe, expect, it } from 'vitest';
import { loadLinguisticGraph, type LingualGraph } from '../../shared/graph/load';
import { buildKnowledgeProjection } from './knowledgeProjection';
import type { KnowledgeProjection } from '../../shared/graph/ipc';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

/**
 * Tier-2 graph-relative acceptance fixtures, mirroring the REAL authoritative
 * Jitendex data verified in scripts/language-data (entry 1604730 etc.):
 *
 * - 苗字/名字 realize ONE entry, both share the pronunciation みょうじ, and the
 *   builder emits ordered has-character edges 苗(0)/字(1) and 名(0)/字(1).
 * - 橋/箸 share the pronunciation はし but realize DIFFERENT entries.
 */

const policy = { learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 36500 };

const MYOJI = `ja:surface:${'m'.repeat(64)}`; // 苗字 — the unseen written variant
const NAZI = `ja:surface:${'n'.repeat(64)}`; // 名字 — the known written variant
const ENTRY = 'ja:entry:1604730';
const SENSE = 'ja:sense:1604730:1';
const PRON = 'ja:pron:みょうじ';
const CHAR_MYO = 'ja:char:苗';
const CHAR_JI = 'ja:char:字';
const CHAR_NA = 'ja:char:名';

function variantGraph(): LingualGraph {
  return loadLinguisticGraph({
    schemaVersion: 1,
    language: 'ja',
    generatedAt: '',
    sourceVersions: {},
    entities: [
      { id: MYOJI, kind: 'surface', label: '苗字' },
      { id: NAZI, kind: 'surface', label: '名字' },
      { id: ENTRY, kind: 'dictionary-entry' },
      { id: SENSE, kind: 'sense', label: 'surname' },
      { id: PRON, kind: 'pronunciation', label: 'みょうじ' },
      { id: CHAR_MYO, kind: 'character', label: '苗' },
      { id: CHAR_JI, kind: 'character', label: '字' },
      { id: CHAR_NA, kind: 'character', label: '名' },
      { id: 'ja:prosody:p0', kind: 'grammar-pattern', label: 'p0' },
      // Homophone firewall: 箸 shares the audio, realizes a DIFFERENT entry.
      { id: `ja:surface:${'h'.repeat(64)}`, kind: 'surface', label: '箸' },
      { id: 'ja:entry:1476410', kind: 'dictionary-entry' },
    ],
    relations: [
      { from: NAZI, to: ENTRY, type: 'realizes' },
      { from: MYOJI, to: ENTRY, type: 'realizes' },
      { from: `ja:surface:${'h'.repeat(64)}`, to: 'ja:entry:1476410', type: 'realizes' },
      { from: ENTRY, to: SENSE, type: 'has-sense' },
      { from: NAZI, to: PRON, type: 'has-pronunciation' },
      { from: MYOJI, to: PRON, type: 'has-pronunciation' },
      { from: `ja:surface:${'h'.repeat(64)}`, to: PRON, type: 'has-pronunciation' },
      // Builder-emitted ordered character components.
      { from: MYOJI, to: CHAR_MYO, type: 'has-character', order: 0 },
      { from: MYOJI, to: CHAR_JI, type: 'has-character', order: 1 },
      { from: NAZI, to: CHAR_NA, type: 'has-character', order: 0 },
      { from: NAZI, to: CHAR_JI, type: 'has-character', order: 1 },
      // Kanjium pitch: both variants share one accent pattern.
      { from: NAZI, to: 'ja:prosody:p0', type: 'has-prosodic-pattern' },
      { from: MYOJI, to: 'ja:prosody:p0', type: 'has-prosodic-pattern' },
    ],
  });
}

function stateOf(projection: KnowledgeProjection, entityId: string, capability: string) {
  return projection.targets
    .find((target) => target.targetRef.id === entityId)
    ?.states.find((state) => state.capability === capability);
}

describe('graph-relative learner overlay (苗字/名字 walkthrough)', () => {
  it('A: knowing 名字 resolves sense/spoken for 苗字 without fabricating written evidence', () => {
    const events: KnowledgeEvent[] = [
      // Evidence recorded through 名字 only: heard it, know the meaning.
      { t: 1, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'sense-recognition' }, easeAfter: 3, attemptId: 'evt1' },
      { t: 2, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id: NAZI, capability: 'spoken-recognition' }, toStatus: 'known' },
    ];
    const projection = buildKnowledgeProjection(variantGraph(), MYOJI, events, policy, 10);

    // The sense state resolved through the shared entry…
    const sense = stateOf(projection, SENSE, 'sense-recognition');
    expect(sense).toMatchObject({ classification: 'known', basis: 'evidence' });
    // …and the spoken claim resolved entry-level across the variant.
    const spoken = stateOf(projection, MYOJI, 'spoken-recognition');
    expect(spoken).toMatchObject({ classification: 'known', basis: 'claim' });
    // The written bridge stays UNMEASURED but predicted — cheap bridge.
    const recognition = stateOf(projection, MYOJI, 'surface-recognition');
    expect(recognition).toMatchObject({ classification: 'predicted', basis: 'prediction' });
    expect(recognition?.evidence).toHaveLength(0);
    expect(recognition?.prediction?.reasons.join(' ')).toContain('realizes');
    // Word-level summary: the lexical object is NOT wholly unknown.
    expect(projection.lexical).toMatchObject({ synchronized: true });
    expect(projection.lexical?.missingBridges).toContain('surface-recognition');
  });

  it('A: never fabricates direct 苗字 evidence — the journal input is untouched', () => {
    const events: KnowledgeEvent[] = [
      { t: 1, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'sense-recognition' }, easeAfter: 3, attemptId: 'evt1' },
    ];
    const frozen = JSON.parse(JSON.stringify(events));
    buildKnowledgeProjection(variantGraph(), MYOJI, events, policy, 10);
    expect(events).toEqual(frozen);
  });

  it('A: homophone evidence does not ride shared pronunciation into the variant', () => {
    const events: KnowledgeEvent[] = [
      // 箸 heard → known. Different entry — must NOT leak into 苗字's projection.
      { t: 1, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id: `ja:surface:${'h'.repeat(64)}`, capability: 'spoken-recognition' }, toStatus: 'known' },
    ];
    const projection = buildKnowledgeProjection(variantGraph(), MYOJI, events, policy, 10);
    expect(stateOf(projection, MYOJI, 'spoken-recognition')).toMatchObject({ classification: 'unmeasured' });
    expect(projection.lexical?.synchronized).toBe(false);
  });

  it('B: known 字 supports the reading prediction while 苗 stays unknown — support only', () => {
    const events: KnowledgeEvent[] = [
      // "I know these characters": 字 claimed known; 苗 unknown.
      { t: 1, kind: 'claim', source: 'manual', targetRef: { kind: 'character', id: CHAR_JI, capability: 'character-recognition' }, toStatus: 'known' },
      { t: 2, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id: NAZI, capability: 'spoken-recognition' }, toStatus: 'known' },
      { t: 3, kind: 'rating', source: 'srs', aspect: 'meaning', easeAfter: 3, attemptId: 'evt1' },
    ];
    const projection = buildKnowledgeProjection(variantGraph(), MYOJI, events, policy, 10);

    const characterState = stateOf(projection, CHAR_JI, 'character-recognition');
    expect(characterState).toMatchObject({ classification: 'known', basis: 'claim' });
    expect(stateOf(projection, CHAR_MYO, 'character-recognition')).toMatchObject({ classification: 'unmeasured' });

    const reading = stateOf(projection, MYOJI, 'surface-reading');
    expect(reading).toMatchObject({ classification: 'predicted', basis: 'prediction' });
    const reasons = reading?.prediction?.reasons.join(' ') ?? '';
    expect(reasons).toContain('component-inference');
    // Support NEVER becomes evidence: no measured rows under the bridge.
    expect(reading?.evidence).toHaveLength(0);
  });

  it('C: spoken-known meaning-known spelling-unknown is synchronized with missing bridges', () => {
    const events: KnowledgeEvent[] = [
      { t: 1, kind: 'rating', source: 'anki', targetRef: { kind: 'surface', id: NAZI, capability: 'sense-recognition' }, easeAfter: 3.2, attemptId: 'evt1', method: 'recall', quality: 'fluent' },
      { t: 2, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'spoken-recognition' }, easeAfter: 3, attemptId: 'evt2', quality: 'fluent' },
    ];
    const projection = buildKnowledgeProjection(variantGraph(), MYOJI, events, policy, 10);
    expect(projection.lexical?.sense).toMatchObject({ classification: 'known', basis: 'evidence' });
    expect(projection.lexical?.spoken).toMatchObject({ classification: 'known', basis: 'evidence' });
    expect(projection.lexical?.surfaceRecognition).toMatchObject({ classification: 'unmeasured' });
    expect(projection.lexical?.missingBridges).toEqual(expect.arrayContaining(['surface-recognition', 'surface-reading']));
  });

  it('D: inference-mediated success stays distinct from direct retrieval and calibrates transfer', () => {
    const events: KnowledgeEvent[] = [
      // Direct retrieval: method recall.
      { t: 1, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'sense-recognition' }, easeAfter: 3, attemptId: 'direct', method: 'recall', quality: 'fluent' },
      // Compositional inference on an unseen compound: method inference.
      { t: 2, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'sense-recognition' }, easeAfter: 3, attemptId: 'inferred', method: 'inference', quality: 'fluent' },
    ];
    const projection = buildKnowledgeProjection(variantGraph(), MYOJI, events, policy, 10);
    const sense = stateOf(projection, SENSE, 'sense-recognition');
    // Both events are evidence, but the projection must keep the bases apart:
    // only the recall event counts as direct retrieval success.
    expect(sense?.lastDirectSuccess).toBe(1);
    expect(sense?.evidence.map((event) => event.quality)).toContain('fluent');
    // The successful inference lifts the predictor's transfer calibration —
    // visible as a stronger predicted bridge than without inference history.
    const calibrated = buildKnowledgeProjection(variantGraph(), MYOJI, [
      ...events,
      { t: 3, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'sense-recognition' }, easeAfter: 3, attemptId: 'inferred2', method: 'inference', quality: 'fluent' },
      { t: 4, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'sense-recognition' }, easeAfter: 3, attemptId: 'inferred3', method: 'inference', quality: 'fluent' },
    ], policy, 10);
    const uncalibrated = stateOf(projection, MYOJI, 'surface-recognition')?.prediction?.value ?? 0;
    const boosted = stateOf(calibrated, MYOJI, 'surface-recognition')?.prediction?.value ?? 0;
    expect(boosted).toBeGreaterThan(uncalibrated);
  });

  it('G: prosody is unmeasured without a task, a claim is a claim, production is evidence', () => {
    const events: KnowledgeEvent[] = [
      { t: 1, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id: NAZI, capability: 'prosodic-pattern' }, toStatus: 'learning' },
    ];
    const claimed = buildKnowledgeProjection(variantGraph(), NAZI, events, policy, 10);
    expect(stateOf(claimed, NAZI, 'prosodic-pattern')).toMatchObject({ classification: 'learning', basis: 'claim' });

    const unmeasured = buildKnowledgeProjection(variantGraph(), NAZI, [], policy, 10);
    expect(stateOf(unmeasured, NAZI, 'prosodic-pattern')).toMatchObject({ classification: 'unmeasured', basis: 'unmeasured' });

    const produced = buildKnowledgeProjection(variantGraph(), NAZI, [
      { t: 2, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'prosodic-pattern' }, easeAfter: 3.4, attemptId: 'prod', quality: 'fluent' },
    ], policy, 10);
    expect(stateOf(produced, NAZI, 'prosodic-pattern')).toMatchObject({ classification: 'known', basis: 'evidence' });
  });

  it('I: a package-defined namespaced access survives projection without runtime registration', () => {
    const events: KnowledgeEvent[] = [
      { t: 1, kind: 'rating', source: 'srs', targetRef: { kind: 'surface', id: NAZI, capability: 'x-test::glyph-tone' }, easeAfter: 3, attemptId: 'ns1', quality: 'fluent' },
      { t: 2, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id: NAZI, capability: 'x-test::glyph-tone' }, toStatus: 'known' },
    ];
    const projection = buildKnowledgeProjection(variantGraph(), NAZI, events, policy, 10);
    // The state travels through the whole pipeline under its own id — the
    // classification is real evidence, the label falls back to the raw id,
    // and no core vocabulary entry exists for it.
    const state = stateOf(projection, NAZI, 'x-test::glyph-tone');
    // The active claim overrides the evidence classification; both rows stay
    // attributed (same evidence contract as core capability states).
    expect(state).toMatchObject({ classification: 'known', basis: 'claim' });
    expect(state?.evidence).toHaveLength(2);
    expect(state?.evidenceSourceCounts).toEqual({ srs: 1, manual: 1 });
  });
});
