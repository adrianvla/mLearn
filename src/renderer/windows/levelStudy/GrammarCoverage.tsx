import { Component, For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { selectNextEncounter } from '../../learning/engine';
import { policyContextFromSettings } from '../../learning/policyContext';
import {
  QuestionBankCache,
  gradeContrastAnswer,
  isDeliverableItem,
  itemAttemptCounts,
  itemsForPattern,
  questionBankFromLanguageData,
  type LanguageQuestionBank,
  type QuestionItem,
} from '../../learning/questionBank';
import {
  classifyGrammarMeasurements,
  grammarCategoryPressure,
  grammarLevelName,
} from '../../utils/curriculumCoverage';
import { effectiveThresholds } from '../../../shared/knowledge/effectiveKnowledge';
import { grammarPointMeaning } from '../../../shared/languageFeatures';
import type { AttemptQuality } from '../../../shared/constants';
import type { GrammarPracticeItemSource, LanguageData } from '../../../shared/types';
import type { CurriculumComponentSummary } from '../../../shared/curriculum';
import type { AttemptScaffolds, KnowledgeEvent, KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import { loadQuestionValidationRecords, questionValidationRecordKey, validateQuestionItemsWithLLM } from '../../learning/questionValidation';
import './GrammarCoverage.css';

export interface GrammarCoverageProps {
  language: string;
  languageData: LanguageData;
  /** Capability-scoped journal for the language (already loaded by the tab). */
  eventLog: KnowledgeEventLog;
  summary: CurriculumComponentSummary;
  /** Records a grammar-recognize probe (self-assessed construction recognition).
   *  The active task supplies the written pattern only — no meaning cue is
   *  rendered inside the pass, so attempts stay unassisted by construction.
   *  `attempt.itemRef` carries the versioned practice item that produced a
   *  contrast-question attempt (R12/G03 provenance + invalidation). */
  onProbe: (
    pattern: string,
    quality: AttemptQuality,
    level: number,
    scaffolds?: AttemptScaffolds,
    attempt?: { itemRef?: { id: string; version: string; seed?: number }; validationRef?: KnowledgeEvent['validationRef']; taskType?: string },
  ) => void;
  /** Signals the owner that validation records changed, so it re-resolves
   *  the language data (the record store is non-reactive localStorage). */
  onValidated?: () => void;
  /** Cross-section repair trigger (R13): the mock results request the SAME
   *  policy walk this section already offers for that level. A live walk is
   *  never silently replaced (G01) — the level merely expands so the learner
   *  can return to it. */
  repairRequest?: { level: number; requestedAt: number } | null;
  /** Clears the owner-held request only once its policy walk has started. */
  onRepairRequestHandled?: (requestedAt: number) => void;
}

interface ConstructionRow {
  pattern: string;
  meaning?: string;
  state: 'known' | 'learning' | 'unknown' | 'unmeasured';
  passiveOnly: boolean;
  exposures: number;
}

/**
 * Durable pass resume (G01): an in-progress walk survives unmount/restart via
 * localStorage, keyed per learning language AND pass kind — a contrast pass
 * never overwrites a stored self-assessment cursor or vice versa. Restoration
 * validates the stored cursor against the CURRENT package declaration —
 * retired patterns/items, changed levels, or corrupt entries are discarded
 * rather than resumed. Completion clears the entry. Storage unavailability
 * degrades to no-resume silently. Resume priority when both kinds are stored:
 * the self-assessment walk wins (deterministic); its contrast counterpart
 * resumes once that entry clears.
 */
const passStorageKey = (language: string, kind: 'self-assess' | 'contrast'): string =>
  kind === 'contrast' ? `mlearn-grammar-contrast-pass:${language}` : `mlearn-grammar-pass:${language}`;

interface StoredPass {
  level: number;
  queue: string[];
  index: number;
  /**
   * Pass kind. Absent = the original self-assessment walk (legacy stored
   * entries resume unchanged); 'contrast' walks the package's item-backed
   * constructions as MCQ contrast questions.
   */
  kind?: 'self-assess' | 'contrast';
  /**
   * Delivery format of the CURRENT contrast step (R12: MCQ, typing by
   * objective/preference). Absent or out-of-declaration values fall back to
   * MCQ per step. Speech delivery is a named deferral (R12).
   */
  mode?: 'mcq' | 'typed';
  /** Identity of the FULL walked denominator this pass covers (sorted, NUL-joined).
   *  Binds a stored pass to the exact multiset it was planned under,
   *  so a resume cannot silently adopt a changed or truncated denominator (G01/R16). */
  denominator: string;
}

function levelDenominator(level: number, grammar: NonNullable<LanguageData['grammar']>): string {
  return grammar
    .filter((point) => point.level === level)
    .map((point) => point.pattern)
    .sort()
    .join('\u0000');
}

/**
 * Denominator of a CONTRAST pass: the item-backed constructions of the level
 * (sorted, NUL-joined). Computed from the current bank so a resume is bound
 * to exactly the item set the pass was planned under (G03/G01).
 */
function contrastDenominator(level: number, bank: LanguageQuestionBank, grammar: NonNullable<LanguageData['grammar']>): string {
  const itemBacked = deliverablePatterns(level, bank, grammar);
  return grammar
    .filter((point) => point.level === level && itemBacked.has(point.pattern))
    .map((point) => point.pattern)
    .sort()
    .join('\u0000');
}

function declaredFormats(source: GrammarPracticeItemSource): readonly ('mcq' | 'typed')[] {
  return source.formats === undefined ? ['mcq'] : [...new Set(source.formats)];
}

function deliverablePatterns(
  level: number,
  bank: LanguageQuestionBank,
  grammar: NonNullable<LanguageData['grammar']>,
): ReadonlySet<string> {
  const patterns = new Set<string>();
  for (const point of grammar) {
    if (point.level !== level || patterns.has(point.pattern)) continue;
    for (const source of itemsForPattern(bank, point.pattern)) {
      if (declaredFormats(source).length === 0) continue;
      const item = questionItemCache.getOrAssemble(source, {
        language: bank.language,
        pattern: point.pattern,
        contentVersion: bank.contentVersion,
      });
      if (isDeliverableItem(item)) {
        patterns.add(point.pattern);
        break;
      }
    }
  }
  return patterns;
}

function loadStoredPass(
  language: string,
  grammar: NonNullable<LanguageData['grammar']>,
  bank: LanguageQuestionBank,
): StoredPass | null {
  const tryLoad = (kind: 'self-assess' | 'contrast'): StoredPass | null => {
    try {
      const raw = globalThis.localStorage?.getItem(passStorageKey(language, kind));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredPass;
      const declaredAtLevel = new Set(
        grammar.filter((point) => point.level === parsed.level).map((point) => point.pattern),
      );
      // A contrast resume additionally requires every queued pattern to still
      // be item-backed: a retired package item cannot silently resume (G03).
      const itemBacked = parsed.kind === 'contrast'
        ? parsed.queue.every((pattern) => deliverablePatterns(parsed.level, bank, grammar).has(pattern))
        : true;
      const valid = typeof parsed?.level === 'number'
        && declaredAtLevel.size > 0
        && Array.isArray(parsed.queue)
        && parsed.queue.every((pattern) => typeof pattern === 'string')
        && parsed.queue.every((pattern) => declaredAtLevel.has(pattern))
        && [...parsed.queue].sort().join('\u0000') === parsed.denominator     // the queue IS the planned multiset (rejects duplicate substitution)
        && parsed.denominator === (
          parsed.kind === 'contrast'
            ? contrastDenominator(parsed.level, bank, grammar)
            : levelDenominator(parsed.level, grammar)
        )
        && itemBacked
        && (parsed.mode === undefined || parsed.mode === 'mcq' || parsed.mode === 'typed')
        && Number.isInteger(parsed.index)
        && parsed.index >= 0
        && parsed.index <= parsed.queue.length;
      return valid ? parsed : null;
    } catch {
      return null;
    }
  };
  // Resume priority: the self-assessment walk wins when both kinds are stored
  // (deterministic); its contrast counterpart resumes once that entry clears.
  return tryLoad('self-assess') ?? tryLoad('contrast');
}

function saveStoredPass(language: string, pass: StoredPass | null): void {
  // null clears the legacy self-assessment key (the completion path always
  // writes the finished pass, whose kind selects its own key).
  const key = passStorageKey(language, pass?.kind === 'contrast' ? 'contrast' : 'self-assess');
  try {
    if (pass === null || pass.index >= pass.queue.length) {
      globalThis.localStorage?.removeItem(key);
    } else {
      globalThis.localStorage?.setItem(key, JSON.stringify(pass));
    }
  } catch {
    // Storage unavailable (quota/private mode): resume is simply not offered.
  }
}

const STATE_LABEL_KEY: Record<ConstructionRow['state'], string> = {
  known: 'mlearn.LevelStudy.Grammar.State.Known',
  learning: 'mlearn.LevelStudy.Grammar.State.Learning',
  unknown: 'mlearn.LevelStudy.Grammar.State.Unknown',
  unmeasured: 'mlearn.LevelStudy.Grammar.State.Unmeasured',
};

/**
 * Assembled contrast items, cached across mounts and languages by
 * (language, item id, content version). Assembly + validation run once per
 * item version — never inside a rating interaction (R12/R17).
 */
const questionItemCache = new QuestionBankCache();

/**
 * Grammar curriculum coverage, aggregated over the package's OWN grammar
 * scale — displayed beside (never merged into) the vocabulary frequency
 * levels. A construction is "measured" only through active evidence
 * (probes, anki imports); passive encounter rollups stay familiarity.
 *
 * A one-click Practise pass plans a short policy-selected walk over the
 * level's constructions: each pick is TeachingPolicy's decision (CURRICULUM
 * preset, grammar-recognize task). recentPicks + minRepeatDistance exhaust
 * the level's items once without repeats; a deferred/empty pool ends the pass
 * gracefully (G04). Rating writes canonical grammar evidence through onProbe
 * and the journal bump re-aggregates this view — no new scheduler, no new
 * evidence path, no compulsory card creation.
 *
 * Assessment hygiene (G01/G02): the pass prompt shows the written pattern
 * ONLY (the task declares written-form as supplied), one rating submission
 * is honored per presentation beat so rapid second clicks can never rate an
 * unseen construction, and a live pass pauses other levels' Practise entries
 * so a new pass can never silently replace a running one.
 *
 * Contrast pass (R12): a second one-click pass over the level's ITEM-BACKED
 * constructions. Each step renders a validated assembled contrast question
 * (original context, answer span removed, seeded option order — the surface
 * never holds the gold answer); grading re-derives the gold from the item
 * source at submit time, maps a correct selection to `struggled` (one
 * successful MCQ attempt is not automatic proof of full objective mastery,
 * R13) and a wrong selection to `missed`, and records the attempt through
 * onProbe with the item's versioned reference. Constructions without a
 * deliverable item are never invented — they simply stay out of this pass's
 * pool and remain reachable through the regular Practise walk (G04).
 */
export const GrammarCoverage: Component<GrammarCoverageProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const [expandedLevel, setExpandedLevel] = createSignal<number | null>(null);
  const [session, setSession] = createSignal<StoredPass | null>(
    loadStoredPass(props.language, props.languageData.grammar ?? [], questionBankFromLanguageData(props.language, props.languageData)),
  );

  // Package item bank (G03): assembled/deliverable items are cached off the
  // rating path; the rating path only reads resolved items from the cache.
  const bank = createMemo(() => questionBankFromLanguageData(props.language, props.languageData));
  const [contrastAnswer, setContrastAnswer] = createSignal<{ correct: boolean; chosenIndex: number; gold: string } | null>(null);
  // Typed delivery (R12): the submitted string and what supplied it (G05).
  // IME composition is provenance about the input device, never an error.
  const [typedValue, setTypedValue] = createSignal('');
  let typedComposed = false;
  const resetContrastInput = () => {
    setTypedValue('');
    typedComposed = false;
  };

  const measurements = createMemo(() => classifyGrammarMeasurements(props.language, props.eventLog, effectiveThresholds(settings)));

  // Language/package switch: swap the in-memory pass for the durable one of
  // the new language (or none). The old language's stored entry is untouched.
  createEffect(on([() => props.language, () => props.languageData], ([language]) => {
    setContrastAnswer(null);
    resetContrastInput();
    setSession(loadStoredPass(language, props.languageData.grammar ?? [], bank()));
  }, { defer: true }));

  // Persist every cursor movement; completion removes the stored entry.
  createEffect(() => {
    const active = session();
    if (active === null) return;
    saveStoredPass(props.language, active);
  });

  const constructionsByLevel = createMemo(() => {
    const byLevel = new Map<number, ConstructionRow[]>();
    const measured = measurements();
    for (const point of props.languageData.grammar ?? []) {
      if (typeof point.level !== 'number') continue;
      const measurement = measured.get(point.pattern);
      const meaning = grammarPointMeaning(point, settings.uiLanguage, props.languageData.meaningLanguage);
      const rows = byLevel.get(point.level) ?? [];
      rows.push({
        pattern: point.pattern,
        ...(meaning !== undefined ? { meaning } : {}),
        state: measurement?.state ?? 'unmeasured',
        passiveOnly: measurement?.passiveOnly ?? true,
        exposures: measurement?.exposures ?? 0,
      });
      byLevel.set(point.level, rows);
    }
    return byLevel;
  });

  /**
   * Per-level session view: null unless THIS level has a session. A pass on
   * one level never leaks its prompt/controls into another expanded level.
   */
  const sessionFor = (level: number): { done: boolean; pattern: string | null; total: number } | null => {
    const active = session();
    if (!active || active.level !== level) return null;
    const pattern = active.queue[active.index];
    if (pattern === undefined) return { done: true, pattern: null, total: active.queue.length };
    return { done: false, pattern, total: active.queue.length };
  };

  /** A live (not finished) pass is running on this level. */
  const sessionActiveFor = (level: number): boolean => {
    const active = session();
    return active !== null && active.level === level && active.index < active.queue.length;
  };

  /** True while any pass is live: other levels' Practise entries pause, so a
   *  new pass can never silently replace a running one (G01 no-silent-replan). */
  const sessionLive = (): boolean => {
    const active = session();
    return active !== null && active.index < active.queue.length;
  };

  /** Presentation-beat submission lock (G01): after one rating, the session
   *  controls stay disabled for a short beat so a rapid second click cannot
   *  rate the next, not-yet-seen construction. The timer is the sanctioned
   *  race-condition exception; it is cleared on dispose and on new passes.
   *  The beat is defense-in-depth only: the load-bearing duplicate-submission
   *  protection is gesture truth — the trailing half of a platform
   *  double-click (detail > 1) and key auto-repeat are the SAME gesture as
   *  the rating that advanced the prompt, regardless of elapsed time, so
   *  they are rejected outright at the control. */
  const [submissionsLocked, setSubmissionsLocked] = createSignal(false);
  let submissionLockTimer: number | undefined;
  onCleanup(() => clearTimeout(submissionLockTimer));

  /** Plans the pass: TeachingPolicy chooses, in order, each un-deferred construction of the level. */
  const startSession = (level: number) => {
    const items = (props.languageData.grammar ?? [])
      .filter((point) => point.level === level && typeof point.pattern === 'string')
      .map((point) => ({
        language: props.language,
        pattern: point.pattern,
        level: point.level!,
        ...(point.category ? { category: point.category } : {}),
        // Curriculum provenance (R20): the package's own content version, so
        // a trace names the curriculum snapshot behind the pass order.
        ...(props.languageData.languageData?.version !== undefined
          ? { contentVersion: props.languageData.languageData.version }
          : {}),
      }));
    // Category-bottleneck pressure (R07) from RECORDED measurements: the
    // pass order responds to categories whose measured attempts stay
    // insecure, through the SAME policy pick (no separate scheduler).
    const pressure = grammarCategoryPressure(
      items,
      classifyGrammarMeasurements(props.language, props.eventLog, effectiveThresholds(settings)),
    );
    const queue: string[] = [];
    const recentPicks: string[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const decision = selectNextEncounter({
        preset: 'CURRICULUM',
        levelStudyItems: [],
        curriculumGrammarItems: items,
        grammarCategoryPressure: pressure,
        nowMs: Date.now(),
        // The goal applies only to this package's learning language (R07).
        context: policyContextFromSettings(settings, props.language),
        recentPicks,
        config: { minRepeatDistance: Math.max(1, items.length), deferFloor: 0 },
      });
      if (!decision || decision.action === 'DEFER') break;
      const pattern = decision.candidate.meta?.pattern;
      if (typeof pattern !== 'string') break;
      queue.push(pattern);
      recentPicks.push(decision.candidate.key);
    }
    setSubmissionsLocked(false);
    clearTimeout(submissionLockTimer);
    setContrastAnswer(null);
    resetContrastInput();
    setSession({ level, queue, index: 0, denominator: levelDenominator(level, props.languageData.grammar ?? []) });
  };

  /** Rates the construction whose prompt is on screen, then advances. The
   *  submitted pattern must still be the presented one (stale handlers are
   *  rejected); gesture truth and the 150 ms presentation beat (imperceptible
   *  between prompts) keep double-clicks, key auto-repeat and sub-beat
   *  replays from rating an unseen construction. The timer is the sanctioned
   *  race-condition exception; it is cleared on dispose and when a new pass
   *  starts. */
  const rateSession = (level: number, quality: AttemptQuality, presented: string | undefined) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level) return;
    const pattern = active.queue[active.index];
    if (pattern === undefined || presented !== pattern) return;
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    props.onProbe(pattern, quality, level);
    setSession({ ...active, index: active.index + 1 });
  };

  /** Advances without recording anything — a skip is not evidence (G04). */
  const skipSession = (level: number, presented: string | undefined) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level) return;
    if (presented !== undefined && active.queue[active.index] !== presented) return;
    setSession({ ...active, index: active.index + 1 });
  };

  // --- Contrast pass (R12): package item sources, seeded assembly, graded MCQ ---

  /** All deliverable items for a pattern (package order). Assembly +
   *  validation happen once per item version through the cache; the STRICT
   *  gate decides deliverability — an item is deliverable only when an
   *  independent semantic validation actually executed, passed it, and binds
   *  to the current item content. Unreviewed real package items therefore
   *  stay out of the contrast pool until that validation exists (R12; a
   *  named external dependency, never fabricated), and a pattern with no
   *  deliverable item simply stays out of the pass (G04). */
  const deliverableItemsFor = (pattern: string): Array<{ source: GrammarPracticeItemSource; item: QuestionItem }> => {
    const deliverable: Array<{ source: GrammarPracticeItemSource; item: QuestionItem }> = [];
    for (const source of itemsForPattern(bank(), pattern)) {
      if (declaredFormats(source).length === 0) continue;
      const item = questionItemCache.getOrAssemble(source, {
        language: props.language,
        pattern,
        contentVersion: bank().contentVersion,
      });
      if (isDeliverableItem(item)) deliverable.push({ source, item });
    }
    return deliverable;
  };

  /** G02 repeated-item familiarity in serving: among a construction's
   *  deliverable items, prefer the one the journal shows as LEAST attempted
   *  (ties keep package order — deterministic). Consecutive passes alternate
   *  items instead of always re-serving the same memorized one. */
  const selectContrastItem = (pattern: string): { source: GrammarPracticeItemSource; item: QuestionItem } | null => {
    const candidates = deliverableItemsFor(pattern);
    if (candidates.length === 0) return null;
    const counts = itemAttemptCounts(props.eventLog);
    let best = candidates[0];
    let bestCount = counts.get(best.item.id) ?? 0;
    for (const candidate of candidates.slice(1)) {
      const count = counts.get(candidate.item.id) ?? 0;
      if (count < bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    return best;
  };

  /** Item-backed constructions per level — drives Contrast button availability. */
  const contrastAvailableByLevel = createMemo(() => {
    const available = new Map<number, boolean>();
    for (const point of props.languageData.grammar ?? []) {
      if (typeof point.level !== 'number') continue;
      if (available.get(point.level) === true) continue;
      if (deliverableItemsFor(point.pattern).length > 0) available.set(point.level, true);
    }
    return available;
  });

  /** The resolved contrast step for a level's current cursor: null unless a
   *  live contrast pass on THIS level presents a deliverable item. */
  const contrastStepFor = (level: number): { pattern: string; source: GrammarPracticeItemSource; item: QuestionItem } | null => {
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return null;
    const pattern = active.queue[active.index];
    if (pattern === undefined) return null;
    const resolved = selectContrastItem(pattern);
    return resolved === null ? null : { pattern, source: resolved.source, item: resolved.item };
  };

  /** The item's DECLARED delivery formats (package-owned; absent = MCQ). */
  const contrastFormatsFor = (source: GrammarPracticeItemSource): readonly ('mcq' | 'typed')[] =>
    declaredFormats(source);

  /** Effective format of the current step: the pass mode when the item
   *  declares it, else MCQ (a package may declare fewer formats than the
   *  pass's stored mode). */
  const contrastModeFor = (step: { source: GrammarPracticeItemSource }): 'mcq' | 'typed' => {
    const formats = contrastFormatsFor(step.source);
    const mode = session()?.mode ?? 'mcq';
    return formats.includes(mode) ? mode : formats[0] ?? 'mcq';
  };

  /** Post-submit option styling: the chosen wrong option, and the gold option
   *  — marked only AFTER the graded submission (never pre-answer, G02). */
  const contrastOptionClass = (optionText: string, index: number): string => {
    const answer = contrastAnswer();
    if (answer === null) return 'grammar-contrast__option';
    if (index === answer.chosenIndex) {
      return answer.correct
        ? 'grammar-contrast__option grammar-contrast__option--gold'
        : 'grammar-contrast__option grammar-contrast__option--wrong';
    }
    return optionText === answer.gold
      ? 'grammar-contrast__option grammar-contrast__option--gold'
      : 'grammar-contrast__option';
  };

  const validationRefFor = (item: QuestionItem): NonNullable<KnowledgeEvent['validationRef']> => {
    const semantic = item.validation.semantic!;
    return {
      validator: semantic.validator,
      ...(semantic.validatorVersion !== undefined ? { validatorVersion: semantic.validatorVersion } : {}),
      at: semantic.at,
      contentHash: semantic.contentHash,
    };
  };

  // --- Independent validation producer (R12): existing AI infrastructure ---
  // User-triggered and batched OFF the rating path: bounded batches run
  // through the configured unified LLM provider (local builtin/Ollama by
  // default), records persist content-bound and surface via the owner's data
  // re-resolution. Cloud is refused by the producer (campaign/named external
  // dependency) — no paid call can be triggered from here, honestly reported.

  /** Structured result of the last run for honest rendering. */
  interface ValidationRunStatus {
    passed: number;
    rejected: number;
    unchanged: number;
    errors: readonly string[];
  }
  const [validating, setValidating] = createSignal(false);
  const [validationStatus, setValidationStatus] = createSignal<ValidationRunStatus | null>(null);

  /** Levels with declared items that still await an actual validation: the
   *  control appears exactly where items exist but no executed record (or
   *  deliverability) covers them yet — never where nothing can change. */
  const validationPendingByLevel = createMemo(() => {
    const pending = new Map<number, boolean>();
    const records = loadQuestionValidationRecords(props.language);
    for (const point of props.languageData.grammar ?? []) {
      if (typeof point.level !== 'number' || pending.get(point.level) === true) continue;
      for (const source of itemsForPattern(bank(), point.pattern)) {
        if (declaredFormats(source).length === 0) continue;
        const item = questionItemCache.getOrAssemble(source, {
          language: props.language,
          pattern: point.pattern,
          contentVersion: bank().contentVersion,
        });
        if (!isDeliverableItem(item) && !records.has(questionValidationRecordKey(source.id, item.version, point.pattern))) {
          pending.set(point.level, true);
          break;
        }
      }
    }
    return pending;
  });

  /** Runs the producer once (single-flight, G01). Cloud-configured providers
   *  are refused by the producer itself (named external dependency); local
   *  providers run the user's own configured model. Completion always
   *  notifies the owner so the (non-reactive) record store is re-read. */
  const runValidation = () => {
    if (validating()) return;
    setValidating(true);
    setValidationStatus(null);
    validateQuestionItemsWithLLM(props.language, props.languageData, settings, {})
      .then((result) => {
        setValidationStatus({
          passed: result.records.filter((record) => record.status === 'passed').length,
          rejected: result.records.filter((record) => record.status === 'rejected').length,
          unchanged: result.cached + result.rejectedBeforeLLM.length,
          errors: result.errors,
        });
      })
      .catch((error: unknown) => {
        setValidationStatus({
          passed: 0,
          rejected: 0,
          unchanged: 0,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      })
      .finally(() => {
        setValidating(false);
        props.onValidated?.();
      });
  };

  /** Plans the contrast pass over the level's item-backed constructions:
   *  TeachingPolicy chooses, in order, each deliverable construction (the
   *  SAME CURRICULUM pick as the self-assessment pass — no second scheduler). */
  const startContrastSession = (level: number) => {
    const items = (props.languageData.grammar ?? [])
      .filter((point) => point.level === level && typeof point.pattern === 'string' && deliverableItemsFor(point.pattern).length > 0)
      .map((point) => ({
        language: props.language,
        pattern: point.pattern,
        level: point.level!,
        ...(point.category ? { category: point.category } : {}),
        ...(props.languageData.languageData?.version !== undefined
          ? { contentVersion: props.languageData.languageData.version }
          : {}),
      }));
    if (items.length === 0) return;
    const pressure = grammarCategoryPressure(
      items,
      classifyGrammarMeasurements(props.language, props.eventLog, effectiveThresholds(settings)),
    );
    const queue: string[] = [];
    const recentPicks: string[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const decision = selectNextEncounter({
        preset: 'CURRICULUM',
        levelStudyItems: [],
        curriculumGrammarItems: items,
        grammarCategoryPressure: pressure,
        nowMs: Date.now(),
        context: policyContextFromSettings(settings, props.language),
        recentPicks,
        config: { minRepeatDistance: Math.max(1, items.length), deferFloor: 0 },
      });
      if (!decision || decision.action === 'DEFER') break;
      const pattern = decision.candidate.meta?.pattern;
      if (typeof pattern !== 'string') break;
      queue.push(pattern);
      recentPicks.push(decision.candidate.key);
    }
    setSubmissionsLocked(false);
    clearTimeout(submissionLockTimer);
    setContrastAnswer(null);
    resetContrastInput();
    setSession({
      level,
      kind: 'contrast',
      queue,
      index: 0,
      mode: 'mcq',
      denominator: contrastDenominator(level, bank(), props.languageData.grammar ?? []),
    });
  };

  // Mock-repair entry (R13): the mock results request the SAME policy walk
  // for the level — the item-backed contrast pass where the package still
  // declares deliverable items, the self-assessment walk otherwise (G04).
  // Missed patterns never bypass policy selection; they re-enter the regular
  // walk. A live walk is never silently replaced (G01): the owner keeps the
  // request until the current walk finishes and the repair actually starts,
  // so a projection-refresh remount cannot lose it.
  const [pendingRepair, setPendingRepair] = createSignal<{ level: number; requestedAt: number } | null>(null);
  createEffect(on(() => props.repairRequest, (request) => {
    if (request === null || request === undefined) return;
    if (sessionLive()) {
      setPendingRepair(request);
      return;
    }
    setExpandedLevel(request.level);
    if (contrastAvailableByLevel().get(request.level) === true) startContrastSession(request.level);
    else startSession(request.level);
    props.onRepairRequestHandled?.(request.requestedAt);
  }));
  createEffect(() => {
    const request = pendingRepair();
    if (request === null || sessionLive()) return;
    setPendingRepair(null);
    setExpandedLevel(request.level);
    if (contrastAvailableByLevel().get(request.level) === true) startContrastSession(request.level);
    else startSession(request.level);
    props.onRepairRequestHandled?.(request.requestedAt);
  });

  /** Grades the visible MCQ selection against the item source (submit-time
   *  gold re-derivation — the surface never held the key, G02), records the
   *  attempt through onProbe with the item's versioned reference, and shows
   *  feedback. A correct selection maps to `struggled` (one successful MCQ
   *  attempt is not automatic proof of full objective mastery, R13); a wrong
   *  selection maps to `missed`. Advancing stays explicit (Next). */
  const answerContrast = (level: number, source: GrammarPracticeItemSource, item: QuestionItem, chosenIndex: number) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    const pattern = active.queue[active.index];
    if (pattern === undefined || item.pattern !== pattern) return;
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    const result = gradeContrastAnswer(item, source, { kind: 'mcq', index: chosenIndex });
    props.onProbe(pattern, result.correct ? 'struggled' : 'missed', level, undefined, {
      itemRef: { id: item.id, version: item.version, seed: item.seed },
      validationRef: validationRefFor(item),
      taskType: item.taskTemplateId,
    });
    setContrastAnswer({ correct: result.correct, chosenIndex, gold: result.goldSpan });
  };

  /** Switches the delivery format of the CURRENT step (R12: MCQ / typing by
   *  objective or preference; speech is a named deferral). Only before an
   *  answer — never replaces a question that was already graded (G01). */
  const setContrastMode = (level: number, mode: 'mcq' | 'typed') => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    if (contrastAnswer() !== null) return;
    resetContrastInput();
    setSession({ ...active, mode });
  };

  /** Grades a typed answer (NFC + trim against the span and the declared
   *  accepted alternatives — never exact-string-only, R12), records the
   *  attempt as the `contrast-typed` task with the input provenance the
   *  grade derived (IME composition supplies orthography, never an error,
   *  G05), and shows feedback. Advancing stays explicit (Next). */
  const submitTypedContrast = (level: number, source: GrammarPracticeItemSource, item: QuestionItem) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    const pattern = active.queue[active.index];
    if (pattern === undefined || item.pattern !== pattern) return;
    const value = typedValue();
    if (value.trim().length === 0) return;
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    const result = gradeContrastAnswer(item, source, {
      kind: 'typed',
      value,
      ...(typedComposed ? { suppliedBy: 'ime' as const } : { suppliedBy: 'keyboard' as const }),
    });
    props.onProbe(pattern, result.correct ? 'struggled' : 'missed', level, result.scaffolds, {
      itemRef: { id: item.id, version: item.version, seed: item.seed },
      validationRef: validationRefFor(item),
      taskType: 'contrast-typed',
    });
    setContrastAnswer({ correct: result.correct, chosenIndex: -1, gold: result.goldSpan });
    resetContrastInput();
  };

  /** Advances the contrast pass after an answered question (explicit Next). */
  const advanceContrast = (level: number) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    setContrastAnswer(null);
    resetContrastInput();
    setSession({ ...active, index: active.index + 1 });
  };

  /** Skips the unanswered question without recording anything (G04). */
  const skipContrast = (level: number) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    setContrastAnswer(null);
    resetContrastInput();
    setSession({ ...active, index: active.index + 1 });
  };

  return (
    <section class="grammar-coverage" aria-label={t('mlearn.LevelStudy.Grammar.Title')}>
      <div class="grammar-coverage__header">
        <h3 class="grammar-coverage__title">{t('mlearn.LevelStudy.Grammar.Title')}</h3>
        <span class="grammar-coverage__totals">
          {t('mlearn.LevelStudy.Grammar.Totals', {
            known: props.summary.known,
            total: props.summary.total,
          })}
        </span>
      </div>
      <div class="grammar-coverage__levels">
        <For each={props.summary.buckets.filter((bucket) => bucket.total > 0)}>
          {(bucket) => {
            const level = bucket.level as number;
            const measured = bucket.total - bucket.unmeasured;
            const measuredPct = bucket.total > 0 ? (measured / bucket.total) * 100 : 0;
            const knownPct = bucket.total > 0 ? (bucket.known / bucket.total) * 100 : 0;
            const open = () => expandedLevel() === level;
            return (
              <div class="grammar-coverage__level" data-level={level}>
                <button
                  type="button"
                  class="grammar-coverage__level-row"
                  data-level={level}
                  onClick={() => setExpandedLevel(open() ? null : level)}
                  aria-expanded={open()}
                >
                  <span class="grammar-coverage__level-name">{grammarLevelName(level, props.languageData)}</span>
                  <span class="grammar-coverage__level-bar" role="img" aria-label={`${measured}/${bucket.total}`}>
                    <span class="grammar-coverage__bar-known" style={{ width: `${knownPct}%` }} />
                    <span
                      class="grammar-coverage__bar-measured"
                      style={{ width: `${Math.max(0, measuredPct - knownPct)}%` }}
                    />
                  </span>
                  <span class="grammar-coverage__level-counts">
                    {t('mlearn.LevelStudy.Grammar.BucketCounts', {
                      measured,
                      total: bucket.total,
                      unmeasured: bucket.unmeasured,
                    })}
                  </span>
                </button>
                <Show when={open()}>
                  <div class="grammar-coverage__session" data-level={level}>
                    <Show when={sessionActiveFor(level)} fallback={
                      <>
                        <Show when={sessionFor(level)?.done}>
                          <span class="grammar-coverage__session-done">
                            {t('mlearn.LevelStudy.Grammar.SessionDone', { count: String(sessionFor(level)?.total ?? 0) })}
                          </span>
                        </Show>
                        <button type="button" class="grammar-coverage__session-btn" disabled={sessionLive()} onClick={() => startSession(level)}>
                          {t('mlearn.LevelStudy.Grammar.Practise')}
                        </button>
                        {/* Availability honesty (G04): the contrast pass exists only where the
                            package declares deliverable items — nothing is invented for levels
                            without them, and the regular Practise walk stays available. */}
                        <Show when={contrastAvailableByLevel().get(level) === true}>
                          <button
                            type="button"
                            class="grammar-coverage__session-btn grammar-coverage__contrast-btn"
                            disabled={sessionLive()}
                            onClick={() => startContrastSession(level)}
                          >
                            {t('mlearn.LevelStudy.Grammar.Contrast')}
                          </button>
                        </Show>
                        {/* Independent validation producer (R12): runs the configured
                            LOCAL model in bounded batches, off the rating path. Single-
                            flight; disabled while any pass is live so deliverability
                            cannot change under an active session (G01/G03). Cloud
                            providers are refused by the producer — honestly reported. */}
                        <Show when={validationPendingByLevel().get(level) === true || validating()}>
                          <button
                            type="button"
                            class="grammar-coverage__session-btn grammar-coverage__validate-btn"
                            data-testid="grammar-validate-btn"
                            disabled={sessionLive() || validating()}
                            onClick={(click) => { if (click.detail > 1) return; runValidation(); }}
                            onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                          >
                            {validating()
                              ? t('mlearn.LevelStudy.Grammar.Validating')
                              : t('mlearn.LevelStudy.Grammar.Validate')}
                          </button>
                        </Show>
                        <Show when={validationStatus()} keyed>
                          {(status) => (
                            <span
                              class="grammar-coverage__validate-status"
                              data-testid="grammar-validate-status"
                              data-errors={status.errors.length > 0 ? 'true' : undefined}
                            >
                              {status.errors.length > 0
                                ? t('mlearn.LevelStudy.Grammar.ValidateFailed', { errors: status.errors.join(' · ') })
                                : t('mlearn.LevelStudy.Grammar.ValidateDone', {
                                    passed: String(status.passed),
                                    rejected: String(status.rejected),
                                    unchanged: String(status.unchanged),
                                  })}
                            </span>
                          )}
                        </Show>
                      </>
                    }>
                      <Show when={session()?.kind === 'contrast' && sessionFor(level)?.pattern !== null} fallback={
                        <>
                          {/* Task declares written-form only: no meaning cue inside the active pass. */}
                          <Show when={sessionFor(level)?.pattern} keyed>
                            {(keyed) => {
                              const presented = typeof keyed === 'function' ? (keyed as unknown as () => string)() : (keyed as unknown as string);
                              return (
                                <>
                                  <span class="grammar-coverage__session-prompt" data-pattern={presented}>
                                    {t('mlearn.LevelStudy.Grammar.SessionPrompt', { pattern: presented })}
                                  </span>
                                  <span class="grammar-coverage__session-probe">
                                    <button type="button" class="grammar-coverage__probe-btn" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; rateSession(level, 'missed', presented); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                                      {t('mlearn.Rating.Matrix.Missed')}
                                    </button>
                                    <button type="button" class="grammar-coverage__probe-btn" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; rateSession(level, 'struggled', presented); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                                      {t('mlearn.Rating.Matrix.Struggled')}
                                    </button>
                                    <button type="button" class="grammar-coverage__probe-btn" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; rateSession(level, 'fluent', presented); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                                      {t('mlearn.Rating.Matrix.Fluent')}
                                    </button>
                                    <button type="button" class="grammar-coverage__session-skip" disabled={submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; skipSession(level, presented); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
                                      {t('mlearn.LevelStudy.Grammar.SessionSkip')}
                                    </button>
                                  </span>
                                </>
                              );
                            }}
                          </Show>
                        </>
                      }>
                        <Show when={contrastStepFor(level)} keyed>
                          {(keyed) => {
                            const step = (typeof keyed === 'function'
                              ? (keyed as unknown as () => { pattern: string; source: GrammarPracticeItemSource; item: QuestionItem })()
                              : keyed) as { pattern: string; source: GrammarPracticeItemSource; item: QuestionItem };
                            return (
                              <div class="grammar-contrast" data-pattern={step.pattern}>
                                <span class="grammar-coverage__session-prompt">
                                  {t('mlearn.LevelStudy.Grammar.ContrastPrompt')}
                                </span>
                                {/* The delivered item only: context with the removed span,
                                    seeded options WITHOUT any correctness flag (G02 — the
                                    answering surface never holds the gold answer). */}
                                <p class="grammar-contrast__context" data-item-id={step.item.id}>
                                  {step.item.prompt.slice(0, step.item.gap.start)}
                                  <mark class="grammar-contrast__gap" aria-hidden="true" />
                                  {step.item.prompt.slice(step.item.gap.end)}
                                </p>
                                {/* Delivery format (R12): the item's DECLARED formats only;
                                    a toggle appears when the package offers both. Speech is
                                    a named deferral, not a hidden mode. */}
                                <Show when={contrastFormatsFor(step.source).length > 1 && contrastAnswer() === null}>
                                  <div class="grammar-contrast__modes" role="group" aria-label={t('mlearn.LevelStudy.Grammar.ModeLabel')}>
                                    <For each={contrastFormatsFor(step.source)}>
                                      {(format) => (
                                        <button
                                          type="button"
                                          class={`grammar-contrast__mode-btn${contrastModeFor(step) === format ? ' grammar-contrast__mode-btn--active' : ''}`}
                                          data-format={format}
                                          disabled={submissionsLocked()}
                                          onClick={(click) => { if (click.detail > 1) return; setContrastMode(level, format); }}
                                          onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                                        >
                                          {t(format === 'typed' ? 'mlearn.LevelStudy.Grammar.ModeType' : 'mlearn.LevelStudy.Grammar.ModeMcq')}
                                        </button>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                                <Show when={contrastModeFor(step) === 'typed'} fallback={
                                  <div class="grammar-contrast__options">
                                    <For each={step.item.options}>
                                      {(option, index) => (
                                        <button
                                          type="button"
                                          class={contrastOptionClass(option.text, index())}
                                          data-option={option.text}
                                          disabled={submissionsLocked() || contrastAnswer() !== null}
                                          onClick={(click) => { if (click.detail > 1) return; answerContrast(level, step.source, step.item, index()); }}
                                          onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                                        >
                                          {option.text}
                                        </button>
                                      )}
                                    </For>
                                  </div>
                                }>
                                  <div class="grammar-contrast__typed">
                                    <input
                                      type="text"
                                      class="grammar-contrast__typed-input"
                                      autocomplete="off"
                                      spellcheck={false}
                                      aria-label={t('mlearn.LevelStudy.Grammar.TypePlaceholder')}
                                      placeholder={t('mlearn.LevelStudy.Grammar.TypePlaceholder')}
                                      value={typedValue()}
                                      disabled={submissionsLocked() || contrastAnswer() !== null}
                                      onInput={(event) => setTypedValue(event.currentTarget.value)}
                                      onCompositionStart={() => { typedComposed = true; }}
                                      onKeyDown={(key) => {
                                        if (key.repeat) key.preventDefault();
                                        else if (key.isComposing) return;
                                        else if (key.key === 'Enter') {
                                          key.preventDefault();
                                          submitTypedContrast(level, step.source, step.item);
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      class="grammar-coverage__session-btn grammar-contrast__submit"
                                      data-testid="grammar-contrast-submit"
                                      disabled={submissionsLocked() || contrastAnswer() !== null || typedValue().trim().length === 0}
                                      onClick={(click) => { if (click.detail > 1) return; submitTypedContrast(level, step.source, step.item); }}
                                      onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                                    >
                                      {t('mlearn.LevelStudy.Grammar.Check')}
                                    </button>
                                  </div>
                                </Show>
                                {/* Feedback + advance are explicit; marking the gold option
                                    happens only AFTER the graded submission. */}
                                <Show when={contrastAnswer() !== null}>
                                  <span
                                    class={`grammar-contrast__feedback ${contrastAnswer()!.correct
                                      ? 'grammar-contrast__feedback--correct'
                                      : 'grammar-contrast__feedback--incorrect'}`}
                                  >
                                    {contrastAnswer()!.correct
                                      ? t('mlearn.LevelStudy.Grammar.Correct')
                                      : t('mlearn.LevelStudy.Grammar.Incorrect', { answer: contrastAnswer()!.gold })}
                                  </span>
                                  <button
                                    type="button"
                                    class="grammar-coverage__session-btn grammar-contrast__next"
                                    disabled={submissionsLocked()}
                                    onClick={(click) => { if (click.detail > 1) return; advanceContrast(level); }}
                                    onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                                  >
                                    {t('mlearn.LevelStudy.Grammar.Next')}
                                  </button>
                                </Show>
                                <Show when={contrastAnswer() === null}>
                                  <button
                                    type="button"
                                    class="grammar-coverage__session-skip"
                                    disabled={submissionsLocked()}
                                    onClick={(click) => { if (click.detail > 1) return; skipContrast(level); }}
                                    onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                                  >
                                    {t('mlearn.LevelStudy.Grammar.SessionSkip')}
                                  </button>
                                </Show>
                              </div>
                            );
                          }}
                        </Show>
                      </Show>
                    </Show>
                  </div>
                  {/* While the pass is live the construction list is hidden: its
                      meanings would cue the active task (written-form only). */}
                  <Show when={!sessionActiveFor(level)}>
                  <ul class="grammar-coverage__constructions">
                    <For each={constructionsByLevel().get(level) ?? []}>
                      {(row) => (
                        <li class="grammar-coverage__construction">
                          <span class="grammar-coverage__pattern">{row.pattern}</span>
                          <Show when={row.meaning}>
                            <span class="grammar-coverage__meaning">{row.meaning}</span>
                          </Show>
                          <span class={`grammar-coverage__state grammar-coverage__state--${row.state}`}>
                            {t(STATE_LABEL_KEY[row.state])}
                            <Show when={row.state === 'unmeasured' && row.exposures > 0}>
                              {' '}· {t('mlearn.LevelStudy.Grammar.SeenOnly', { count: row.exposures })}
                            </Show>
                          </span>
                          {/* Preserved per-row self-assessment interaction. When the
                              row shows a meaning, the probe records that cue as
                              translation-scaffold provenance on the attempt. */}
                          <span class="grammar-coverage__probe">
                            <button type="button" class="grammar-coverage__probe-btn" onClick={() => props.onProbe(row.pattern, 'missed', level, row.meaning !== undefined ? { translation: true } : undefined)}>
                              {t('mlearn.Rating.Matrix.Missed')}
                            </button>
                            <button type="button" class="grammar-coverage__probe-btn" onClick={() => props.onProbe(row.pattern, 'struggled', level, row.meaning !== undefined ? { translation: true } : undefined)}>
                              {t('mlearn.Rating.Matrix.Struggled')}
                            </button>
                            <button type="button" class="grammar-coverage__probe-btn" onClick={() => props.onProbe(row.pattern, 'fluent', level, row.meaning !== undefined ? { translation: true } : undefined)}>
                              {t('mlearn.Rating.Matrix.Fluent')}
                            </button>
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                  </Show>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
};

export default GrammarCoverage;
