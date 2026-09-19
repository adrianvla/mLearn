import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { GrammarItemSemanticValidation, GrammarPracticeItemSource, LanguageData } from '../../shared/types';
import { grammarEvidenceKey, replayGrammarRecognition } from '../../shared/grammar/evidence';
import type { KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { buildWordFrequencyMapFromLanguageData } from '../../shared/languageFeatures';
import {
  QUESTION_BATCH_LIMIT,
  QuestionBankCache,
  assembleContrastItem,
  assembleQuestionBatch,
  checkVocabularyControl,
  gradeContrastAnswer,
  isDeliverableItem,
  isInvalidatedItem,
  itemAttemptCounts,
  itemAttemptEvents,
  itemsForPattern,
  itemContentVersion,
  questionBankFromLanguageData,
  reconcileQuestionItems,
  retractionEventsForItem,
  undeliverableReason,
  validateAssembledItem,
  type DeclaredItemState,
  type QuestionItem,
} from './questionBank';

const item = (overrides: Partial<GrammarPracticeItemSource> = {}): GrammarPracticeItemSource => ({
  id: 'test-item-1',
  context: 'Wir gehen spazieren, obwohl es regnet.',
  answerSpan: 'obwohl',
  conditions: ['concessive-reading', 'subordinate-clause-final-verb'],
  distractors: [
    { span: 'weil', violates: ['concessive-reading'], rationale: 'causal reading contradicts the walk' },
    { span: 'deshalb', violates: ['concessive-reading', 'subordinate-clause-final-verb'], rationale: 'causal adverb, verb-second' },
  ],
  ...overrides,
});

const assemble = (source: GrammarPracticeItemSource, seed?: number): QuestionItem =>
  assembleContrastItem(source, { language: 'de', pattern: 'obwohl', contentVersion: 'de-package-test', ...(seed !== undefined ? { seed } : {}) });

/**
 * A semantic record produced by the FIXTURE validator — a test stand-in for
 * an actually-executed independent validation (bound to the real item
 * content). Production packages carry no such record until a real
 * independent validator runs; the app never fabricates one (R12).
 */
const semanticRecord = (source: GrammarPracticeItemSource, overrides: Partial<GrammarItemSemanticValidation> = {}): GrammarItemSemanticValidation => ({
  status: 'passed',
  validator: 'fixture-independent-validator@1',
  at: '2026-09-19T00:00:00Z',
  contentHash: itemContentVersion(source),
  reasons: ['fixture record'],
  ...overrides,
});
const reviewed = (overrides: Partial<GrammarPracticeItemSource> = {}): GrammarPracticeItemSource => {
  const source = item(overrides);
  return { ...source, validation: { semantic: semanticRecord(source) } };
};
const declared = (entries: ReadonlyArray<readonly [id: string, version: string, invalid?: boolean]>): ReadonlyMap<string, DeclaredItemState> =>
  new Map(entries.map(([id, version, invalid]) => [id, { version, invalid: invalid ?? false }]));

describe('contrast item assembly (R12)', () => {
  it('is deterministic: same seed and inputs assemble the identical item', () => {
    const first = assemble(item(), 12345);
    const second = assemble(item(), 12345);
    expect(second).toEqual(first);
  });

  it('removes exactly the answer span and never carries a gold flag (G02)', () => {
    const source = item();
    const assembled = assemble(source, 7);
    expect(assembled.prompt).toBe('Wir gehen spazieren,  es regnet.');
    expect(assembled.prompt.slice(assembled.gap.start, assembled.gap.end)).toBe('');
    expect(assembled.prompt.slice(0, assembled.gap.start) + source.answerSpan + assembled.prompt.slice(assembled.gap.end))
      .toBe(source.context);
    for (const option of assembled.options) {
      expect(Object.keys(option)).toEqual(['text']);
    }
  });

  it('assembles the option set {answer} ∪ distractors in a seeded order', () => {
    const source = item();
    const assembled = assemble(source, 42);
    expect(assembled.options.map((option) => option.text).sort()).toEqual(['deshalb', 'obwohl', 'weil']);
    const other = assemble(source, 43);
    expect(other.options.map((option) => option.text).sort()).toEqual(['deshalb', 'obwohl', 'weil']);
    // Same set, independently seeded order.
    expect(assembled.seed).not.toBe(other.seed);
  });

  it('targets the canonical grammar entity, not a surface proxy', () => {
    const assembled = assemble(item(), 1);
    expect(assembled.targetRef).toEqual({
      kind: 'grammar-pattern',
      id: 'de:grammar:obwohl',
      capability: 'grammar-recognition',
    });
    expect(assembled.provenance).toEqual({ source: 'mlearn-authored', contentVersion: 'de-package-test' });
    // `version` is the ITEM content version (change-detection hash), not the
    // package version — journal itemRefs bind attempts to item content (G03).
    expect(assembled.version).toBe(itemContentVersion(item()));
    expect(assembled.version).toMatch(/^item-v3:[0-9a-f]{16}$/);
  });
});

describe('independent whole-item validation (R12)', () => {
  it('deterministic validation passes a well-formed assembled item', () => {
    const assembled = assemble(item(), 5);
    expect(assembled.validation.deterministic.status).toBe('passed');
    expect(isInvalidatedItem(assembled)).toBe(false);
  });

  it('gates delivery on an actually-executed independent semantic validation (R12)', () => {
    // Honest absence: deterministic consistency alone never substitutes for
    // the semantic tier — an unreviewed item is simply undeliverable.
    const unreviewed = assemble(item(), 5);
    expect(isDeliverableItem(unreviewed)).toBe(false);
    expect(undeliverableReason(unreviewed)).toBe('unreviewed');

    // A record that actually executed (fixture validator), bound to the
    // current content, with provenance: deliverable.
    const deliverable = assemble(reviewed(), 5);
    expect(deliverable.validation.semantic?.status).toBe('passed');
    expect(isDeliverableItem(deliverable)).toBe(true);
  });

  it('never delivers a semantic rejection, stale record, or missing provenance', () => {
    const rejectedSource: GrammarPracticeItemSource = { ...item(), validation: { semantic: semanticRecord(item(), { status: 'rejected', reasons: ['reads ambiguously'] }) } };
    const rejected = assemble(rejectedSource, 5);
    expect(isDeliverableItem(rejected)).toBe(false);
    expect(undeliverableReason(rejected)).toBe('semantic-rejected');
    expect(isInvalidatedItem(rejected)).toBe(true);

    // A record produced against different content is stale: assembly never
    // applies it — the item is unreviewed again, never half-validated.
    const staleSource: GrammarPracticeItemSource = { ...item(), validation: { semantic: semanticRecord(item(), { contentHash: 'item-v1:deadbeefdeadbeef' }) } };
    const stale = assemble(staleSource, 5);
    expect(isDeliverableItem(stale)).toBe(false);
    // Assembly never applies a stale record: the item is unreviewed again,
    // never half-validated (the stale-record reason reports records that a
    // caller injected onto an assembled item with a wrong binding).
    expect(undeliverableReason(stale)).toBe('unreviewed');
    expect(stale.validation.semantic).toBeUndefined();

    // A "passed" record without validator identity / execution timestamp is
    // not the record of an actual validation.
    const anonymousSource: GrammarPracticeItemSource = { ...item(), validation: { semantic: semanticRecord(item(), { validator: '  ', at: '' }) } };
    const anonymous = assemble(anonymousSource, 5);
    expect(anonymous.validation.semantic).toBeDefined();
    expect(isDeliverableItem(anonymous)).toBe(false);
    expect(undeliverableReason(anonymous)).toBe('missing-provenance');
  });

  it('item content changes produce a new item content version; identical content does not (G03)', () => {
    const base = item();
    expect(itemContentVersion(base)).toBe(itemContentVersion(item()));
    for (const changed of [
      item({ context: 'Wir gehen spazieren, obwohl es schneit.' }),
      item({ conditions: ['concessive-reading'] }),
      item({ accepts: ['Obwohl'] }),
      item({ register: 'formal written German' }),
      item({ formats: ['typed'] }),
      item({ id: 'test-item-2' }),
      item({ distractors: [{ span: 'weil', violates: ['concessive-reading'], rationale: 'anders' }, item().distractors[1]] }),
    ]) {
      expect(itemContentVersion(changed)).not.toBe(itemContentVersion(base));
    }
  });

  it('a semantic record binds to the assessed content; validation flags mis-bound records', () => {
    const source = reviewed();
    const assembled = assemble(source, 5);
    expect(assembled.validation.semantic?.contentHash).toBe(assembled.version);
    const misbound: QuestionItem = {
      ...assembled,
      validation: {
        deterministic: assembled.validation.deterministic,
        semantic: { ...assembled.validation.semantic!, contentHash: 'item-v1:ffffffffffffffff' },
      },
    };
    const result = validateAssembledItem(misbound, source);
    expect(result.status).toBe('rejected');
    expect(result.reasons.some((reason) => reason.includes('does not bind'))).toBe(true);
  });

  it('rejects an ambiguous item: a distractor violating nothing', () => {
    const source = item({ distractors: [
      { span: 'weil', violates: [], rationale: 'broken' },
      { span: 'deshalb', violates: ['concessive-reading'], rationale: 'ok' },
    ] });
    const result = validateAssembledItem(assemble(source, 5), source);
    expect(result.status).toBe('rejected');
    expect(result.reasons.some((reason) => reason.includes('ambiguous'))).toBe(true);
  });

  it('rejects a distractor violating only conditions the item does not declare', () => {
    const source = item({ distractors: [
      { span: 'weil', violates: ['some-other-condition'], rationale: 'unrelated' },
      { span: 'deshalb', violates: ['concessive-reading'], rationale: 'ok' },
    ] });
    const result = validateAssembledItem(assemble(source, 5), source);
    expect(result.status).toBe('rejected');
    expect(result.reasons.some((reason) => reason.includes('violates no declared condition'))).toBe(true);
  });

  it('rejects when the answer span is missing from or duplicated in the context', () => {
    const missing = item({ context: 'Wir gehen spazieren, obwohl es regnet.', answerSpan: 'weil' });
    const missingItem = assembleContrastItem(missing, { language: 'de', pattern: 'weil' });
    expect(validateAssembledItem(missingItem, missing).status).toBe('rejected');

    const twice = item({ context: 'Wir gehen spazieren, obwohl es regnet, obwohl es kalt ist.', answerSpan: 'obwohl' });
    const twiceItem = assembleContrastItem(twice, { language: 'de', pattern: 'obwohl' });
    const result = validateAssembledItem(twiceItem, twice);
    expect(result.status).toBe('rejected');
    expect(result.reasons.some((reason) => reason.includes('expected exactly once'))).toBe(true);
  });

  it('rejects a distractor that appears verbatim in the delivered prompt (accidental clue)', () => {
    const source = item({ context: 'Wir gehen deshalb spazieren, obwohl es regnet.' });
    const result = validateAssembledItem(assemble(source, 5), source);
    expect(result.status).toBe('rejected');
    expect(result.reasons.some((reason) => reason.includes('accidental clue'))).toBe(true);
  });

  it('rejects duplicate options and undersized option sets', () => {
    const duplicate = item({ distractors: [
      { span: 'weil', violates: ['concessive-reading'], rationale: 'a' },
      { span: 'weil', violates: ['subordinate-clause-final-verb'], rationale: 'b' },
    ] });
    expect(validateAssembledItem(assemble(duplicate, 5), duplicate).status).toBe('rejected');

    const single = item({ distractors: [{ span: 'weil', violates: ['concessive-reading'], rationale: 'only one' }] });
    expect(validateAssembledItem(assemble(single, 5), single).status).toBe('rejected');
  });

  it('rejects an item whose delivered option order is not reproducible from its seed', () => {
    const source = item();
    const assembled = assemble(source, 5);
    const corrupt: QuestionItem = { ...assembled, seed: 99 };
    const result = validateAssembledItem(corrupt, source);
    expect(result.status).toBe('rejected');
    expect(result.reasons).toContain('option order is not reproducible from the recorded seed');
  });

  it('rejects items without declared conditions or distractor rationale', () => {
    const noConditions = item({ conditions: [] });
    expect(validateAssembledItem(assemble(noConditions, 5), noConditions).status).toBe('rejected');

    const noRationale = item({ distractors: [{ span: 'weil', violates: ['concessive-reading'], rationale: ' ' }] });
    expect(validateAssembledItem(assemble(noRationale, 5), noRationale).status).toBe('rejected');
  });

});

describe('grading (submit-time gold re-derivation)', () => {
  const source = item();
  const assembled = assemble(source, 11);
  const goldIndex = assembled.options.findIndex((option) => option.text === 'obwohl');

  it('grades an MCQ selection without the surface ever holding the key', () => {
    expect(gradeContrastAnswer(assembled, source, { kind: 'mcq', index: goldIndex }).correct).toBe(true);
    expect(gradeContrastAnswer(assembled, source, { kind: 'mcq', index: (goldIndex + 1) % assembled.options.length }).correct).toBe(false);
  });

  it('grades typed answers against the declared span and accepted alternatives, never fuzzy', () => {
    expect(gradeContrastAnswer(assembled, source, { kind: 'typed', value: '  obwohl ' }).correct).toBe(true);
    const withVariants = item({ accepts: ['Obwohl'] });
    const variantItem = assemble(withVariants, 11);
    expect(gradeContrastAnswer(variantItem, withVariants, { kind: 'typed', value: 'Obwohl' }).correct).toBe(true);
    expect(gradeContrastAnswer(variantItem, withVariants, { kind: 'typed', value: 'obwohhl' }).correct).toBe(false);
  });

  it('records input-device provenance as scaffolds, never as an error (G05)', () => {
    const ime = gradeContrastAnswer(assembled, source, { kind: 'typed', value: 'obwohl', suppliedBy: 'ime' });
    expect(ime.scaffolds).toEqual({ 'ime-composition': true });
    const speech = gradeContrastAnswer(assembled, source, { kind: 'typed', value: 'obwohl', suppliedBy: 'speech' });
    expect(speech.scaffolds).toEqual({ 'asr-transcription': true });
    const keyboard = gradeContrastAnswer(assembled, source, { kind: 'typed', value: 'obwohl', suppliedBy: 'keyboard' });
    expect(keyboard.scaffolds).toBeUndefined();
  });
});

describe('batch + cache off the fast path (R12/R17)', () => {
  it('assembles a bounded batch and reports deterministic rejections with reasons', () => {
    const bank = questionBankFromLanguageData('de', {
      grammar: [
        { pattern: 'obwohl', items: [reviewed()] },
        { pattern: 'weil', items: [item({ id: 'broken-1', answerSpan: 'missing' })] },
        { pattern: 'trotzdem', items: [item({ id: 'pending-1', context: 'Es war spät, trotzdem bin ich geblieben.' , answerSpan: 'trotzdem' })] },
      ],
      languageData: { version: 'v9' },
    });
    const result = assembleQuestionBatch(bank, 8);
    // The batch is the SERVING pool: deliverable items only. Deterministic
    // rejections and honestly-undeliverable items are reported, not dropped.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('test-item-1');
    expect(result.rejected).toEqual([
      { id: 'broken-1', reasons: expect.arrayContaining([expect.stringContaining('expected exactly once')]) },
    ]);
    expect(result.pending).toEqual([{ id: 'pending-1', reason: 'unreviewed' }]);
    expect(result.skipped).toBe(0);
  });

  it('caps the batch at the declared limit', () => {
    const bank = questionBankFromLanguageData('de', {
      grammar: [1, 2, 3, 4, 5].map((n) => ({
        pattern: `p${n}`,
        items: [reviewed({ id: `item-${n}`, context: `Satz ${n}, obwohl es regnet.`, answerSpan: 'obwohl' })],
      })),
    });
    const result = assembleQuestionBatch(bank, 3);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((entry) => entry.id)).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('serves repeated encounters from the cache; version change assembles anew', () => {
    const cache = new QuestionBankCache(8);
    const source = item();
    const first = cache.getOrAssemble(source, { language: 'de', pattern: 'obwohl', contentVersion: 'v1' });
    expect(cache.getOrAssemble(source, { language: 'de', pattern: 'obwohl', contentVersion: 'v1' })).toBe(first);
    const next = cache.getOrAssemble(source, { language: 'de', pattern: 'obwohl', contentVersion: 'v2' });
    expect(next).not.toBe(first);
    expect(next.version).toBe(itemContentVersion(source));
    cache.invalidate((cached) => cached.provenance.contentVersion === 'v2');
    expect(cache.size).toBe(1);
  });

  it('evicts least-recently-used entries at capacity', () => {
    const cache = new QuestionBankCache(2);
    const a = item({ id: 'a' });
    const b = item({ id: 'b' });
    const c = item({ id: 'c' });
    cache.getOrAssemble(a, { language: 'de', pattern: 'obwohl' });
    cache.getOrAssemble(b, { language: 'de', pattern: 'obwohl' });
    cache.getOrAssemble(a, { language: 'de', pattern: 'obwohl' }); // refresh a
    cache.getOrAssemble(c, { language: 'de', pattern: 'obwohl' }); // evicts b
    expect(cache.size).toBe(2);
    expect(cache.getOrAssemble(b, { language: 'de', pattern: 'obwohl' })).not.toBeNull();
  });

  it('keys the cache by validation provenance: a different executed record re-assembles with ITS record', () => {
    // The delivered item must cite the semantic record that CURRENTLY
    // authorizes it — attempts derive validationRef from it. Sharing one
    // cache entry across records (same id/content, different validator)
    // would attribute an attempt to the wrong validator.
    const cache = new QuestionBankCache(4);
    const withA = reviewed();
    const withB = { ...item(), validation: { semantic: semanticRecord(item(), { validator: 'fixture-independent-validator@2' }) } };
    const first = cache.getOrAssemble(withA, { language: 'de', pattern: 'obwohl', contentVersion: 'v1' });
    const second = cache.getOrAssemble(withB, { language: 'de', pattern: 'obwohl', contentVersion: 'v1' });
    expect(second).not.toBe(first);
    expect(first.validation.semantic?.validator).toBe('fixture-independent-validator@1');
    expect(second.validation.semantic?.validator).toBe('fixture-independent-validator@2');
    expect(cache.getOrAssemble(withA, { language: 'de', pattern: 'obwohl', contentVersion: 'v1' })).toBe(first);
  });
});

describe('item invalidation and retraction (G03)', () => {
  const language = 'de';
  const pattern = 'weil';
  const key = grammarEvidenceKey(language, pattern, 'grammar-recognition');
  const itemRef = { id: 'de-weil-fieber-1', version: 'de-package-2026.09.19' };

  const attempt = (id: string, extra: Record<string, unknown> = {}) => ({
    t: 1000,
    kind: 'rating' as const,
    source: 'grammar' as const,
    aspect: 'grammar' as const,
    attemptId: id,
    quality: 'struggled' as const,
    easeAfter: 1.55,
    itemRef,
    targetRef: { kind: 'grammar-pattern', id: `${language}:grammar:${pattern}`, capability: 'grammar-recognition' },
    ...extra,
  });

  it('finds exactly the attempts recorded through the item reference', () => {
    const log: KnowledgeEventLog = {
      [key]: [
        attempt('a1'),
        attempt('a2', { itemRef: { id: 'de-weil-fieber-1', version: 'older' } }),
        attempt('a3', { itemRef: undefined }),
      ],
    };
    const versioned = itemAttemptEvents(log, itemRef);
    expect(versioned.map(({ event }) => event.attemptId)).toEqual(['a1']);
    const anyVersion = itemAttemptEvents(log, { id: itemRef.id, version: '' });
    expect(anyVersion.map(({ event }) => event.attemptId)).toEqual(['a1', 'a2']);
  });

  it('retracts only the item\'s attempts; unrelated history stays untouched', () => {
    const log: KnowledgeEventLog = {
      [key]: [
        attempt('a1'),
        { t: 900, kind: 'rollup', source: 'grammar', aspect: 'grammar', timesSeenDelta: 4 },
        attempt('unrelated-attempt', { itemRef: { id: 'other-item', version: 'v1' }, easeAfter: 1.4 }),
        { t: 800, kind: 'claim', source: 'manual', aspect: 'grammar', toStatus: 'learning' },
      ],
    };
    const tombstones = retractionEventsForItem(log, itemRef);
    expect(Object.keys(tombstones)).toEqual([key]);
    expect(tombstones[key]).toHaveLength(1);
    expect(tombstones[key][0]).toMatchObject({ kind: 'retraction', retracts: 'a1' });

    const active = log[key].concat(tombstones[key]);
    const projection = replayGrammarRecognition(active);
    expect(projection).not.toBeNull();
    // The unrelated rating (ease 1.4) and claim survive; the item's attempt is gone.
    expect(projection?.ease).toBeCloseTo(1.4);
  });

  it('is idempotent: already-retracted attempts produce no new tombstones', () => {
    const log: KnowledgeEventLog = { [key]: [attempt('a1'), { t: 2000, kind: 'retraction', source: 'manual', retracts: 'a1' }] };
    expect(Object.keys(retractionEventsForItem(log, itemRef))).toHaveLength(0);
  });

  it('reconciles a package update: undeclared items retire, declared items and unrelated evidence survive', () => {
    const otherKey = grammarEvidenceKey(language, 'obwohl', 'grammar-recognition');
    const log: KnowledgeEventLog = {
      [key]: [attempt('a1'), attempt('a2', { attemptId: 'a2', itemRef: { id: 'kept-item', version: 'v2' } })],
      [otherKey]: [
        { t: 500, kind: 'rating', source: 'grammar', aspect: 'grammar', attemptId: 'obwohl-1', quality: 'fluent', easeAfter: 1.8 },
      ],
    };
    const result = reconcileQuestionItems(log, declared([['kept-item', 'v2']]));
    expect(result.retiredItemIds).toEqual(new Set([itemRef.id]));
    expect(result.patterns).toEqual(new Set(['weil']));
    expect(Object.keys(result.tombstones)).toEqual([key]);
    expect(result.tombstones[key]).toHaveLength(1);

    // Second run over the reconciled journal: nothing new (idempotent).
    const reconciled: KnowledgeEventLog = { ...log, [key]: [...log[key], ...result.tombstones[key]] };
    const again = reconcileQuestionItems(reconciled, declared([['kept-item', 'v2']]));
    expect(again.retiredItemIds.size).toBe(0);
    expect(Object.keys(again.tombstones)).toHaveLength(0);
    expect(again.alreadyRetracted).toBe(1);

    // The unrelated obwohl projection is untouched by the reconciliation.
    expect(replayGrammarRecognition(log[otherKey])?.ease).toBeCloseTo(1.8);
  });

  it('derives the pattern for re-materialization from non-English keys and the canonical ref', () => {
    const jaKey = grammarEvidenceKey('ja', 'ている', 'grammar-recognition');
    const log: KnowledgeEventLog = {
      [jaKey]: [{
        t: 1,
        kind: 'rating',
        source: 'grammar',
        aspect: 'grammar',
        attemptId: 'ja-1',
        easeAfter: 1.8,
        itemRef: { id: 'ja-retired-1', version: 'ja-package-2026.09.19' },
        targetRef: { kind: 'grammar-pattern', id: 'ja:grammar:ている', capability: 'grammar-recognition' },
      }],
    };
    const result = reconcileQuestionItems(log, new Map());
    expect(result.patterns).toEqual(new Set(['ている']));
  });

  it('retracts attempts whose recorded item content version no longer matches (G03)', () => {
    const currentVersion = itemContentVersion(item());
    const log: KnowledgeEventLog = {
      [key]: [
        attempt('old-content', { itemRef: { id: 'kept-item', version: 'item-v1:aaaaaaaaaaaaaaaa' } }),
        attempt('same-content', { itemRef: { id: 'kept-item', version: currentVersion } }),
      ],
    };
    const result = reconcileQuestionItems(log, declared([['kept-item', currentVersion]]));
    // The unchanged item keeps its attempt; the content-changed one retracts —
    // even though BOTH ids are still declared under the same package version.
    expect(result.tombstones[key]).toHaveLength(1);
    expect(result.tombstones[key][0]).toMatchObject({ retracts: 'old-content' });
    // The item is still declared — only its content changed; it is not "retired".
    expect(result.retiredItemIds).toEqual(new Set());
  });

  it('retracts attempts through items the current package marks invalid, keeps unreviewed ones', () => {
    const currentVersion = itemContentVersion(item());
    const log: KnowledgeEventLog = {
      [key]: [
        attempt('invalid-item', { itemRef: { id: 'invalid-item', version: currentVersion } }),
        attempt('unreviewed-item', { itemRef: { id: 'unreviewed-item', version: currentVersion } }),
      ],
    };
    // An item whose semantic validation REJECTED it is defective; an item
    // whose validation merely never ran is NOT invalidated (honest absence
    // is not a rejection) — its attempts survive until content changes.
    const result = reconcileQuestionItems(log, declared([
      ['invalid-item', currentVersion, true],
      ['unreviewed-item', currentVersion, false],
    ]));
    expect(result.tombstones[key]).toHaveLength(1);
    expect(result.tombstones[key][0]).toMatchObject({ retracts: 'invalid-item' });
  });

  it('a package version bump alone never retracts attempts through unchanged items (G03)', () => {
    const version = itemContentVersion(item());
    const log: KnowledgeEventLog = { [key]: [attempt('a1', { itemRef: { id: 'kept-item', version } })] };
    // The same item content under a NEW package version: states derive from
    // item content, so the attempt survives.
    const result = reconcileQuestionItems(log, declared([['kept-item', version]]));
    expect(Object.keys(result.tombstones)).toHaveLength(0);
  });

  it('a target remap changes the canonical targetRef but not the item content version (R12/G03 rationale)', () => {
    const source = item();
    const before = assembleContrastItem(source, { language: 'de', pattern: 'obwohl' });
    const after = assembleContrastItem(source, { language: 'de', pattern: 'obwohl-test-remap' });
    // Journal attempts bind to item CONTENT (itemRef.version — the same
    // content-stability rule as the package-version-bump guarantee above)
    // and are ADDRESSED by the canonical target ENTITY
    // (grammarEvidenceKey(language, pattern, capability)); that addressing is
    // structural, so a pedagogical remap keeps learner history under the old
    // canonical reference and never cross-attributes evidence (G03: remap
    // through canonical references; G04: never silently delete learner
    // knowledge). This test pins the assembly-identity half; the record
    // side — a remapped item returns to unreviewed until an actual validator
    // re-executes — is asserted in questionValidation.test.ts. Whether
    // target-aware journal reconcile should ADDITIONALLY retire
    // orphaned-target attempts is an open design question for review.
    expect(after.version).toBe(before.version);
    expect(after.targetRef.id).not.toBe(before.targetRef.id);
  });

  it('counts item attempts for serving familiarity, excluding retracted ones (G02)', () => {
    const log: KnowledgeEventLog = {
      [key]: [
        attempt('a1', { itemRef: { id: 'item-a', version: 'v1' } }),
        attempt('a2', { itemRef: { id: 'item-a', version: 'v1' } }),
        attempt('retracted', { itemRef: { id: 'item-b', version: 'v1' } }),
        { t: 2000, kind: 'retraction', source: 'manual', retracts: 'retracted' },
        attempt('a3', { itemRef: undefined }),
      ],
    };
    expect(itemAttemptCounts(log).get('item-a')).toBe(2);
    expect(itemAttemptCounts(log).get('item-b')).toBeUndefined();
    expect(itemAttemptCounts(log).get('de-weil-fieber-1')).toBeUndefined();
  });
});

describe('vocabulary control (R12 difficulty input, honest scope)', () => {
  it('checks latin tokens against a package level lookup and reports the rest uncontrolled', () => {
    const result = checkVocabularyControl('Ich bleibe heute im Bett, weil ich Fieber habe.', {
      maxLevel: 3,
      levelOf: (token) => ({ ich: 1, bleibe: 2, heute: 1, im: 1, bett: 1, fieber: 3, habe: 1, weil: 1 }[token.toLowerCase()]),
    });
    expect(result.aboveMax).toEqual([]);
    expect(result.uncontrolled).toEqual([]);
    expect(result.checked.map(({ token }) => token).sort()).toEqual(['Bett', 'Fieber', 'Ich', 'bleibe', 'habe', 'heute', 'im', 'weil']);
  });

  it('reports above-max tokens and never guesses CJK segmentation', () => {
    const result = checkVocabularyControl('Wir gehen spazieren, obwohl es 他昨天 regnet.', {
      maxLevel: 2,
      levelOf: (token) => ({ wir: 1, gehen: 1, spazieren: 2, es: 1, regnet: 3, obwohl: 1 }[token.toLowerCase()]),
    });
    expect(result.aboveMax).toEqual(['regnet']);
    expect(result.uncontrolled).toEqual(['他昨天']);
  });
});

// ---------------------------------------------------------------------------
// Real package content (bounded, honest): every item declared by the shipped
// de/ja/zh packages must pass whole-item validation. Counts are asserted as
// LOWER BOUNDS — the packages are explicitly not claimed to be exhaustive
// banks (R04/R12).
// ---------------------------------------------------------------------------

const repoRoot = path.join(__dirname, '..', '..', '..');
const packagePath = (language: string): string =>
  path.join(repoRoot, 'scripts', 'language-data', 'source', 'root-of-app', 'languages', `${language}.json`);

const PACKAGES: Record<string, LanguageData> = {
  de: JSON.parse(fs.readFileSync(packagePath('de'), 'utf8')) as LanguageData,
  ja: JSON.parse(fs.readFileSync(packagePath('ja'), 'utf8')) as LanguageData,
  zh: JSON.parse(fs.readFileSync(packagePath('zh'), 'utf8')) as LanguageData,
};

const GERMAN_FREQ = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'scripts', 'language-data', 'source', 'root-of-app', 'languages', 'de.freq.json'),
  'utf8',
)) as { freq: unknown };

describe('real DE/JA/ZH package item banks', () => {
  it('declares at least two items per targeted construction (G02 serving alternation)', () => {
    const minimums: Record<string, number> = { de: 6, ja: 2, zh: 6 };
    for (const [language, data] of Object.entries(PACKAGES)) {
      const bank = questionBankFromLanguageData(language, data);
      const byPattern = [...bank.itemsByPattern.values()];
      for (const [pattern, items] of bank.itemsByPattern) {
        expect(items.length, `${language} ${pattern} items`).toBeGreaterThanOrEqual(2);
      }
      expect(byPattern.flat().length, `${language} item count`).toBeGreaterThanOrEqual(minimums[language]);
    }
  });

  it('declares at least one contrast item per first-class pilot language', () => {
    const minimums: Record<string, number> = { de: 3, ja: 1, zh: 3 };
    for (const [language, data] of Object.entries(PACKAGES)) {
      const bank = questionBankFromLanguageData(language, data);
      const items = [...bank.itemsByPattern.values()].flat();
      expect(items.length, `${language} item count`).toBeGreaterThanOrEqual(minimums[language]);
      for (const source of items) {
        expect(source.id, `${language} item id`).toMatch(new RegExp(`^${language}-`));
        expect(source.distractors.length, `${language} ${source.id} distractors`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('validates every shipped item as a complete assembled question and reports the honest delivery state', () => {
    for (const [language, data] of Object.entries(PACKAGES)) {
      const bank = questionBankFromLanguageData(language, data);
      const result = assembleQuestionBatch(bank);
      const declaredCount = [...bank.itemsByPattern.values()].flat().length;
      // No silent losses: declared items are delivered, reported rejected, or
      // reported pending — never dropped.
      expect(result.items.length + result.rejected.length + result.pending.length, `${language} coverage`).toBe(declaredCount);
      expect(result.rejected, `${language} rejections`).toEqual([]);
      // Real packages ship WITHOUT semantic records until an authorized
      // independent validator actually runs — every item is honestly
      // unreviewed (named external dependency; never fabricated, R12).
      expect(result.pending, `${language} unreviewed items`).toEqual(
        expect.arrayContaining(result.pending.map(({ id }) => expect.objectContaining({ id, reason: 'unreviewed' }))),
      );
      expect(result.pending.every(({ reason }) => reason === 'unreviewed')).toBe(true);
      // Whole-item deterministic validation still covers every declared item.
      for (const sources of bank.itemsByPattern.values()) {
        for (const source of sources) {
          const item = assembleContrastItem(source, { language, pattern: '', contentVersion: data.languageData?.version });
          expect(item.validation.deterministic.status, `${language} ${source.id}`).toBe('passed');
          expect(item.provenance.contentVersion, `${language} content version`).toBe(data.languageData?.version);
          expect(item.options.length).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('serves a reviewed item through the strict gate: a bound semantic record makes it deliverable', () => {
    // A REVIEWED variant of one real package item — the record here is a
    // fixture stand-in for an actually-executed independent validation (the
    // app never fabricates one; R12). It proves the full pipeline: assembly →
    // strict gate → batch delivery.
    for (const [language, data] of Object.entries(PACKAGES)) {
      const bank = questionBankFromLanguageData(language, data);
      const [source] = [...bank.itemsByPattern.values()][0];
      const reviewedSource: GrammarPracticeItemSource = {
        ...source,
        validation: { semantic: semanticRecord(source) },
      };
      const reviewedBank = questionBankFromLanguageData(language, {
        ...data,
        grammar: [{ pattern: [...bank.itemsByPattern.keys()][0], items: [reviewedSource] }],
      });
      const result = assembleQuestionBatch(reviewedBank, 8);
      expect(result.items, `${language} reviewed delivery`).toHaveLength(1);
      expect(result.items[0].validation.semantic?.validator).toBe('fixture-independent-validator@1');
      expect(result.pending).toEqual([]);
    }
  });

  it('keeps the shipped German contexts inside the B1 vocabulary band (R12 controlled difficulty)', () => {
    const germanWithFreq = { ...PACKAGES.de, freq: GERMAN_FREQ.freq } as unknown as LanguageData;
    const frequency = buildWordFrequencyMapFromLanguageData(germanWithFreq);
    expect(Object.keys(frequency).length, 'real German frequency payload resolved').toBeGreaterThan(1000);
    const levelOf = (token: string): number | undefined => frequency[token.toLowerCase()]?.raw_level;
    const bank = questionBankFromLanguageData('de', PACKAGES.de);
    for (const [pattern, sources] of bank.itemsByPattern) {
      for (const source of sources) {
        const control = checkVocabularyControl(source.context, { maxLevel: 3, levelOf });
        expect(control.aboveMax, `${source.id} (${pattern}) above B1`).toEqual([]);
        // Honest reporting: tokens the German frequency list does not cover are
        // recorded, not hidden.
        expect(control.uncontrolled, `${source.id} uncontrolled tokens`).toEqual([]);
      }
    }
  });

  it('documents the CJK honesty boundary: Japanese/Chinese contexts are author-controlled, not machine-controlled', () => {
    const jaBank = questionBankFromLanguageData('ja', PACKAGES.ja);
    for (const sources of jaBank.itemsByPattern.values()) {
      for (const source of sources) {
        const control = checkVocabularyControl(source.context, { maxLevel: 3, levelOf: () => undefined });
        expect(control.uncontrolled.length, `${source.id} CJK tokens reported uncontrolled`).toBeGreaterThan(0);
      }
    }
  });
});
