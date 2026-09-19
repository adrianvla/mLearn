import { createSeededRng } from './teachingPolicy';
import { grammarEntityId } from '../../shared/graph/load';
import {
  collectRetractedAttemptIds,
  stripRetractions,
  type AttemptScaffolds,
  type KnowledgeEvent,
  type KnowledgeEventLog,
} from '../../shared/knowledgeEvents';
import type { GrammarItemSemanticValidation, GrammarPracticeItemSource } from '../../shared/types';

/**
 * Validated question pipeline (R12) — pure core.
 *
 * Target-first flow over package-declared, mLearn-authored item sources
 * (original context + answer span + contrast bank): assemble a complete
 * item (span removed, alternatives assembled in a reproducible seeded
 * order), validate the COMPLETE assembled item independently of the
 * author's intent, grade answers, and bookkeep item-level invalidation.
 *
 * Generation is off the fast interaction path by construction: assembly is
 * deterministic and cached; there is no LLM call anywhere in this module
 * (an independent semantic validator is an optional external dependency —
 * its result is recorded only when an actual validator ran; it is never
 * fabricated here, R12/DECISIONS).
 *
 * The answering surface never sees the gold answer: `QuestionItem` carries
 * options without correctness flags (G02). Grading re-derives the gold from
 * the item source at submit time.
 *
 * Delivery is STRICTLY gated (R12/DECISIONS D-W05): deterministic
 * whole-item validation is the always-on consistency tier, but an item is
 * deliverable ONLY when an independent semantic validation actually
 * executed and passed it (bound to the current item content). Deterministic
 * consistency alone can never substitute — the deterministic tier cannot
 * judge naturalness, the legitimate answer set or whether the gold is
 * correct, and serving unreviewed items as established discrimination
 * would fabricate confidence. Real package items ship without records and
 * stay undeliverable until an authorized validator runs (named external
 * dependency, never fabricated).
 */

export const QUESTION_ITEM_SCHEMA_VERSION = 'question-item@1';

/** Algorithm tag of the item content version (change-detection hash, not a security hash). */
export const ITEM_CONTENT_VERSION_PREFIX = 'item-v3';

/** Bounded batch size (R17): one batch never assembles an unbounded bank. */
export const QUESTION_BATCH_LIMIT = 64;

/** Minimum options for a meaningful discrimination question. */
export const QUESTION_MIN_OPTIONS = 3;
/** Hard option ceiling — keeps the answering surface compact. */
export const QUESTION_MAX_OPTIONS = 8;

export interface QuestionTargetRef {
  kind: 'grammar-pattern';
  /** Canonical grammar entity id (graph identity, not a surface proxy). */
  id: string;
  capability: 'grammar-recognition';
}

export interface QuestionOption {
  text: string;
}

/**
 * A fully assembled, delivered question. Carries NO gold flag: the
 * answering surface renders options only, and grading consults the item
 * source (G02 assessment contamination rule).
 */
export interface QuestionItem {
  schemaVersion: typeof QUESTION_ITEM_SCHEMA_VERSION;
  /** Package-unique item id (never repurposed, G03). */
  id: string;
  /**
   * Item content version: a change-detection hash of the grading-relevant
   * content (`item-v3:<hex>`). Changes whenever the answer span, conditions,
   * distractors, accepted answers, register, declared formats or id change — independent of the package
   * version. Journal `itemRef.version` stores this, so item reconcile
   * retracts attempts recorded under changed content (G03) while package
   * bumps alone never retract unchanged items.
   */
  version: string;
  language: string;
  /** Targeted construction (package grammar pattern). */
  pattern: string;
  targetRef: QuestionTargetRef;
  taskTemplateId: 'contrast-mcq';
  /** Context with the answer span removed. */
  prompt: string;
  /** Removed span bounds within `prompt` (prompt.slice(start, end) === ''). */
  gap: { start: number; end: number };
  /** Options in seeded order; exactly the answer span plus its distractors. */
  options: readonly QuestionOption[];
  /** Reproducible assembly seed (same seed ⇒ same option order). */
  seed: number;
  /** Content provenance (G03): mLearn-authored practice material. */
  provenance: { source: 'mlearn-authored'; contentVersion?: string };
  validation: QuestionValidationRecord;
}

export interface QuestionValidationRecord {
  /**
   * Deterministic whole-item validation, always recorded: re-derives
   * validity from the source and the assembled item (span occurrence,
   * distractor distinctness, declared-condition consistency, no accidental
   * clue, option set, seed reproducibility) — independent of which option
   * the author intended as gold.
   */
  deterministic: { status: 'passed' | 'rejected'; reasons: readonly string[] };
  /**
   * Independent semantic validation. Written ONLY from an actually
   * executed external validator (model/teacher); absent means honestly
   * absent (a named external dependency — never fabricated, R12).
   */
  semantic?: QuestionSemanticValidation;
}

/** An actually-executed independent semantic validation (shared shape, G03). */
export type QuestionSemanticValidation = GrammarItemSemanticValidation;

/**
 * The journal-side provenance reference of an attempt recorded through an
 * item (KnowledgeEvent.itemRef). Invalidation retracts by this reference.
 */
export interface QuestionItemRef {
  id: string;
  version: string;
  seed?: number;
}

/** Package view of one language's declared item sources (G03 bank). */
export interface LanguageQuestionBank {
  language: string;
  contentVersion?: string;
  /** Active item sources per pattern, in package order. */
  itemsByPattern: ReadonlyMap<string, readonly GrammarPracticeItemSource[]>;
}
const nfc = (value: string): string => value.normalize('NFC');

/** Stable FNV-1a 32-bit seed derivation from identity + content version. */
function stableSeed(...parts: readonly string[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const normalized = nfc(part);
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
  }
  return hash >>> 0;
}

/** FNV-1a over two independent 32-bit lanes → 16 hex chars (change detection only). */
function fnv64(text: string): string {
  let hi = 0x811c9dc5;
  let lo = 0x01578629;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hi = Math.imul(hi ^ code, 0x01000193) >>> 0;
    lo = Math.imul(lo ^ code, 0x85ebca6b) >>> 0;
  }
  return `${(hi >>> 0).toString(16).padStart(8, '0')}${(lo >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * The item content version: a stable hash over the grading-relevant content
 * (id, context, span, conditions, distractors, accepted answers, register, declared
 * formats). NOT a
 * security hash — a collision-detecting digest is not needed for
 * change-detection and versioning (R12 versioning, G03 reconcile), and the
 * pure sync core must not depend on async WebCrypto.
 */
export function itemContentVersion(source: GrammarPracticeItemSource): string {
  const canonical = JSON.stringify({
    id: nfc(source.id),
    context: nfc(source.context),
    answerSpan: nfc(source.answerSpan),
    conditions: source.conditions.map(nfc),
    distractors: source.distractors.map((distractor) => ({
      span: nfc(distractor.span),
      violates: distractor.violates.map(nfc),
      rationale: nfc(distractor.rationale),
    })),
    accepts: (source.accepts ?? []).map(nfc),
    register: source.register === undefined ? null : nfc(source.register),
    formats: source.formats === undefined ? null : source.formats.map(nfc),
  });
  return `${ITEM_CONTENT_VERSION_PREFIX}:${fnv64(canonical)}`;
}

/**
 * Assembles one complete item from a package item source. Deterministic:
 * the same (source, language, contentVersion, seed) always yields the same
 * item, including option order. The deterministic validation record is
 * attached here; deliverability must check `validation.deterministic`.
 */
export function assembleContrastItem(
  source: GrammarPracticeItemSource,
  options: { language: string; pattern: string; contentVersion?: string; seed?: number },
): QuestionItem {
  const { language, pattern } = options;
  const contentVersion = options.contentVersion ?? '';
  const version = itemContentVersion(source);
  const seed = options.seed ?? stableSeed(language, source.id, contentVersion);
  const context = nfc(source.context);
  const span = nfc(source.answerSpan);

  // Span removal: exactly the first (validated unique) occurrence.
  const spanIndex = context.indexOf(span);
  const prompt = spanIndex >= 0 ? context.slice(0, spanIndex) + context.slice(spanIndex + span.length) : context;

  // Seeded option order: gold + distractors, Fisher-Yates with the
  // assembly seed. Reproducible, and the gold position is derived from the
  // seed rather than fixed by the author's presentation.
  const optionTexts = [span, ...source.distractors.map((distractor) => nfc(distractor.span))];
  const rng = createSeededRng(seed);
  for (let index = optionTexts.length - 1; index > 0; index -= 1) {
    const draw = rng();
    const swap = Math.floor(draw * (index + 1));
    [optionTexts[index], optionTexts[swap]] = [optionTexts[swap], optionTexts[index]];
  }

  const item: QuestionItem = {
    schemaVersion: QUESTION_ITEM_SCHEMA_VERSION,
    id: source.id,
    version,
    language,
    pattern,
    targetRef: {
      kind: 'grammar-pattern',
      id: grammarEntityId(language, pattern),
      capability: 'grammar-recognition',
    },
    taskTemplateId: 'contrast-mcq',
    prompt,
    gap: { start: spanIndex, end: spanIndex },
    options: optionTexts.map((text) => ({ text })),
    seed,
    provenance: {
      source: 'mlearn-authored',
      ...(options.contentVersion !== undefined ? { contentVersion: options.contentVersion } : {}),
    },
    validation: { deterministic: { status: 'passed', reasons: [] } },
  };
  // A package-declared semantic record applies ONLY when it binds to the
  // current item content; a stale record (content changed after validation)
  // is never applied — the item is unreviewed again, never half-validated.
  const declaredSemantic = source.validation?.semantic;
  const semantic = declaredSemantic !== undefined && declaredSemantic.contentHash === version
    ? declaredSemantic
    : undefined;
  item.validation = {
    deterministic: validateAssembledItem(item, source),
    ...(semantic !== undefined ? { semantic } : {}),
  };
  return item;
}

/**
 * Independent whole-item validation (R12): validates the COMPLETE assembled
 * item against the package source. It re-derives every property instead of
 * trusting the assembly — including the declared-condition consistency that
 * rules out ambiguous MCQs (a distractor violating no declared condition is
 * indistinguishable from the gold under the declared task and is rejected).
 */
export function validateAssembledItem(
  item: QuestionItem,
  source: GrammarPracticeItemSource,
): { status: 'passed' | 'rejected'; reasons: readonly string[] } {
  const reasons: string[] = [];
  const span = nfc(source.answerSpan);
  const context = nfc(source.context);

  if (item.schemaVersion !== QUESTION_ITEM_SCHEMA_VERSION) reasons.push(`unknown schema version ${item.schemaVersion}`);
  if (item.language.length === 0) reasons.push('missing language');
  if (item.id !== source.id) reasons.push(`item id mismatch: ${item.id} ≠ ${source.id}`);
  if (item.taskTemplateId !== 'contrast-mcq') reasons.push(`unexpected task template ${item.taskTemplateId}`);

  // The answer span must occur verbatim (NFC) exactly once in the context;
  // removing that occurrence must reconstruct the delivered prompt byte for
  // byte, and the gap must be empty.
  const occurrences = countOccurrences(context, span);
  if (span.length === 0) reasons.push('empty answer span');
  if (occurrences !== 1) reasons.push(`answer span occurs ${occurrences}× in context, expected exactly once`);
  if (item.gap.end < item.gap.start || item.gap.start < 0 || item.gap.start > item.prompt.length) {
    reasons.push('gap bounds out of prompt range');
  } else if (item.prompt.slice(item.gap.start, item.gap.end) !== '') {
    reasons.push('gap range is not empty');
  } else {
    const reconstructed = item.prompt.slice(0, item.gap.start) + span + item.prompt.slice(item.gap.end);
    if (reconstructed !== context) reasons.push('gap does not reconstruct the declared context');
  }

  // Declared task conditions (R05): non-empty; every distractor must
  // violate at least one — otherwise it is a valid alternative under the
  // declared task and the item is ambiguous.
  if (source.conditions.length === 0) reasons.push('no declared task conditions');
  const distractorSpans: string[] = [];
  source.distractors.forEach((distractor, index) => {
    const distractorSpan = nfc(distractor.span);
    distractorSpans.push(distractorSpan);
    if (distractorSpan.length === 0) reasons.push(`distractor ${index}: empty span`);
    if (distractor.violates.length === 0) {
      reasons.push(`distractor "${distractorSpan}": violates nothing — ambiguous with the answer`);
    } else if (!distractor.violates.some((condition) => source.conditions.includes(condition))) {
      reasons.push(
        `distractor "${distractorSpan}" violates no declared condition (${distractor.violates.join(', ')}) — ambiguous`,
      );
    }
    if (!distractor.rationale.trim()) reasons.push(`distractor "${distractorSpan}": missing rationale`);
  });

  // Distinctness: gold vs distractors and pairwise distractors.
  const all = [span, ...distractorSpans];
  if (new Set(all).size !== all.length) reasons.push('duplicate option spans');

  // Accidental clue: no distractor may occur verbatim in the delivered
  // prompt (the removed span's context must not reveal another option).
  for (const distractorSpan of distractorSpans) {
    if (distractorSpan.length > 0 && item.prompt.includes(distractorSpan)) {
      reasons.push(`distractor "${distractorSpan}" appears in the delivered prompt (accidental clue)`);
    }
  }

  // Delivered option set must be exactly {gold} ∪ distractors, within
  // bounds, with no duplicates.
  const optionTexts = item.options.map((option) => nfc(option.text));
  if (item.options.length < QUESTION_MIN_OPTIONS) reasons.push(`only ${item.options.length} options`);
  if (item.options.length > QUESTION_MAX_OPTIONS) reasons.push(`${item.options.length} options exceeds the cap`);
  if (new Set(optionTexts).size !== optionTexts.length) reasons.push('duplicate delivered options');
  if (!sameSet(optionTexts, all)) reasons.push('delivered options do not match the declared alternatives');

  // Reproducibility: reassembling with the same seed must reproduce the
  // delivered option order exactly.
  const reassembled = assembleOptionOrder(all, item.seed);
  if (!sameSequence(optionTexts, reassembled)) reasons.push('option order is not reproducible from the recorded seed');

  // Item identity: the assembled version must be the derived content version.
  if (item.version !== itemContentVersion(source)) reasons.push('item version is not the derived content version');

  // A semantic record, when present, must bind to the current content and
  // carry provenance; anything else is treated as honestly absent downstream
  // but is flagged here so a mis-copied record can never ride silently.
  const semantic = item.validation.semantic;
  if (semantic !== undefined) {
    if (semantic.contentHash !== item.version) {
      reasons.push('semantic validation record does not bind to the current item content');
    }
    if (semantic.validator.trim().length === 0) reasons.push('semantic validation record has no validator identity');
    if (semantic.at.length === 0) reasons.push('semantic validation record has no execution timestamp');
  }

  return reasons.length === 0 ? { status: 'passed', reasons: [] } : { status: 'rejected', reasons };
}

/**
 * STRICT deliverability (R12/DECISIONS D-W05): deterministic consistency is
 * necessary but never sufficient. An item is deliverable only when an
 * independent semantic validation ACTUALLY executed, passed it, carries
 * provenance (validator identity + execution timestamp) and binds to the
 * current item content. Deterministic validation cannot judge naturalness,
 * the legitimate answer set or gold correctness — serving unreviewed items
 * would fabricate confidence, so absent means undeliverable, honestly.
 */
export function isDeliverableItem(item: QuestionItem): boolean {
  if (item.validation.deterministic.status !== 'passed') return false;
  const semantic = item.validation.semantic;
  if (semantic === undefined) return false;
  return semantic.status === 'passed'
    && semantic.validator.trim().length > 0
    && semantic.at.length > 0
    && semantic.contentHash === item.version;
}

/**
 * A currently INVALID item (explicitly defective, not merely unreviewed):
 * deterministically rejected, or semantically REJECTED by a validator.
 * Unreviewed items are not invalidated — reconcile never retracts attempts
 * merely because validation has not run yet.
 */
export function isInvalidatedItem(item: QuestionItem): boolean {
  return item.validation.deterministic.status === 'rejected' || item.validation.semantic?.status === 'rejected';
}

/** Why an item is currently not deliverable (honest batch reporting). */
export type UndeliverableReason = 'unreviewed' | 'semantic-rejected' | 'stale-record' | 'missing-provenance';

export function undeliverableReason(item: QuestionItem): UndeliverableReason {
  const semantic = item.validation.semantic;
  if (semantic === undefined) return 'unreviewed';
  if (semantic.status === 'rejected') return 'semantic-rejected';
  if (semantic.contentHash !== item.version) return 'stale-record';
  return 'missing-provenance';
}

export interface AnswerContext {
  kind: 'mcq';
  /** Index into the delivered item's options (the surface never knows gold). */
  index: number;
}

export interface TypedAnswerContext {
  kind: 'typed';
  value: string;
  /** What produced the final string (G05): input-device provenance, never an error. */
  suppliedBy?: 'keyboard' | 'ime' | 'speech';
}

export interface GradeResult {
  correct: boolean;
  goldSpan: string;
  chosenSpan?: string;
  /** Presentation provenance for the attempt writer (G05), when the input device supplied text. */
  scaffolds?: AttemptScaffolds;
}

/** Grades an MCQ selection against the item source (submit-time gold re-derivation). */
export function gradeContrastAnswer(
  item: QuestionItem,
  source: GrammarPracticeItemSource,
  answer: AnswerContext | TypedAnswerContext,
): GradeResult {
  const goldSpan = nfc(source.answerSpan);
  if (answer.kind === 'mcq') {
    const chosen = item.options[answer.index];
    const chosenSpan = chosen === undefined ? undefined : nfc(chosen.text);
    return { correct: chosenSpan === goldSpan, goldSpan, ...(chosenSpan !== undefined ? { chosenSpan } : {}) };
  }
  // Typed grading: NFC + trim against the declared span and the declared
  // accepted alternatives. Never exact-string-only (R12); never fuzzy — an
  // undeclared variant is simply wrong.
  const normalized = nfc(answer.value.trim());
  const accepted = [goldSpan, ...(source.accepts ?? []).map(nfc)];
  const correct = accepted.includes(normalized);
  const scaffolds = answer.suppliedBy === 'ime'
    ? { 'ime-composition': true }
    : answer.suppliedBy === 'speech'
      ? { 'asr-transcription': true }
      : undefined;
  return { correct, goldSpan, chosenSpan: normalized, ...(scaffolds !== undefined ? { scaffolds } : {}) };
}

// ---------------------------------------------------------------------------
// Batch + cache (off the fast path, R12/R17)
// ---------------------------------------------------------------------------

export interface QuestionBatchResult {
  /** Deliverable items only (strict gate: semantic-validated, bound, provenant). */
  items: readonly QuestionItem[];
  rejected: ReadonlyArray<{ id: string; reasons: readonly string[] }>;
  /** Deterministically valid but not deliverable, with the honest reason (never silently dropped). */
  pending: ReadonlyArray<{ id: string; reason: UndeliverableReason }>;
  /** Sources skipped for shape reasons (wrong language / missing pattern), counted not dropped silently. */
  skipped: number;
}

/**
 * Assembles a bounded batch of deliverable items. Batch assembly is an
 * infrastructure step (G02/R12): callers run it once per bank/version —
 * never inside a rating interaction — and serve attempts from the cache.
 */
export function assembleQuestionBatch(
  bank: LanguageQuestionBank,
  limit: number = QUESTION_BATCH_LIMIT,
): QuestionBatchResult {
  const boundedLimit = Math.max(0, Math.floor(limit));
  const items: QuestionItem[] = [];
  const rejected: Array<{ id: string; reasons: readonly string[] }> = [];
  const pending: Array<{ id: string; reason: UndeliverableReason }> = [];
  let skipped = 0;
  for (const [pattern, sources] of bank.itemsByPattern) {
    for (const source of sources) {
      // Bounded batch: once the deliverable capacity is reached, the batch
      // reports what it contains (sources beyond it are not assembled).
      if (items.length >= boundedLimit) return { items, rejected, pending, skipped };
      if (bank.language.length === 0) { skipped += 1; continue; }
      const item = assembleContrastItem(source, {
        language: bank.language,
        pattern,
        contentVersion: bank.contentVersion,
      });
      if (item.validation.deterministic.status !== 'passed') {
        rejected.push({ id: source.id, reasons: item.validation.deterministic.reasons });
        continue;
      }
      if (isDeliverableItem(item)) items.push(item);
      else pending.push({ id: source.id, reason: undeliverableReason(item) });
    }
  }
  return { items, rejected, pending, skipped };
}

/**
 * Deterministic LRU cache over assembled items, keyed by
 * (language, item id, content version). The rating path only reads from
 * this cache; assembly runs at bank build/batch time — off the fast path.
 * Cache invalidation is explicit (version/language change or manual).
 */
export class QuestionBankCache {
  private readonly entries = new Map<string, QuestionItem>();
  constructor(private readonly capacity: number = 256) {}

  getOrAssemble(
    source: GrammarPracticeItemSource,
    options: { language: string; pattern: string; contentVersion?: string },
  ): QuestionItem {
    // Keyed by language, id, package version, item content version AND the
    // declared validation state: two packages that share item ids must never
    // serve each other's assemblies, and a content or validation change
    // re-assembles even within one package.
    const semantic = source.validation?.semantic;
    const validationKey = semantic === undefined
      ? 'unreviewed'
      : `${semantic.status}:${semantic.contentHash}:${semantic.validator}:${semantic.validatorVersion ?? ''}:${semantic.at}`;
    const key = `${options.language}\u0000${source.id}\u0000${options.contentVersion ?? ''}\u0000${itemContentVersion(source)}\u0000${validationKey}`;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const item = assembleContrastItem(source, options);
    this.entries.set(key, item);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return item;
  }

  /** Drops cached items, optionally scoped to one language/content version. */
  invalidate(predicate?: (item: QuestionItem) => boolean): void {
    if (!predicate) {
      this.entries.clear();
      return;
    }
    for (const [key, item] of this.entries) {
      if (predicate(item)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

// ---------------------------------------------------------------------------
// Item lifecycle: invalidation / retraction (G03)
// ---------------------------------------------------------------------------

export function questionBankFromLanguageData(
  language: string,
  languageData: {
    grammar?: ReadonlyArray<{ pattern?: string; items?: readonly GrammarPracticeItemSource[] }>;
    languageData?: { version?: string };
  },
): LanguageQuestionBank {
  const itemsByPattern = new Map<string, GrammarPracticeItemSource[]>();
  for (const point of languageData.grammar ?? []) {
    if (typeof point.pattern !== 'string') continue;
    for (const source of point.items ?? []) {
      const list = itemsByPattern.get(point.pattern) ?? [];
      list.push(source);
      itemsByPattern.set(point.pattern, list);
    }
  }
  return {
    language,
    ...(languageData.languageData?.version !== undefined ? { contentVersion: languageData.languageData.version } : {}),
    itemsByPattern,
  };
}

/** Item sources declared for one pattern (package order). */
export function itemsForPattern(bank: LanguageQuestionBank, pattern: string): readonly GrammarPracticeItemSource[] {
  return bank.itemsByPattern.get(pattern) ?? [];
}

/**
 * Attempts recorded through an item reference: raw-log scan (retractions
 * and tombstones included) so invalidation sees exactly what it must undo.
 */
export function itemAttemptEvents(
  log: KnowledgeEventLog,
  ref: QuestionItemRef,
): ReadonlyArray<{ key: string; event: KnowledgeEvent }> {
  const matches: Array<{ key: string; event: KnowledgeEvent }> = [];
  for (const [key, events] of Object.entries(log)) {
    for (const event of events) {
      if (event.itemRef === undefined) continue;
      if (event.itemRef.id !== ref.id) continue;
      if (ref.version.length > 0 && event.itemRef.version !== ref.version) continue;
      matches.push({ key, event });
    }
  }
  return matches;
}

/**
 * Attempts per item id (retracted attempts excluded — undone observations
 * are not familiarity history). Bounded: only itemRef-bearing rows count.
 * Used to distinguish repeated-item familiarity in serving (G02).
 */
export function itemAttemptCounts(log: KnowledgeEventLog): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const events of Object.values(log)) {
    for (const event of stripRetractions(events)) {
      if (event.itemRef === undefined) continue;
      counts.set(event.itemRef.id, (counts.get(event.itemRef.id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Retraction tombstones for every attempt recorded through an item
 * reference. Appending these recomputes all projections (stripRetractions)
 * without deleting unrelated history — the raw journal stays append-only
 * (G03/R12). Attempts already retracted are skipped (idempotent).
 */
export function retractionEventsForItem(log: KnowledgeEventLog, ref: QuestionItemRef): KnowledgeEventLog {
  const tombstones: KnowledgeEventLog = {};
  const matches = itemAttemptEvents(log, ref);
  if (matches.length === 0) return tombstones;
  const retracted = new Set<string>();
  for (const events of Object.values(log)) {
    for (const id of collectRetractedAttemptIds(events)) retracted.add(id);
  }
  const now = Date.now();
  for (const { key, event } of matches) {
    if (event.attemptId === undefined) continue;
    if (retracted.has(`${event.attemptId}`)) continue;
    (tombstones[key] ??= []).push({
      t: now,
      kind: 'retraction',
      source: 'manual',
      retracts: event.attemptId,
      origin: 'item-invalidation',
    });
  }
  return tombstones;
}

export interface DeclaredItemState {
  /** Item content version the CURRENT package carries (`item-v3:` hash). */
  version: string;
  /** True when the item is currently defective (deterministically or semantically rejected). */
  invalid: boolean;
}

/** Per-item reconcile state for the CURRENT package (G03). */
export function declaredItemStates(bank: LanguageQuestionBank): ReadonlyMap<string, DeclaredItemState> {
  const states = new Map<string, DeclaredItemState>();
  for (const [pattern, sources] of bank.itemsByPattern) {
    for (const source of sources) {
      const item = assembleContrastItem(source, {
        language: bank.language,
        pattern,
        contentVersion: bank.contentVersion,
      });
      states.set(source.id, { version: item.version, invalid: isInvalidatedItem(item) });
    }
  }
  return states;
}

export interface ItemReconcileResult {
  /** Tombstones to append (empty when nothing to reconcile). */
  tombstones: KnowledgeEventLog;
  /** Patterns whose keys gained tombstones (for projection re-materialization). */
  patterns: ReadonlySet<string>;
  /** Attempts found already retracted (idempotent re-runs). */
  alreadyRetracted: number;
  /** Retired item ids that had recorded attempts. */
  retiredItemIds: ReadonlySet<string>;
}

/**
 * Package-update invalidation (G03): computes tombstones for attempts whose
 * item (a) is no longer declared, (b) carries an itemRef version different
 * from the current content version (answer span/conditions/distractors/
 * accepts/id changed — grading rules or content), or (c) is currently
 * INVALID (deterministically or semantically rejected). Unreviewed
 * still-declared items keep their attempts (absence of validation is not an
 * invalidation signal); unrelated history is never scanned for deletion —
 * only itemRef-bearing rows are considered.
 */
export function reconcileQuestionItems(log: KnowledgeEventLog, declaredItems: ReadonlyMap<string, DeclaredItemState>): ItemReconcileResult {
  const tombstones: KnowledgeEventLog = {};
  const patterns = new Set<string>();
  const retiredItemIds = new Set<string>();
  const retracted = new Set<string>();
  for (const events of Object.values(log)) {
    for (const id of collectRetractedAttemptIds(events)) retracted.add(id);
  }
  let alreadyRetracted = 0;
  const now = Date.now();
  for (const [key, events] of Object.entries(log)) {
    for (const event of events) {
      if (event.itemRef === undefined || event.attemptId === undefined) continue;
      const declared = declaredItems.get(event.itemRef.id);
      if (declared !== undefined && declared.version === event.itemRef.version && !declared.invalid) continue;
      if (retracted.has(`${event.attemptId}`)) {
        alreadyRetracted += 1;
        continue;
      }
      (tombstones[key] ??= []).push({
        t: now,
        kind: 'retraction',
        source: 'manual',
        retracts: event.attemptId,
        origin: 'item-invalidation',
      });
      if (declared === undefined) retiredItemIds.add(event.itemRef.id);
      const pattern = grammarPatternFromEvent(event, key);
      if (pattern !== '') patterns.add(pattern);
    }
  }
  return { tombstones, patterns, alreadyRetracted, retiredItemIds };
}

// ---------------------------------------------------------------------------
// Optional vocabulary control (R12 difficulty input; honest scope)
// ---------------------------------------------------------------------------

export interface VocabularyControl {
  /** Package frequency scale maximum allowed for context tokens. */
  maxLevel: number;
  /** Token → package level; undefined = unknown (reported, not failed). */
  levelOf: (token: string) => number | undefined;
}

export interface VocabularyControlResult {
  /** Latin-script tokens checked against the package scale. */
  checked: ReadonlyArray<{ token: string; level: number }>;
  /** Tokens above the declared maximum. */
  aboveMax: ReadonlyArray<string>;
  /** Tokens with no package level recorded (honestly uncontrolled). */
  uncontrolled: ReadonlyArray<string>;
}

/**
 * Difficulty control over an item's context: checks LATIN-script tokens
 * against a package frequency lookup. CJK contexts are reported as
 * uncontrolled rather than pretending a segmentation exists (honest
 * limitation — controlled CJK vocabulary is an authoring responsibility
 * recorded in the item's register note, not a machine guarantee here).
 */
export function checkVocabularyControl(context: string, control: VocabularyControl): VocabularyControlResult {
  const checked: Array<{ token: string; level: number }> = [];
  const aboveMax: string[] = [];
  const uncontrolled: string[] = [];
  const seen = new Set<string>();
  for (const raw of context.split(/[^\p{L}\p{M}'-]+/u)) {
    const token = raw.trim();
    if (!token) continue;
    // Latin-script words are deduped case-insensitively (inflectionless
    // casing variance should not multiply reports); the first-seen surface
    // form is reported. Anything containing a non-latin letter is reported
    // uncontrolled, never guessed.
    const dedupeKey = /^[\p{Script=Latin}\p{M}'-]+$/u.test(token) ? token.toLowerCase() : token;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (!/^[\p{Script=Latin}\p{M}'-]+$/u.test(token)) {
      uncontrolled.push(token);
      continue;
    }
    const level = control.levelOf(token);
    if (level === undefined) {
      uncontrolled.push(token);
    } else {
      checked.push({ token, level });
      if (level > control.maxLevel) aboveMax.push(token);
    }
  }
  return { checked, aboveMax, uncontrolled };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function grammarPatternFromEvent(event: KnowledgeEvent, key: string): string {
  const language = key.slice(0, key.indexOf(':'));
  const prefix = `${language}:grammar:`;
  // Canonical: the event's targetRef.id IS the grammar entity id
  // (`${language}:grammar:${pattern}`, NFC-normalized).
  const refId = event.targetRef?.id;
  if (refId !== undefined && refId.startsWith(prefix)) return refId.slice(prefix.length);
  // Defensive fallback: the evidence key embeds the entity id —
  // `${language}:grammar:${language}:grammar:${pattern}:${capability}`.
  const keyPrefix = `${prefix}${prefix}`;
  if (key.startsWith(keyPrefix)) {
    const suffix = key.slice(keyPrefix.length);
    const lastColon = suffix.lastIndexOf(':');
    if (lastColon !== -1) return suffix.slice(0, lastColon);
  }
  return '';
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let position = 0;
  while ((position = haystack.indexOf(needle, position)) !== -1) {
    count += 1;
    position += needle.length;
  }
  return count;
}

function assembleOptionOrder(all: readonly string[], seed: number): string[] {
  const order = [...all];
  const rng = createSeededRng(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const value of a) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of b) {
    const remaining = counts.get(value) ?? 0;
    if (remaining === 0) return false;
    counts.set(value, remaining - 1);
  }
  return true;
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
