import { Component, For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { Button, Panel, RatingMatrix, WriteStatusBanner } from '../../components/common';
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
import { grammarEvidenceKey } from '../../../shared/grammar/evidence';
import { getLogger } from '../../../shared/utils/logger';
import type { GrammarProjectionMap } from '../../../shared/knowledge/historyQueries';
import { nextAttemptId, type AttemptId, type AttemptScaffolds, type KnowledgeEvent, type KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import type { StudySessionLocks } from '../../learning/studySessionController';
import { loadQuestionValidationRecords, questionValidationRecordKey, validateQuestionItemsWithLLM } from '../../learning/questionValidation';
import { studySessionState, type StudySessionWriteStatus } from '../../learning/studySession';
import type { PendingRetraction, RetractionTarget } from '../../../shared/retractionRecovery';
import type { RetractionCompletion, RetractionProjection } from '../../context/FlashcardContext';
import { canRetryRetraction, isRetractionWriteBlocking, pushUndo, type RetractionWriteState } from '../../learning/undoHistory';
import { createStudySessionController, type StudySessionController, type StudySessionRecord } from '../../learning/studySessionController';
import './GrammarCoverage.css';

/**
 * The shared durable Undo lifecycle, as this surface consumes it.
 *
 * Named so an owner and a test harness can satisfy the same contract instead
 * of each inventing the shape they happen to need.
 */
export interface GrammarUndoLifecycle {
  record: (record: PendingRetraction) => Promise<boolean>;
  complete: (
    record: PendingRetraction,
    build: (record: PendingRetraction) => Promise<RetractionProjection>,
  ) => Promise<RetractionCompletion>;
  recover: () => Promise<void>;
  register: (
    surface: string,
    build: (record: PendingRetraction) => Promise<RetractionProjection>,
  ) => void | (() => void);
}

export interface GrammarCoverageProps {
  language: string;
  languageData: LanguageData;
  /** Exact item events for the level (item versions, attempt counts). */
  eventLog: KnowledgeEventLog;
  /** The language's recognition read model — the only coverage input. */
  projections: GrammarProjectionMap;
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
    attempt?: { itemRef?: { id: string; version: string; seed?: number }; validationRef?: KnowledgeEvent['validationRef']; taskType?: string; attemptId?: AttemptId },
  ) => Promise<AttemptId>;
  /**
   * The shared durable Undo lifecycle, supplied by the owner.
   *
   * Passed in for the same reason `onProbe` is: this section owns its own
   * projection and the protocol is core's, so the component stays mountable
   * without a provider and the owner decides where the journal lives.
   */
  undoLifecycle: GrammarUndoLifecycle;
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
  /** Web Locks DI seam (shared study-session convention). Production
   *  resolves `globalThis.navigator.locks`; when absent (or explicitly
   *  `null`) the pass surfaces are DISABLED with a localized fallback (G04)
   *  instead of running an unserialized multi-window pass — the shared
   *  cursor and answered marker are not atomic without a real lock. */
  locks?: StudySessionLocks | null;
}

interface ConstructionRow {
  pattern: string;
  meaning?: string;
  state: 'known' | 'learning' | 'unknown' | 'unmeasured';
  passiveOnly: boolean;
  exposures: number;
}

interface StoredPass {
  level: number;
  queue: string[];
  index: number;
  /** Contrast walks the package's item-backed constructions. */
  kind: 'self-assess' | 'contrast';
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
  /** The learner has completed retrieval and asked to see the package answer.
   * Persisted before arming self-assessment so close/reopen cannot silently
   * return an answered presentation to the unassisted question phase. */
  revealed?: { index: number; pattern: string };
  /**
   * Durable answered marker for the current contrast step, set after the
   * reserved attempt is acknowledged. The shared controller holds the
   * reservation under a cross-window lock until then. `chosenIndex: -1`
   * identifies typed delivery; Next clears the marker.
   */
  answered?: {
    index: number;
    correct: boolean;
    gold: string;
    chosenIndex: number;
    /** Exact delivered item identity. The journal may change item-attempt
     *  counts after grading, but resume/adoption must keep showing the item
     *  whose feedback this marker records (G01/G03). */
    itemRef: { id: string; version: string; seed: number };
  };
  /** Restart-safe reservation for the CURRENT step. It keeps the cursor in
   * place until the stable attempt id is durably present in the journal. */
  pending?: {
    index: number;
    pattern: string;
    attemptId: AttemptId;
    quality: AttemptQuality;
    scaffolds?: AttemptScaffolds;
    attempt?: { itemRef?: { id: string; version: string; seed?: number }; validationRef?: KnowledgeEvent['validationRef']; taskType?: string };
    answered?: NonNullable<StoredPass['answered']>;
  };
}

interface GrammarQueueItem { id: string }
interface GrammarSessionMeta {
  level: number;
  kind: 'self-assess' | 'contrast';
  denominator: string;
  mode?: 'mcq' | 'typed';
}
interface GrammarAttemptPayload {
  quality: AttemptQuality;
  scaffolds?: AttemptScaffolds;
  attempt?: { itemRef?: { id: string; version: string; seed?: number }; validationRef?: KnowledgeEvent['validationRef']; taskType?: string };
}
type GrammarAnswer = NonNullable<StoredPass['answered']>;
type GrammarRecord = StudySessionRecord<GrammarQueueItem, GrammarAttemptPayload, GrammarAnswer, GrammarSessionMeta>;

/** What this surface puts back when a rating is taken back. */
interface GrammarProjection {
  session: GrammarRecord;
  revealed: boolean;
}

/**
 * Where a grammar attempt's evidence lives in the journal.
 *
 * Stated once and used both by the interactive Undo and by a reloaded window
 * finishing an interrupted one, so a recovery cannot tombstone a key the
 * attempt was never written to — which would retract nothing while reporting
 * that the Undo completed.
 */
function grammarRetractionTarget(pattern: string, language: string): RetractionTarget {
  return {
    keys: [grammarEvidenceKey(language, pattern, 'grammar-recognition')],
    replay: { kind: 'grammar', language, patterns: [pattern] },
  };
}
type GrammarController = StudySessionController<GrammarQueueItem, GrammarAttemptPayload, GrammarAnswer, GrammarSessionMeta>;

function presentGrammarRecord(record: GrammarRecord | null): StoredPass | null {
  if (!record) return null;
  const pattern = record.queue[record.index]?.id;
  return {
    level: record.meta.level,
    kind: record.meta.kind,
    denominator: record.meta.denominator,
    mode: record.meta.mode,
    queue: record.queue.map((item) => item.id),
    index: record.index,
    revealed: record.revealed && pattern ? { index: record.index, pattern } : undefined,
    answered: record.answered,
    pending: record.pending ? {
      index: record.pending.index,
      pattern: record.pending.itemId,
      attemptId: record.pending.attemptId,
      quality: record.pending.payload.quality,
      scaffolds: record.pending.payload.scaffolds,
      attempt: record.pending.payload.attempt,
      answered: record.pending.answer,
    } : undefined,
  };
}

function validStoredAnswer(
  answered: StoredPass['answered'],
  index: number,
  pattern: string | undefined,
  kind: StoredPass['kind'],
  bank: LanguageQuestionBank,
): boolean {
  if (answered === undefined) return true;
  if (
    kind !== 'contrast'
    || pattern === undefined
    || typeof answered !== 'object'
    || answered === null
    || answered.index !== index
    || typeof answered.correct !== 'boolean'
    || typeof answered.gold !== 'string'
    || !Number.isInteger(answered.chosenIndex)
    || answered.chosenIndex < -1
    || typeof answered.itemRef?.id !== 'string'
    || typeof answered.itemRef.version !== 'string'
    || !Number.isInteger(answered.itemRef.seed)
  ) return false;
  const source = itemsForPattern(bank, pattern).find((candidate) => candidate.id === answered.itemRef.id);
  if (source === undefined) return false;
  const item = questionItemCache.getOrAssemble(source, {
    language: bank.language,
    pattern,
    contentVersion: bank.contentVersion,
  });
  return isDeliverableItem(item)
    && item.version === answered.itemRef.version
    && item.seed === answered.itemRef.seed;
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
  const log = getLogger('renderer.levelStudy.grammar');
  const { t } = useLocalization();
  const { settings } = useSettings();
  const grammarMeasurements = () =>
    classifyGrammarMeasurements(props.language, props.projections, effectiveThresholds(settings));

  // Web Locks DI seam (shared study-session convention). happy-dom/Node
  // report `navigator.locks` as null (not undefined) — the typed view treats
  // both as absent. An explicit `locks` prop (null included) overrides the
  // global resolution so tests can force each path deterministically.
  const globalLocks = globalThis as { navigator?: { locks?: StudySessionLocks | null } };
  const locksApi = (): StudySessionLocks | null => {
    if (props.locks !== undefined) return props.locks;
    return globalLocks.navigator?.locks ?? null;
  };
  const locksAvailable = (): boolean => locksApi() != null;
  const bank = createMemo(() => questionBankFromLanguageData(props.language, props.languageData));
  const createGrammarController = (language: string, data: LanguageData): GrammarController | null => {
    const locks = locksApi();
    if (!locks) return null;
    const grammar = data.grammar ?? [];
    const questionBank = questionBankFromLanguageData(language, data);
    return createStudySessionController<GrammarQueueItem, GrammarAttemptPayload, GrammarAnswer, GrammarSessionMeta>({
      storageKey: `mlearn-study-grammar:${language}`,
      lockKey: `mlearn-grammar-session:${language}`,
      locks,
      storage: globalThis.localStorage,
      validate: (record) => {
        const { level, kind, denominator } = record.meta;
        const declared = new Set(grammar.filter((point) => point.level === level).map((point) => point.pattern));
        return record.identity === JSON.stringify({ language, level, kind, denominator })
          && record.index >= 0 && record.index <= record.queue.length
          && record.queue.length > 0 && record.queue.every((item) => declared.has(item.id))
          && record.queue.map((item) => item.id).sort().join('\u0000') === denominator
          && denominator === (kind === 'contrast'
            ? contrastDenominator(level, questionBank, grammar)
            : levelDenominator(level, grammar))
          && (kind !== 'contrast' || record.queue.every((item) => deliverablePatterns(level, questionBank, grammar).has(item.id)))
          && (record.answered === undefined || validStoredAnswer(record.answered, record.index, record.queue[record.index]?.id, kind, questionBank));
      },
      writeAttempt: async (pending, record) => {
        await props.onProbe(
          pending.itemId,
          pending.payload.quality,
          record.meta.level,
          pending.payload.scaffolds,
          { ...pending.payload.attempt, attemptId: pending.attemptId },
        );
      },
      next: (record) => ({ index: record.index + 1, meta: record.meta }),
      // The rating is durable and the prompt has advanced. `before` is the
      // session the learner was actually looking at, which is what an Undo
      // has to put back — the pass cursor alone would rewind without
      // restoring the step, and the next rating would land on a prompt the
      // learner never saw.
      onAcknowledged: (before, _after, pending) => {
        setUndoStack((previous) => pushUndo(previous, {
          level: before.meta.level,
          pattern: pending.itemId,
          language: props.language,
          attemptId: pending.attemptId,
          before: { ...before, pending: undefined },
          revealed: before.revealed === true,
        }));
      },
    });
  };
  /**
   * One entry per rating this window could still take back.
   *
   * `before` is the session as it stood while the prompt was on screen, which
   * the shared controller hands back on acknowledgement. The rest is this
   * surface's own presentation state — a rating advances a prompt, so taking
   * it back has to put that back too or the learner is left on a step they
   * never rated.
   */
  interface GrammarUndoEntry {
    level: number;
    pattern: string;
    language: string;
    attemptId: AttemptId;
    before: GrammarRecord;
    revealed: boolean;
  }
  const [undoStack, setUndoStack] = createSignal<GrammarUndoEntry[]>([]);
  /** A retraction that is still being filed blocks the writes that would
   *  rewrite the same journal; a settled failure does not, so the learner's
   *  only route forward stays open. */
  const [retractionWrite, setRetractionWrite] = createSignal<RetractionWriteState>(null);
  const undoBlocking = () => isRetractionWriteBlocking(retractionWrite());

  /**
   * Whether there is a rating this surface could still take back.
   *
   * Asks the same question the command does — a live session, no pending
   * reservation, and something on the stack — so the control never appears
   * where the command would decline.
   */
  const canUndo = (): boolean => {
    if (undoStack().length === 0) return false;
    const record = sessionController()?.current();
    return !!record && !record.pending && record.index < record.queue.length;
  };

  const [sessionController, setSessionController] = createSignal<GrammarController | null>(createGrammarController(props.language, props.languageData));
  const session = createMemo(() => presentGrammarRecord(sessionController()?.current() ?? null));
  /** The pass this window started with (marker feedback seeds the initial
   *  presentation below). */
  const initialPass = session();
  // Projection refreshes remount this section after a probe. Restore the
  // visible level with its durable cursor so the next prompt stays in view.
  const [expandedLevel, setExpandedLevel] = createSignal<number | null>(initialPass?.level ?? null);
  /** A durable write failed (quota/private storage): the refused action is
   *  surfaced with an honest note and stays retryable — never a probe
   *  without a durable cursor (shared study-session contract, G01/G04). Cleared
   *  by the next successful durable write. */
  const [storageWriteUnavailable, setStorageUnavailable] = createSignal(false);
  const storageUnavailable = () => storageWriteUnavailable() || sessionController()?.current()?.pending?.state === 'failed';
  // Review rows use the same acknowledged journal writer as the live pass.
  // A refused append must keep its attempt identity for an idempotent retry,
  // rather than appearing to have recorded a rating or rejecting unhandled.
  const [reviewProbe, setReviewProbe] = createSignal<{
    language: string;
    level: number;
    pattern: string;
    quality: AttemptQuality;
    scaffolds?: AttemptScaffolds;
    attemptId: AttemptId;
    state: StudySessionWriteStatus;
  } | null>(null);
  const submitReviewProbe = async (
    pattern: string,
    quality: AttemptQuality,
    level: number,
    scaffolds?: AttemptScaffolds,
    retry?: NonNullable<ReturnType<typeof reviewProbe>>,
  ): Promise<void> => {
    const active = reviewProbe();
    if (active !== null && (active.state !== 'failed' || retry === undefined || active !== retry)) return;
    const attempt = retry ?? { language: props.language, level, pattern, quality, scaffolds, attemptId: nextAttemptId(), state: 'pending' as const };
    setReviewProbe({ ...attempt, state: 'pending' });
    try {
      await props.onProbe(pattern, quality, level, attempt.scaffolds, { attemptId: attempt.attemptId });
      if (reviewProbe()?.attemptId === attempt.attemptId) setReviewProbe(null);
    } catch {
      if (reviewProbe()?.attemptId === attempt.attemptId) setReviewProbe({ ...attempt, state: 'failed' });
    }
  };

  // Package item bank (G03): assembled/deliverable items are cached off the
  // rating path; the rating path only reads resolved items from the cache.
  const [contrastAnswer, setContrastAnswer] = createSignal<{ correct: boolean; chosenIndex: number; gold: string } | null>(
    initialPass?.answered !== undefined
      ? { correct: initialPass.answered.correct, chosenIndex: initialPass.answered.chosenIndex, gold: initialPass.answered.gold }
      : null,
  );
  // Typed delivery (R12): the submitted string and what supplied it (G05).
  // IME composition is provenance about the input device, never an error.
  const [typedValue, setTypedValue] = createSignal('');
  let typedComposed = false;
  const resetContrastInput = () => {
    setTypedValue('');
    typedComposed = false;
  };

  /** Adopts a loaded pass's presentation state (G01): an answered marker
   *  replays its graded feedback — the step was consumed (here or in
   *  another window) and this window never re-asks it — while an
   *  unanswered pass presents a fresh question. Local presentation only:
   *  adoption never persists, so it cannot resurrect a cursor or
   *  ping-pong storage events between windows. */
  const adoptPresentation = (loaded: StoredPass | null): void => {
    const answered = loaded?.answered;
    setContrastAnswer(answered !== undefined
      ? { correct: answered.correct, chosenIndex: answered.chosenIndex, gold: answered.gold }
      : null);
    resetContrastInput();
  };

  const measurements = createMemo(grammarMeasurements);

  createEffect(on([() => props.language, () => props.languageData], ([language, data]) => {
    sessionController()?.dispose();
    setStorageUnavailable(false);
    setReviewProbe(null);
    // The controller these entries point back into is being disposed, so its
    // ratings can no longer be taken back. The stack is one decision (see
    // undoHistory): a pass starts empty.
    setUndoStack([]);
    setSessionController(createGrammarController(language, data));
  }, { defer: true }));
  onCleanup(() => sessionController()?.dispose());

  createEffect(on(() => sessionController()?.current(), (record) => {
    adoptPresentation(presentGrammarRecord(record ?? null));
  }));

  // How this surface puts its own state back. Registered rather than passed to
  // recovery, so a reloaded window finishes an interrupted Undo by claiming the
  // record under its own tag — the shared protocol never needs to know which
  // surface an Undo came from. Registered per controller because the pass this
  // window can rewind is the one that controller owns.
  createEffect(() => {
    const controller = sessionController();
    if (!controller) return;
    const unregister = props.undoLifecycle.register('grammar', async (record) => {
      const restore = record.restore as GrammarProjection | undefined;
      if (!restore || typeof restore.revealed !== 'boolean' || !restore.session) {
        throw new Error('Grammar undo record carries no usable projection');
      }
      return await grammarProjection(controller, restore);
    });
    if (unregister) onCleanup(unregister);
  });

  // Finish an Undo a previous window decided but did not complete. Runs once
  // the controller is ready, because restoring a pass position is the
  // controller's write. Not offered as a choice: the learner already asked.
  createEffect(on(() => sessionController(), () => {
    void props.undoLifecycle.recover();
  }));
  const finishAction = (controller: GrammarController, captured: GrammarRecord, action: Promise<boolean>): void => {
    void action.then((accepted) => {
      if (accepted) setStorageUnavailable(false);
      else if (controller.current() === captured) {
        setStorageUnavailable(true);
        setRatingRetryKey((key) => key + 1);
      }
    });
  };

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
  const sessionPresentation = createMemo(() => {
    const active = session();
    return studySessionState({
      ready: active !== null,
      index: active?.index ?? 0,
      total: active?.queue.length ?? 0,
      revealed: active?.kind === 'contrast' ? contrastAnswer() !== null : active?.revealed !== undefined,
      write: sessionController()?.current()?.pending?.state ?? null,
      answered: active?.kind === 'contrast' && contrastAnswer() !== null,
    });
  });

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
  const [ratingRetryKey, setRatingRetryKey] = createSignal(0);
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
      grammarMeasurements(),
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
    // A new pass starts a new take-back window. Without this the stack spans
    // every level and every pass in the window's lifetime, which is both an
    // unbounded growth and entries whose sessions are long gone.
    setUndoStack([]);
    setSubmissionsLocked(false);
    clearTimeout(submissionLockTimer);
    setContrastAnswer(null);
    resetContrastInput();
    const controller = sessionController();
    if (!controller || queue.length === 0) return;
    const kind = 'self-assess';
    const denominator = levelDenominator(level, props.languageData.grammar ?? []);
    const identity = JSON.stringify({ language: props.language, level, kind, denominator });
    const captured = controller.current();
    void controller.start(identity, queue.map((id) => ({ id })), 0, { level, kind, denominator }).then((accepted) => {
      if (accepted) setStorageUnavailable(false);
      else if (controller.current() === captured) {
        setStorageUnavailable(true);
        setRatingRetryKey((key) => key + 1);
      }
    });
  };

  /** Rates the construction whose prompt is on screen, then advances. The
   *  submitted pattern must still be the presented one (stale handlers are
   *  rejected); gesture truth and the 150 ms presentation beat (imperceptible
   *  between prompts) keep double-clicks, key auto-repeat and sub-beat
   *  replays from rating an unseen construction. The timer is the sanctioned
   *  race-condition exception; it is cleared on dispose and when a new pass
   *  starts. */
  const revealSession = (level: number, presented: string) => {
    const active = session();
    if (!active || active.level !== level || active.kind === 'contrast'
      || active.queue[active.index] !== presented || active.revealed !== undefined) return;
    const controller = sessionController();
    const captured = controller?.current();
    if (controller && captured) finishAction(controller, captured, controller.reveal(captured));
  };

  const retrySessionWrite = () => {
    const controller = sessionController();
    const captured = controller?.current();
    if (controller && captured?.pending) finishAction(controller, captured, controller.retry(captured));
  };

  /**
   * This surface's projection: put the pass back on the step the learner
   * rated, with the reveal state they had reached.
   *
   * One definition, used by the interactive Undo and by a reloaded window
   * finishing an interrupted one. The rewind happens BEFORE the retraction
   * record is cleared, so a rewind that cannot be applied leaves the record
   * standing and the next load retries rather than the Undo looking finished
   * with the learner on a step they never chose.
   */
  const grammarProjection = async (
    controller: GrammarController,
    projection: GrammarProjection,
  ): Promise<RetractionProjection> => {
    const session = controller.current();
    if (!session || !await controller.undo(session, projection.session)) {
      throw new Error('Grammar undo could not restore the pass position');
    }
    return () => {
      batch(() => {
        setSubmissionsLocked(false);
        clearTimeout(submissionLockTimer);
        setRatingRetryKey((key) => key + 1);
      });
      // Reveal state is this surface's own presentation, not the session's
      // durable field: the record stores it because the step is only rateable
      // once revealed, and re-presenting an unrevealed prompt would silently
      // re-arm a rating the learner has not made yet.
      void revealRestoredStep(projection.revealed);
    };
  };

  /**
   * Re-arm the reveal for a restored step, if the learner had already reached
   * it. The controller's own reveal is the durable path, so a reload after an
   * interrupted Undo does not have to guess whether the answer was shown.
   */
  const revealRestoredStep = async (shouldReveal: boolean): Promise<void> => {
    if (!shouldReveal) return;
    const controller = sessionController();
    const record = controller?.current();
    if (controller && record) await controller.reveal(record);
  };

  /** This surface's record for a decided Undo. */
  const grammarRetraction = (entry: GrammarUndoEntry, previousSession: GrammarRecord): PendingRetraction => ({
    attemptId: entry.attemptId,
    surface: 'grammar',
    // The record's subject fields are the envelope's generic spelling; the
    // routing below is what actually decides which keys are tombstoned.
    word: entry.pattern,
    language: entry.language,
    attemptIds: [entry.attemptId],
    // Named rather than re-derived here, so a window finishing an interrupted
    // Undo writes its tombstone to the key this attempt actually landed on.
    target: grammarRetractionTarget(entry.pattern, entry.language),
    restore: {
      session: previousSession,
      revealed: entry.revealed,
    } satisfies GrammarProjection,
  });

  /** Takes back the last rating on this surface. */
  const undoLastGrammarRating = async (): Promise<void> => {
    if (submissionsLocked() || undoBlocking()) return;
    const stack = undoStack();
    const entry = stack[stack.length - 1];
    const controller = sessionController();
    const current = controller?.current();
    if (!entry || !controller || !current || current.pending) return;
    setRetractionWrite('pending');
    try {
      // Record the decision BEFORE retracting, so a reload between here and
      // completion can finish it. The undo stack is a memory signal: without
      // this the retraction would be reachable only from the window that
      // decided it, and reloading would leave the rating applied with nothing
      // able to take it back.
      const previousSession = entry.before;
      const record = grammarRetraction(entry, previousSession);
      if (!await props.undoLifecycle.record(record)) {
        // Nothing has been retracted yet, so the rating is untouched and the
        // learner must be told rather than left believing the Undo landed.
        setRetractionWrite('failed');
        return;
      }
      const outcome = await props.undoLifecycle.complete(
        record,
        () => grammarProjection(controller, {
          session: previousSession,
          revealed: entry.revealed,
        }),
      );
      if (outcome !== 'completed') {
        // Refused or superseded. Either way the rating is still applied and
        // the record is still there, so the learner is told and can try again
        // — which finishes this exact Undo, not a new one.
        setRetractionWrite('failed');
        return;
      }
      setRetractionWrite(null);
      setUndoStack((previous) => previous.slice(0, -1));
    } catch (error) {
      // Reported, not thrown: the failure is durable state the banner renders
      // and can retry. Rethrowing would only add an unhandled rejection on top
      // of the same information.
      log.warn('Failed to persist grammar undo:', error);
      setRetractionWrite('failed');
    }
  };

  const rateSession = (level: number, quality: AttemptQuality, presented: string | undefined) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || !sessionPresentation().canRate) return;
    const pattern = active.queue[active.index];
    if (pattern === undefined || presented !== pattern) return;
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    const controller = sessionController();
    const captured = controller?.current();
    if (!controller || !captured) return;
    finishAction(controller, captured, controller.reserve(captured, { quality, attempt: { taskType: 'grammar-self-assess' } }, 'advance'));
  };

  /** Advances without recording anything — a skip is not evidence (G04).
   *  Serialized like every durable mutation: a skip that queued behind the
   *  lock while the shared pass moved is dropped with the durable state
   *  adopted; a failed durable write refuses the skip (honest note). */
  const skipSession = (level: number, presented: string | undefined) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level) return;
    if (presented !== undefined && active.queue[active.index] !== presented) return;
    const controller = sessionController();
    const captured = controller?.current();
    if (controller && captured) finishAction(controller, captured, controller.skip(captured));
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
    const pinned = active.answered?.itemRef ?? active.pending?.answered?.itemRef;
    const resolved = pinned === undefined
      ? selectContrastItem(pattern)
      : deliverableItemsFor(pattern).find(({ item }) => (
        item.id === pinned.id && item.version === pinned.version && item.seed === pinned.seed
      )) ?? null;
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
      grammarMeasurements(),
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
    const controller = sessionController();
    if (!controller || queue.length === 0) return;
    const kind = 'contrast';
    const denominator = contrastDenominator(level, bank(), props.languageData.grammar ?? []);
    const identity = JSON.stringify({ language: props.language, level, kind, denominator });
    const captured = controller.current();
    void controller.start(identity, queue.map((id) => ({ id })), 0, { level, kind, denominator, mode: 'mcq' }).then((accepted) => {
      if (accepted) setStorageUnavailable(false);
      else if (controller.current() === captured) setStorageUnavailable(true);
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
   *  selection maps to `missed`. Advancing stays explicit (Next).
   *
   *  Cross-window integrity (G01): the graded outcome is persisted as the
   *  pass's durable answered marker BEFORE the probe, under the session
   *  lock — a second window presenting the same stored cursor finds the
   *  marker, refuses its own answer (and re-renders the graded feedback),
   *  so one presentation can never produce two probes. A failed durable
   *  write REFUSES the answer (no probe without the marker) and the
   *  question stays retryable. */
  const answerContrast = (level: number, source: GrammarPracticeItemSource, item: QuestionItem, chosenIndex: number) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    const pattern = active.queue[active.index];
    if (pattern === undefined || item.pattern !== pattern) return;
    if (active.answered !== undefined) return; // already answered (adopted marker)
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    const result = gradeContrastAnswer(item, source, { kind: 'mcq', index: chosenIndex });
    const marker: NonNullable<StoredPass['answered']> = {
      index: active.index,
      correct: result.correct,
      gold: result.goldSpan,
      chosenIndex,
      itemRef: { id: item.id, version: item.version, seed: item.seed },
    };
    const controller = sessionController();
    const captured = controller?.current();
    if (!controller || !captured) return;
    if (captured.pending) {
      finishAction(controller, captured, controller.retry(captured));
      return;
    }
    finishAction(controller, captured, controller.reserve(captured, {
      quality: result.correct ? 'struggled' : 'missed',
      attempt: {
        itemRef: { id: item.id, version: item.version, seed: item.seed },
        validationRef: validationRefFor(item),
        taskType: item.taskTemplateId,
      },
    }, 'answer', marker));
  };

  /** Switches the delivery format of the CURRENT step (R12: MCQ / typing by
   *  objective or preference; speech is a named deferral). Only before an
   *  answer — never replaces a question that was already graded (G01).
   *  Serialized: a mode switch that queued behind the lock while the shared
   *  pass moved is dropped with the durable state adopted. */
  const setContrastMode = (level: number, mode: 'mcq' | 'typed') => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    if (contrastAnswer() !== null) return;
    const controller = sessionController();
    const captured = controller?.current();
    if (!controller || !captured) return;
    finishAction(controller, captured, controller.updateMeta(captured, { ...captured.meta, mode }));
    resetContrastInput();
  };

  /** Grades a typed answer (NFC + trim against the span and the declared
   *  accepted alternatives — never exact-string-only, R12), records the
   *  attempt as the `contrast-typed` task with the input provenance the
   *  grade derived (IME composition supplies orthography, never an error,
   *  G05), and shows feedback. Advancing stays explicit (Next). Same
   *  durable answered-marker contract as the MCQ answer (G01). */
  const submitTypedContrast = (level: number, source: GrammarPracticeItemSource, item: QuestionItem) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    const pattern = active.queue[active.index];
    if (pattern === undefined || item.pattern !== pattern) return;
    if (active.answered !== undefined) return; // already answered (adopted marker)
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
    const marker: NonNullable<StoredPass['answered']> = {
      index: active.index,
      correct: result.correct,
      gold: result.goldSpan,
      chosenIndex: -1,
      itemRef: { id: item.id, version: item.version, seed: item.seed },
    };
    const controller = sessionController();
    const captured = controller?.current();
    if (!controller || !captured) return;
    if (captured.pending) {
      finishAction(controller, captured, controller.retry(captured));
      return;
    }
    finishAction(controller, captured, controller.reserve(captured, {
      quality: result.correct ? 'struggled' : 'missed',
      scaffolds: result.scaffolds,
      attempt: {
        itemRef: { id: item.id, version: item.version, seed: item.seed },
        validationRef: validationRefFor(item),
        taskType: 'contrast-typed',
      },
    }, 'answer', marker));
  };

  /** Advances the contrast pass after an answered question (explicit Next).
   *  The advance clears the durable answered marker: the step is consumed
   *  exactly once and the next presentation starts unanswered. Serialized;
   *  a failed durable write keeps the answered view intact (feedback and
   *  marker stand — Next retries) instead of a mute unanswered question. */
  const advanceContrast = (level: number) => {
    if (submissionsLocked()) return;
    if (!sessionPresentation().canAdvance) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    const controller = sessionController();
    const captured = controller?.current();
    if (controller && captured) finishAction(controller, captured, controller.advance(captured));
  };

  /** Skips the unanswered question without recording anything (G04).
   *  Serialized; a failed durable write refuses the skip (honest note). */
  const skipContrast = (level: number) => {
    if (submissionsLocked()) return;
    const active = session();
    if (!active || active.level !== level || active.kind !== 'contrast') return;
    const controller = sessionController();
    const captured = controller?.current();
    if (controller && captured) finishAction(controller, captured, controller.skip(captured));
  };

  return (
    <Panel class="grammar-coverage-panel" padding="lg">
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
        <For each={props.summary.buckets.filter((bucket) => bucket.total > 0).map((bucket) => bucket.level as number)}>
          {(level) => {
            // Summary buckets are recreated on every journal projection. Keep
            // each level's DOM (including an open review list) keyed by its
            // stable package level while reading the current bucket values.
            const bucket = createMemo(() => props.summary.buckets.find((entry) => entry.level === level)!);
            const measured = () => bucket().total - bucket().unmeasured;
            const measuredPct = () => bucket().total > 0 ? (measured() / bucket().total) * 100 : 0;
            const knownPct = () => bucket().total > 0 ? (bucket().known / bucket().total) * 100 : 0;
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
                  <span class="grammar-coverage__level-bar" role="img" aria-label={`${measured()}/${bucket().total}`}>
                    <span class="grammar-coverage__bar-known" style={{ width: `${knownPct()}%` }} />
                    <span
                      class="grammar-coverage__bar-measured"
                      style={{ width: `${Math.max(0, measuredPct() - knownPct())}%` }}
                    />
                  </span>
                  <span class="grammar-coverage__level-counts">
                    {t('mlearn.LevelStudy.Grammar.BucketCounts', {
                      measured: measured(),
                      total: bucket().total,
                      unmeasured: bucket().unmeasured,
                    })}
                  </span>
                </button>
                <Show when={open()}>
                  <div class="grammar-coverage__session" data-level={level} data-phase={sessionActiveFor(level) ? sessionPresentation().phase : undefined}>
                    <Show when={sessionActiveFor(level)}>
                      <div class="grammar-coverage__session-progress" role="status" aria-live="polite">
                        {t('mlearn.LevelStudy.Grammar.SessionProgress', {
                          current: String(sessionPresentation().current),
                          total: String(sessionPresentation().total),
                        })}
                      </div>
                    </Show>
                    {/* A refused durable write is surfaced, never silent:
                        the refused action stays retryable and the next
                        attempt re-tries the write (G01/G04). */}
                    <Show when={storageUnavailable()}>
                      <span class="grammar-coverage__session-done" data-testid="grammar-storage-unavailable">
                        {t('mlearn.LevelStudy.Grammar.StorageUnavailable')}
                      </span>
                      <Show when={session()?.pending !== undefined}>
                        <button type="button" class="grammar-coverage__session-btn" data-testid="grammar-session-retry" onClick={retrySessionWrite}>
                          {t('mlearn.Knowledge.Retry')}
                        </button>
                      </Show>
                    </Show>
                    <Show when={sessionActiveFor(level) && session()?.pending !== undefined && !storageUnavailable()}>
                      <WriteStatusBanner
                        status="pending"
                        savingLabelKey="mlearn.LevelStudy.Grammar.SavingAnswer"
                        failedLabelKey="mlearn.LevelStudy.Grammar.StorageUnavailable"
                        canRetry={false}
                        onRetry={() => {}}
                      />
                    </Show>
                    <Show when={sessionActiveFor(level)} fallback={
                      <>
                        <Show when={sessionFor(level)?.done}>
                          <span class="grammar-coverage__session-done">
                            {t('mlearn.LevelStudy.Grammar.SessionDone', { count: String(sessionFor(level)?.total ?? 0) })}
                          </span>
                        </Show>
                        {/* Without a Web Lock the pass surfaces are disabled
                            (G04): an honest localized note replaces the start
                            affordances — never an unserialized multi-window
                            pass. The validation producer stays available
                            (single-flight, not session-scoped). */}
                        <Show when={locksAvailable()} fallback={
                          <span class="grammar-coverage__session-done" data-testid="grammar-no-locks">
                            {t('mlearn.LevelStudy.NoLocks')}
                          </span>
                        }>
                        <button type="button" class="grammar-coverage__session-btn" disabled={sessionLive()} onClick={() => startSession(level)}>
                          {t('mlearn.LevelStudy.Grammar.Practise')}
                        </button>
                        <Show when={sessionLive()}>
                          <span class="grammar-coverage__session-done">{t('mlearn.LevelStudy.Grammar.FinishCurrentPass')}</span>
                        </Show>
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
                        </Show>
                        {/* Independent validation producer (R12): runs the configured
                            LOCAL model in bounded batches, off the rating path. Single-
                            flight; disabled while any pass is live so deliverability
                            cannot change under an active session (G01/G03). Cloud
                            providers are refused by the producer — honestly reported. */}
                        <Show when={validationPendingByLevel().get(level) === true || validating() || validationStatus()}>
                        <details class="grammar-coverage__technical">
                          <summary>{t('mlearn.Knowledge.Projection.Relations.Advanced')}</summary>
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
                        </details>
                        </Show>
                      </>
                    }>
                      <Show when={session()?.kind === 'contrast' && sessionFor(level)?.pattern !== null} fallback={
                        <>
                          {/* The written pattern is the retrieval cue. The package
                              answer is shown only after the learner requests it;
                              the later self-rating describes pre-reveal recall. */}
                          <Show when={sessionFor(level)?.pattern} keyed>
                            {(keyed) => {
                              const presented = typeof keyed === 'function' ? (keyed as unknown as () => string)() : (keyed as unknown as string);
                              return (
                                <>
                                  <span class="grammar-coverage__session-prompt" data-pattern={presented}>
                                    {t('mlearn.LevelStudy.Grammar.SessionPrompt', { pattern: presented })}
                                  </span>
                                  <Show when={session()?.revealed?.pattern === presented} fallback={
                                    <button type="button" class="grammar-coverage__session-btn grammar-coverage__reveal" disabled={session()?.pending !== undefined || submissionsLocked()} onClick={() => revealSession(level, presented)}>
                                      {t(constructionsByLevel().get(level)?.some((row) => row.pattern === presented && row.meaning !== undefined)
                                        ? 'mlearn.LevelStudy.Grammar.RevealAnswer'
                                        : 'mlearn.LevelStudy.Grammar.ContinueToRating')}
                                    </button>
                                  }>
                                    <span class="grammar-coverage__answer" data-testid="grammar-session-answer">
                                      {constructionsByLevel().get(level)?.find((row) => row.pattern === presented)?.meaning
                                        ?? t('mlearn.LevelStudy.Grammar.AnswerUnavailable')}
                                    </span>
                                  </Show>
                                  <span class="grammar-coverage__session-probe">
                                    <Show when={`${props.language}:${level}:${session()?.index ?? 0}:${presented}:${ratingRetryKey()}`} keyed>
                                    <RatingMatrix
                                      capabilities={['grammar-recognition']}
                                      keyboardMode={settings.ratingKeyboardMode}
                                      armed={sessionPresentation().canRate && !submissionsLocked()}
                                      resetKey={`${props.language}:${level}:${session()?.index ?? 0}:${presented}:${ratingRetryKey()}`}
                                      onSubmit={(observations) => {
                                        const observation = observations.find((entry) => entry.capability === 'grammar-recognition');
                                        if (observation) rateSession(level, observation.quality, presented);
                                      }}
                                    />
                                    </Show>
                                    {/* Taking a rating back is one operation on
                                        every study surface, so it reads the same
                                        here as it does on review and Word Sync:
                                        the same control, the same write banner,
                                        the same durable recovery. */}
                                    <WriteStatusBanner
                                      status={retractionWrite()}
                                      savingLabelKey="mlearn.LevelStudy.Grammar.SavingUndo"
                                      failedLabelKey="mlearn.LevelStudy.Grammar.UndoSaveFailed"
                                      canRetry={canRetryRetraction(retractionWrite())}
                                      onRetry={() => { void undoLastGrammarRating(); }}
                                    />
                                    <Show when={canUndo()}>
                                      <button
                                        type="button"
                                        class="grammar-coverage__session-undo"
                                        disabled={session()?.pending !== undefined || submissionsLocked() || undoBlocking()}
                                        onClick={() => { void undoLastGrammarRating(); }}
                                        title={t('mlearn.LevelStudy.Grammar.UndoTooltip')}
                                      >
                                        {t('mlearn.LevelStudy.Grammar.Undo')}
                                      </button>
                                    </Show>
                                    <button type="button" class="grammar-coverage__session-skip" disabled={session()?.pending !== undefined || submissionsLocked()} onClick={(click) => { if (click.detail > 1) return; skipSession(level, presented); }} onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}>
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
                                    disabled={session()?.pending !== undefined || submissionsLocked()}
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
                  <details class="grammar-coverage__review">
                    <summary>{t('mlearn.LevelStudy.Grammar.ReviewPoints', { count: String((constructionsByLevel().get(level) ?? []).length) })}</summary>
                  <ul class="grammar-coverage__constructions">
                    <For each={constructionsByLevel().get(level) ?? []}>
                      {(row) => (
                        <li class="grammar-coverage__construction" aria-busy={reviewProbe()?.state === 'pending' && reviewProbe()?.language === props.language && reviewProbe()?.level === level && reviewProbe()?.pattern === row.pattern}>
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
                            <Button size="sm" variant="danger" class="grammar-coverage__probe-btn" disabled={reviewProbe() !== null} onClick={() => void submitReviewProbe(row.pattern, 'missed', level, row.meaning !== undefined ? { translation: true } : undefined)}>
                              {t('mlearn.Rating.Matrix.Missed')}
                            </Button>
                            <Button size="sm" variant="warning" class="grammar-coverage__probe-btn" disabled={reviewProbe() !== null} onClick={() => void submitReviewProbe(row.pattern, 'struggled', level, row.meaning !== undefined ? { translation: true } : undefined)}>
                              {t('mlearn.Rating.Matrix.Struggled')}
                            </Button>
                            <Button size="sm" variant="success" class="grammar-coverage__probe-btn" disabled={reviewProbe() !== null} onClick={() => void submitReviewProbe(row.pattern, 'fluent', level, row.meaning !== undefined ? { translation: true } : undefined)}>
                              {t('mlearn.Rating.Matrix.Fluent')}
                            </Button>
                          </span>
                          <WriteStatusBanner
                            status={reviewProbe()?.state === 'pending' && reviewProbe()?.language === props.language
                              && reviewProbe()?.level === level && reviewProbe()?.pattern === row.pattern ? 'pending'
                              : reviewProbe()?.state === 'failed' && reviewProbe()?.language === props.language
                                && reviewProbe()?.level === level && reviewProbe()?.pattern === row.pattern ? 'failed'
                                : null}
                            savingLabelKey="mlearn.LevelStudy.Grammar.SavingAnswer"
                            failedLabelKey="mlearn.LevelStudy.Grammar.StorageUnavailable"
                            canRetry={reviewProbe()?.state === 'failed' && reviewProbe()?.language === props.language}
                            onRetry={() => {
                              const failed = reviewProbe();
                              if (failed?.state === 'failed' && failed.language === props.language) void submitReviewProbe(failed.pattern, failed.quality, failed.level, failed.scaffolds, failed);
                            }}
                            class="grammar-coverage__review-error"
                            retryTestId="grammar-row-retry"
                            retryLabelKey="mlearn.Knowledge.Retry"
                          />
                        </li>
                      )}
                    </For>
                  </ul>
                  </details>
                  </Show>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </section>
    </Panel>
  );
};

export default GrammarCoverage;
