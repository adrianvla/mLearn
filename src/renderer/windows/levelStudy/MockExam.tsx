import { Component, For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import {
  MOCK_PER_ITEM_SECONDS,
  abandonMockSession,
  activeStepMs,
  applyMockAnswer,
  assembleMockInstance,
  deriveMockBlueprints,
  isMockPaused,
  isMockStepTimedOut,
  loadMockSummaries,
  loadPendingMockResults,
  loadStoredMockSession,
  mockAttemptPayload,
  mockSessionFingerprint,
  mockSessionStorageKey,
  pauseMockSession,
  pendingMockAttempt,
  presentedMockStep,
  rebuildStoredMockSession,
  resumeMockSession,
  saveMockSummary,
  savePendingMockResults,
  saveStoredMockSession,
  startMockSession,
  stageMockAnswer,
  bindMockAttempt,
  storedMockSessionFingerprint,
  summarizeMockResults,
  touchStoredMockSession,
  type MockBlueprint,
  type MockJournalPayload,
  type MockResults,
  type MockSessionState,
  type MockSubmission,
} from '../../learning/mockExam';
import { questionBankFromLanguageData } from '../../learning/questionBank';
import { grammarPointMeaning } from '../../../shared/languageFeatures';
import type { AttemptId, KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import type { LanguageData } from '../../../shared/types';
import type { PlacementLocks } from './PlacementSession';
import './MockExam.css';

export interface MockExamProps {
  language: string;
  languageData: LanguageData;
  /** Capability-scoped journal for the language (already loaded by the tab). */
  eventLog: KnowledgeEventLog;
  /** Canonical journal writer — the SAME provider the practice walks use.
   *  Resolves with the attempt id only after the durable journal accepts the
   *  event (G01: a real submission without acknowledged evidence is retried). */
  onAttempt: (payload: MockJournalPayload, attemptId: AttemptId) => Promise<AttemptId>;
  /** Opens the SAME TeachingPolicy practice walk for the level (R13: repair
   *  through the existing policy, never a second scheduler). */
  onRepair: (level: number) => void;
  /** Passes the missed constructions into the EXISTING conversation agent —
   *  the one conversation implementation (R14 targeted output). */
  onTargetedOutput?: (targets: readonly { pattern: string; meaning: string; level: number }[]) => void;
  /** Web Locks DI seam (PlacementSession convention). Production resolves
   *  `globalThis.navigator.locks` (Chromium renderers); when absent (or
   *  explicitly `null`) the mock session surface is DISABLED with a
   *  localized fallback (G04) instead of running an unserialized multi-
   *  window session — cursor reads are not atomic without a real lock. */
  locks?: PlacementLocks | null;
}

const fmtSeconds = (ms: number): number => Math.round(ms / 1000);

/**
 * Checkpoints & mocks surface (R13). Fixed declared blueprints derived from
 * the installed language package (`mlearn-derived` — never an official
 * provider blueprint, never an official score). The session view renders the
 * fixed queue with NO mid-session feedback (fixed exam conditions; results
 * come at the end), records every real answer through the canonical journal
 * writer with `mock-contrast`/`mock-typed` task provenance, and offers
 * repair through the SAME policy walk plus targeted output through the SAME
 * conversation agent. Empty assembly is honest (G04): a level whose items
 * cannot be validated is reported as unavailable, never padded.
 */
export const MockExam: Component<MockExamProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();

  // Web Locks DI seam (PlacementSession convention). happy-dom/Node report
  // `navigator.locks` as null (not undefined) — the typed view treats both
  // as absent. An explicit `locks` prop (null included) overrides the
  // global resolution so tests can force each path deterministically.
  const globalLocks = globalThis as { navigator?: { locks?: PlacementLocks | null } };
  const locksApi = (): PlacementLocks | null => {
    if (props.locks !== undefined) return props.locks;
    return globalLocks.navigator?.locks ?? null;
  };
  const locksAvailable = (): boolean => locksApi() != null;

  const [state, setState] = createSignal<MockSessionState | null>(
    locksApi() != null ? loadStoredMockSession(props.language, props.languageData) : null,
  );
  const [results, setResults] = createSignal<MockResults | null>(loadPendingMockResults(props.language));
  const [summaries, setSummaries] = createSignal<MockResults[]>(loadMockSummaries(props.language));
  /** A blueprint whose sections assembled ZERO deliverable items (G04). */
  const [assembleEmpty, setAssembleEmpty] = createSignal<string | null>(null);
  /** A durable write failed (quota/private storage): submissions are
   *  REFUSED with an honest note and the presented prompt stays retryable —
   *  never evidence without a durable cursor (PlacementSession contract,
   *  G01/G04). Cleared by the next successful durable write. */
  const [storageUnavailable, setStorageUnavailable] = createSignal(false);
  /** Active-time tick for the countdown; the interval is the sanctioned
   *  race-condition exception. */
  const [now, setNow] = createSignal(0);

  // Presentation-beat submission lock (same defense-in-depth contract as the
  // practice walks, G01): gesture truth (click detail / key repeat) is the
  // load-bearing guard; the beat only slows a rapid second click. Cleared on
  // dispose and on session switches.
  const [submissionsLocked, setSubmissionsLocked] = createSignal(false);
  let submissionLockTimer: number | undefined;
  onCleanup(() => clearTimeout(submissionLockTimer));

  const bank = createMemo(() => questionBankFromLanguageData(props.language, props.languageData));
  const blueprints = createMemo(() => deriveMockBlueprints(props.language, props.languageData));

  /** Language/package switch: swap in-memory state for the durable one of
   *  the new language (or none). The previous language's last persisted
   *  state stays stored; persistence happens only inside the session
   *  handlers, so a mid-flush write can never file one language's state
   *  under another's key (R19/G01). Without a lock primitive the session
   *  surface stays disabled: nothing durable is restored to act on. */
  createEffect(on([() => props.language, () => props.languageData], ([language, data]) => {
    setSubmissionsLocked(false);
    clearTimeout(submissionLockTimer);
    setStorageUnavailable(false);
    setResults(loadPendingMockResults(language));
    setAssembleEmpty(null);
    setSummaries(loadMockSummaries(language));
    setState(locksApi() != null ? loadStoredMockSession(language, data) : null);
    setNow(0);
  }, { defer: true }));

  /** Serializes every durable mock-session mutation across windows (G01):
   *  start, submission, declared timeout, pause/resume and abandon each
   *  re-verify the shared session inside the lock. Without a real lock
   *  primitive the surface is disabled (G04) — the fallback is never
   *  "run the session unserialized". */
  const inMockLock = (language: string, critical: () => void | Promise<void>): void => {
    const locks = locksApi();
    if (locks == null) return;
    void locks.request(`mlearn-mock-session:${language}`, critical);
  };

  /** Fingerprint of the last session write THIS window made (self-write
   *  suppression for the storage listener). A removal propagates: the other
   *  windows must drop the finished/abandoned session regardless of who
   *  removed it. */
  let lastWrittenSession: string | null = null;
  const persistSession = (language: string, next: MockSessionState): boolean => {
    const ok = saveStoredMockSession(language, next);
    if (ok) {
      lastWrittenSession = next.finishedAt === undefined && next.abandoned !== true
        ? mockSessionFingerprint(next)
        : null;
    }
    return ok;
  };
  const persistClear = (language: string): void => {
    saveStoredMockSession(language, null);
    lastWrittenSession = null;
  };

  /** Adopts the durable session WITHOUT persisting: the raw rebuild never
   *  writes, so two windows reacting to each other's session writes cannot
   *  ping-pong storage events. A stored copy that fails revalidation adopts
   *  as idle (discard), never as a silently replanned session. The data is
   *  the handler-captured package for the same captured language. */
  const adoptDurableSession = (language: string, data: LanguageData): void => {
    setState(rebuildStoredMockSession(language, data));
  };

  /** True when the in-memory session still matches BOTH the snapshot
   *  captured at click time and the durable copy. Otherwise the shared
   *  session moved while this action queued behind the lock (another window
   *  submitted, paused, finished or restarted — or this window paused while
   *  an unpaused click waited): adopt the durable state and drop the
   *  captured action — never double-journal, never clobber (G01). The full
   *  durable fingerprint (cursor, answers, pause history, clock anchors)
   *  is the compared content. Mirrors PlacementSession's captured pick-key
   *  guard. Callers abort on a language flip BEFORE calling this, so the
   *  live props still describe the captured language here. */
  const verifyOrAdopt = (language: string, captured: MockSessionState): boolean => {
    const current = state();
    if (
      current === null
      || current.sessionId !== captured.sessionId
      || mockSessionFingerprint(current) !== mockSessionFingerprint(captured)
      || storedMockSessionFingerprint(language) !== mockSessionFingerprint(current)
    ) {
      adoptDurableSession(language, props.languageData);
      return false;
    }
    return true;
  };

  const reconcilePending = (captured: MockSessionState): void => {
    const language = props.language;
    inMockLock(language, async () => {
      if (props.language !== language || !verifyOrAdopt(language, captured)) return;
      const current = state()!;
      const pending = pendingMockAttempt(current);
      if (pending === null) return;
      try {
        await props.onAttempt(pending.payload, pending.attemptId);
      } catch {
        if (props.language === language) setState(current);
        setStorageUnavailable(true);
        return;
      }
      const bound = bindMockAttempt(current, pending.attemptId);
      if (!persistSession(language, bound)) {
        if (props.language === language) setState(current);
        setStorageUnavailable(true);
        return;
      }
      if (props.language !== language) return;
      setState(bound);
      setStorageUnavailable(false);
      if (bound.finishedAt !== undefined) finishBookkeeping(language, bound);
    });
  };

  /** Terminal bookkeeping: bounded summary + pending results + durable
   *  clear. The removal is best-effort (PlacementSession's terminal
   *  policy): the in-memory results must stand even when the cleanup write
   *  fails, and a leftover in-progress entry cannot resurrect answered
   *  evidence — the next mount's rebuild revalidates it against the
   *  package and the results view already owns the outcome. */
  const finishBookkeeping = (language: string, final: MockSessionState): void => {
    const summary = summarizeMockResults(final);
    setResults(summary);
    saveMockSummary(language, summary);
    savePendingMockResults(language, summary);
    persistClear(language);
  };

  /** Persists FIRST, publishes only on success (durable-first, G01): a
   *  mutation whose durable write fails publishes nothing — the caller
   *  refuses the action with the honest unavailable note (PlacementSession
   *  contract). Terminal transitions publish unconditionally: results and
   *  summary bookkeeping must stand even when the cleanup write fails, and
   *  a terminal clear cannot leave resumable evidence behind. */
  const commit = (language: string, next: MockSessionState): boolean => {
    if (next.finishedAt !== undefined || next.abandoned === true) {
      setState(next);
      finishBookkeeping(language, next);
      return true;
    }
    if (!persistSession(language, next)) return false;
    setState(next);
    return true;
  };

  /** The declared timeout commit (unanswered — no journal event), serialized
   *  like every other session mutation: a queued timeout whose step was
   *  answered, advanced or restarted elsewhere while it waited is dropped
   *  with the durable state adopted (G01); a language switch while it
   *  waited aborts the captured-language action entirely (R19). */
  const commitDeclaredTimeout = (captured: MockSessionState): void => {
    const timeoutLanguage = props.language;
    inMockLock(timeoutLanguage, () => {
      if (props.language !== timeoutLanguage) return;
      if (!verifyOrAdopt(timeoutLanguage, captured)) return;
      commit(timeoutLanguage, applyMockAnswer(captured, { kind: 'timeout', stepIndex: captured.cursor }, undefined, Date.now()));
    });
  };

  const live = createMemo(() => {
    const active = state();
    return active !== null
      && active.abandoned !== true
      && (active.finishedAt === undefined || pendingMockAttempt(active) !== null);
  });
  const step = createMemo(() => {
    const active = state();
    if (active === null) return null;
    const pending = pendingMockAttempt(active);
    return pending === null
      ? presentedMockStep(active)
      : active.instance.steps[active.answers[active.answers.length - 1]!.stepIndex] ?? null;
  });
  const paused = createMemo(() => state() !== null && isMockPaused(state()!));
  let reconciledPendingId: AttemptId | null = null;
  createEffect(() => {
    const active = state();
    const pending = active === null ? null : pendingMockAttempt(active);
    if (pending === null) {
      reconciledPendingId = null;
      return;
    }
    if (reconciledPendingId === pending.attemptId) return;
    reconciledPendingId = pending.attemptId;
    reconcilePending(active!);
  });

  /** Declared timing enforcement: the countdown counts ACTIVE time only. */
  const timeLeftMs = createMemo(() => {
    const active = state();
    if (active === null || step() === null) return MOCK_PER_ITEM_SECONDS * 1000;
    const budget = active.instance.blueprint.timing.perItemSeconds * 1000;
    return Math.max(0, budget - activeStepMs(active, now()));
  });

  // Declared-clock enforcement: while a live, unpaused session presents a
  // step, the tick refreshes the countdown and auto-submits the declared
  // timeout (unanswered — no journal event). The envelope `stepIndex` makes
  // a stale auto-fire land on the presented step only (G01).
  createEffect(() => {
    if (!live() || paused() || (state() !== null && pendingMockAttempt(state()!) !== null)) return;
    const interval = window.setInterval(() => {
      const active = state();
      if (active === null || !live() || isMockPaused(active)) return;
      const at = Date.now();
      setNow(at);
      // Keep a lightweight durable interruption boundary aligned with active
      // time so restore pauses only the time after the last live clock tick.
      touchStoredMockSession(props.language, active, at);
      if (isMockStepTimedOut(active, at)) {
        // Declared timeout: unanswered, no journal event — but the SAME
        // commit path: finishing the last step this way records the summary
        // bookkeeping exactly like a submitted finish (G01).
        commitDeclaredTimeout(active);
      }
    }, 500);
    onCleanup(() => window.clearInterval(interval));
  });

  const start = (blueprint: MockBlueprint) => {
    if (state() !== null || results() !== null) return;
    const startLanguage = props.language;
    const startData = props.languageData;
    const at = Date.now();
    // The eventLog prop is the snapshot the instance binds to (G01: the
    // queue never depends on anything that changes mid-session).
    const instance = assembleMockInstance(blueprint, bank(), props.eventLog, at, at);
    if (instance.steps.length === 0) {
      // Nothing deliverable for the whole level (validation missing):
      // honest empty state, no fabricated session (G04).
      setAssembleEmpty(blueprint.id);
      return;
    }
    setAssembleEmpty(null);
    inMockLock(startLanguage, () => {
      // A language switch while this start waited for the lock aborts: the
      // assembled instance belongs to the captured language, and a queued
      // action must never commit one language's state under another's key
      // (G01/R19 — PlacementSession's queued language-switch guard).
      if (props.language !== startLanguage) return;
      // Another window may have started (or advanced) a session for this
      // language while this start queued behind the lock: ADOPT the durable
      // session instead of clobbering it with a fresh start (G01; the
      // PlacementSession adopt semantics). A durable copy that fails
      // revalidation adopts as idle.
      if (storedMockSessionFingerprint(startLanguage) !== null || state() !== null) {
        adoptDurableSession(startLanguage, startData);
        return;
      }
      // A session that cannot durably keep its cursor must not start:
      // submissions would be refused for lack of a cursor (G01), so the
      // failure is surfaced instead of a silently broken session (G04).
      const fresh = startMockSession(instance, at);
      if (!persistSession(startLanguage, fresh)) {
        setStorageUnavailable(true);
        return;
      }
      setStorageUnavailable(false);
      setState(fresh);
    });
  };

  /** Submits a REAL answer (G01): the payload is derived for the presented
   *  step, the canonical writer records it, and the core applies the
   *  submission bound to the returned attempt id. A click arriving after the
   *  declared ACTIVE budget is exhausted is late: it commits the SAME
   *  declared timeout (unanswered — no journal event), never an answer. */
  const submit = (submission: { kind: 'mcq'; index: number } | { kind: 'typed'; value: string; suppliedBy?: 'keyboard' | 'ime' | 'speech' }) => {
    if (submissionsLocked()) return;
    const active = state();
    if (active !== null && pendingMockAttempt(active) !== null) {
      reconciledPendingId = null;
      reconcilePending(active);
      return;
    }
    if (active === null || step() === null || isMockPaused(active)) return;
    const envelope = { ...submission, stepIndex: active.cursor } as MockSubmission;
    if (isMockStepTimedOut(active, Date.now())) {
      // Declared budget is a hard cutoff (throttled tick, backlog click):
      // late answers are not scored; the single "unanswered" writer is the
      // declared timeout path (no evidence, G01).
      commitDeclaredTimeout(active);
      return;
    }
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    // The submission's snapshot (state, envelope, presented step) is captured
    // BEFORE it queues for the lock: while it waits, another window may
    // advance, pause or finish the shared session. Under the lock the current
    // in-memory AND durable state must still match this snapshot, else the
    // stale submission is dropped (durably adopted) — the journal write only
    // ever happens for the verified presented step (G01). A language switch
    // while it waited aborts the captured-language action entirely (R19).
    // Timing provenance is derived with the ACTUAL post-lock submission
    // time, never the click snapshot.
    const submitLanguage = props.language;
    inMockLock(submitLanguage, async () => {
      if (props.language !== submitLanguage) return;
      if (!verifyOrAdopt(submitLanguage, active)) return;
      // ONE submission timestamp: the payload's declared-budget check and
      // the staged reducer's cutoff must see the SAME instant — a budget
      // expiry BETWEEN them would record journal evidence the reducer then
      // no-ops (evidence without cursor advance, G01).
      const at = Date.now();
      const payload = mockAttemptPayload(active, envelope, at);
      if (payload === null) return;
      // Durable cursor FIRST (PlacementSession `stageDraw` contract): the
      // staged advance is persisted BEFORE the canonical writer is invoked.
      // A failed staged persist REFUSES this submission — no evidence
      // without a cursor — and the presented prompt stays retryable (the
      // learner may answer again once storage recovers, G01/G04).
      const staged = stageMockAnswer(active, envelope, at);
      if (staged === null) return;
      if (!persistSession(submitLanguage, staged)) {
        setStorageUnavailable(true);
        return;
      }
      if (props.language !== submitLanguage) return;
      setStorageUnavailable(false);
      setState(staged);
    });
  };

  /** Explicit pause (R13): recorded, excluded from the item clock. Serialized
   *  like every other mutation: a pause/resume that waited behind the lock
   *  while the shared session moved is dropped with the durable state
   *  adopted (G01) — two windows can never overwrite each other's pause
   *  history. */
  const togglePause = () => {
    const active = state();
    if (active === null || !live() || pendingMockAttempt(active) !== null) return;
    const pauseLanguage = props.language;
    inMockLock(pauseLanguage, () => {
      if (props.language !== pauseLanguage) return;
      if (!verifyOrAdopt(pauseLanguage, active)) return;
      const current = state()!;
      const next = isMockPaused(current) ? resumeMockSession(current, Date.now()) : pauseMockSession(current, Date.now());
      // Durable-first: a pause whose durable write fails is refused (the
      // declared clock keeps running — never an in-memory-only clock
      // boundary the durable state contradicts, G01).
      if (!persistSession(pauseLanguage, next)) {
        setStorageUnavailable(true);
        return;
      }
      setStorageUnavailable(false);
      setState(next);
    });
  };

  /** Abandoning is non-epistemic (G04): answered attempts stand in the
   *  journal, unanswered stay unanswered, results are marked abandoned.
   *  Serialized: an abandon that queued behind the lock while another window
   *  advanced adopts that durable state instead of abandoning a stale copy;
   *  a language switch while it waited aborts (G01/R19). */
  const abandon = () => {
    const active = state();
    if (active === null || !live() || pendingMockAttempt(active) !== null) return;
    const abandonLanguage = props.language;
    inMockLock(abandonLanguage, () => {
      if (props.language !== abandonLanguage) return;
      if (!verifyOrAdopt(abandonLanguage, active)) return;
      commit(abandonLanguage, abandonMockSession(state()!));
    });
  };

  // Cross-window adoption (G01): when ANOTHER window persists the shared
  // session, reload it here so this window never acts on a stale copy (the
  // step it presents may already be answered elsewhere). Self-writes are
  // skipped by fingerprint; a removal (newValue null) from ANY window
  // propagates so a window that never wrote still drops its stale copy.
  // The adoption never writes (raw rebuild), so windows reacting to each
  // other's session writes cannot ping-pong.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== mockSessionStorageKey(props.language)) return;
    if (!locksAvailable()) return; // surface disabled: no live session exists here
    if (event.newValue !== null) {
      try {
        if (mockSessionFingerprint(JSON.parse(event.newValue) as MockSessionState) === lastWrittenSession) return;
      } catch {
        // A corrupt write is adopted: the raw rebuild discards it.
      }
    }
    adoptDurableSession(props.language, props.languageData);
  };
  globalThis.addEventListener('storage', onStorage);
  onCleanup(() => globalThis.removeEventListener('storage', onStorage));

  const closeResults = () => {
    savePendingMockResults(props.language, null);
    setState((current) => current !== null && (current.finishedAt !== undefined || current.abandoned === true) ? null : current);
    setResults(null);
    setSummaries(loadMockSummaries(props.language));
  };

  /** Missed constructions as targeted-output payload (R14): compact learner
   *  context — pattern, localized meaning, level — for the SAME agent. */
  const missedTargets = createMemo(() => {
    const summary = results();
    if (summary === null) return [];
    const targets: { pattern: string; meaning: string; level: number }[] = [];
    for (const row of summary.patterns) {
      if (row.missed === 0) continue;
      const point = (props.languageData.grammar ?? []).find((candidate) => candidate.pattern === row.pattern);
      if (point === undefined) continue;
      targets.push({
        pattern: row.pattern,
        meaning: grammarPointMeaning(point, settings.uiLanguage, props.languageData.meaningLanguage) ?? '',
        level: summary.level,
      });
    }
    return targets;
  });

  const [typedValue, setTypedValue] = createSignal('');
  let typedComposed = false;
  const resetTyped = () => {
    setTypedValue('');
    typedComposed = false;
  };
  const submitTyped = () => {
    if (typedValue().trim().length === 0) return;
    submit({ kind: 'typed', value: typedValue(), ...(typedComposed ? { suppliedBy: 'ime' as const } : { suppliedBy: 'keyboard' as const }) });
    resetTyped();
  };

  return (
    <Show when={blueprints().length > 0 || summaries().length > 0 || live() || results() !== null}>
    <section class="mock-exam" data-testid="mock-exam">
      <div class="mock-exam__header">
        <h3 class="mock-exam__title">{t('mlearn.LevelStudy.Mock.Title')}</h3>
        <span class="mock-exam__subtitle">{t('mlearn.LevelStudy.Mock.Subtitle')}</span>
      </div>

      {/* ── Session view: the fixed queue, no mid-session feedback ── */}
      <Show when={locksAvailable() && live() && step() !== null}>
        <div class="mock-exam__session" data-testid="mock-session" data-blueprint={state()!.instance.blueprint.id}>
          <div class="mock-exam__step-header">
            <span class="mock-exam__progress">
              {t('mlearn.LevelStudy.Mock.Progress', {
                index: String(pendingMockAttempt(state()!) === null
                  ? state()!.cursor + 1
                  : state()!.answers[state()!.answers.length - 1]!.stepIndex + 1),
                total: String(state()!.instance.steps.length),
              })}
            </span>
            <span class="mock-exam__section-name" data-section={step()!.sectionId}>
              {state()!.instance.sections.find((candidate) => candidate.section.id === step()!.sectionId)?.section.category
                ?? t('mlearn.LevelStudy.Mock.Constructions')}
            </span>
            <span class="mock-exam__family-note">
              {t('mlearn.LevelStudy.Mock.FreshFirst')}
            </span>
          </div>
          <div class="mock-exam__step-timer" classList={{ 'mock-exam__step-timer--low': timeLeftMs() < 15_000 }}>
            <span class="mock-exam__timer-label" data-testid="mock-timer">
              {t('mlearn.LevelStudy.Mock.TimeLeft', { seconds: String(Math.ceil(timeLeftMs() / 1000)) })}
            </span>
            <Show when={paused()}>
              <span class="mock-exam__paused-note" data-testid="mock-paused-note">
                {t('mlearn.LevelStudy.Mock.PausedNote')}
              </span>
            </Show>
          </div>
          {/* The delivered item only: context with the removed span. No
              correctness flag, no feedback — fixed exam conditions. */}
          <p class="mock-exam__context" data-item-id={step()!.item.id}>
            {step()!.item.prompt.slice(0, step()!.item.gap.start)}
            <mark class="mock-exam__gap" aria-hidden="true" />
            {step()!.item.prompt.slice(step()!.item.gap.end)}
          </p>
          {/* Delivery is the item's DECLARED format, fixed at assembly. */}
          <Show when={step()!.mode === 'typed'} fallback={
            <div class="mock-exam__options">
              <For each={step()!.item.options}>
                {(option, index) => (
                  <button
                    type="button"
                    class="mock-exam__option"
                    data-option={option.text}
                    disabled={submissionsLocked() || paused()}
                    onClick={(click) => { if (click.detail > 1) return; submit({ kind: 'mcq', index: index() }); }}
                    onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                  >
                    {option.text}
                  </button>
                )}
              </For>
            </div>
          }>
            <div class="mock-exam__typed">
              <input
                type="text"
                class="mock-exam__typed-input"
                autocomplete="off"
                spellcheck={false}
                aria-label={t('mlearn.LevelStudy.Grammar.TypePlaceholder')}
                placeholder={t('mlearn.LevelStudy.Grammar.TypePlaceholder')}
                value={typedValue()}
                disabled={submissionsLocked() || paused()}
                onInput={(event) => setTypedValue(event.currentTarget.value)}
                onCompositionStart={() => { typedComposed = true; }}
                onKeyDown={(key) => {
                  if (key.repeat) key.preventDefault();
                  else if (key.isComposing) return;
                  else if (key.key === 'Enter') {
                    key.preventDefault();
                    submitTyped();
                  }
                }}
              />
              <button
                type="button"
                class="mock-exam__control-btn"
                data-testid="mock-typed-submit"
                disabled={submissionsLocked() || paused() || typedValue().trim().length === 0}
                onClick={(click) => { if (click.detail > 1) return; submitTyped(); }}
                onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
              >
                {t('mlearn.LevelStudy.Grammar.Check')}
              </button>
            </div>
          </Show>
          <div class="mock-exam__controls">
            <button
              type="button"
              class="mock-exam__control-btn"
              data-testid="mock-pause-btn"
              onClick={(click) => { if (click.detail > 1) return; togglePause(); }}
              onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
            >
              {paused() ? t('mlearn.LevelStudy.Mock.Resume') : t('mlearn.LevelStudy.Mock.Pause')}
            </button>
            <button
              type="button"
              class="mock-exam__control-btn mock-exam__control-btn--danger"
              data-testid="mock-abandon-btn"
              onClick={(click) => { if (click.detail > 1) return; abandon(); }}
              onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
            >
              {t('mlearn.LevelStudy.Mock.Abandon')}
            </button>
            <span class="mock-exam__policy-note">{t('mlearn.LevelStudy.Mock.PausePolicy')}</span>
          </div>
          {/* A refused durable write is surfaced, never silent: the presented
              prompt stays retryable and the next attempt re-tries the write
              (PlacementSession contract, G01/G04). */}
          <Show when={storageUnavailable()}>
            <button
              type="button"
              class="mock-exam__empty"
              data-testid="mock-storage-unavailable"
              onClick={() => {
                const current = state();
                if (current !== null && pendingMockAttempt(current) !== null) {
                  reconciledPendingId = null;
                  reconcilePending(current);
                }
              }}
            >
              {t('mlearn.LevelStudy.Mock.StorageUnavailable')}
            </button>
          </Show>
        </div>
      </Show>

      {/* ── Results view: provenance, never an official score ── */}
      <Show when={results()} keyed>
        {(summary) => (
          <div class="mock-exam__results" data-testid="mock-results">
            <div class="mock-exam__results-header">
              <span class="mock-exam__results-title">
                {t('mlearn.LevelStudy.Mock.ResultsTitle', { level: summary.levelLabel })}
              </span>
              <span class="mock-exam__chip">{t('mlearn.LevelStudy.Mock.ProviderChip')}</span>
              <Show when={summary.abandoned}>
                <span class="mock-exam__abandoned" data-testid="mock-results-abandoned">
                  {t('mlearn.LevelStudy.Mock.Abandoned')}
                </span>
              </Show>
            </div>
            <div class="mock-exam__totals">
              <span>{t('mlearn.LevelStudy.Mock.Answered', { count: String(summary.totalAnswered) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.Correct', { count: String(summary.totalCorrect) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.TimedOut', { count: String(summary.totalTimedOut) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.HeldOut', { count: String(summary.freshFamilyCount) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.RehearsedBackfill', { count: String(summary.rehearsedFamilyCount) })}</span>
            </div>
            <details class="mock-exam__provenance" data-testid="mock-results-provenance">
              <summary>{t('mlearn.Knowledge.Projection.Relations.Advanced')}</summary>
              <span>{t('mlearn.LevelStudy.Mock.BlueprintVersion', { version: summary.blueprintVersion })}</span>
              <Show when={summary.contentVersion !== undefined}>
                <span>{t('mlearn.LevelStudy.Mock.ContentVersion', { version: summary.contentVersion! })}</span>
              </Show>
              <span>{t('mlearn.LevelStudy.Mock.Seed', { seed: String(summary.seed) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.ActiveTime', { seconds: String(fmtSeconds(summary.activeMs)) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.PausedTime', { seconds: String(fmtSeconds(summary.pausedMs)), count: String(summary.pauseCount) })}</span>
            </details>
            <table class="mock-exam__sections" data-testid="mock-results-sections">
              <thead>
                <tr>
                  <th>{t('mlearn.LevelStudy.Mock.SectionCol')}</th>
                  <th>{t('mlearn.LevelStudy.Mock.DrawCol')}</th>
                  <th>{t('mlearn.LevelStudy.Mock.AnsweredCol')}</th>
                  <th>{t('mlearn.LevelStudy.Mock.CorrectCol')}</th>
                  <th>{t('mlearn.LevelStudy.Mock.TimedOutCol')}</th>
                </tr>
              </thead>
              <tbody>
                <For each={summary.sections}>
                  {(section) => (
                    <tr data-section={section.sectionId}>
                      <td>{section.category ?? t('mlearn.LevelStudy.Mock.Constructions')}</td>
                      <td>{t('mlearn.LevelStudy.Mock.Assembled', { requested: String(section.requestedCount), assembled: String(section.assembledCount) })}</td>
                      <td>{String(section.answered)}</td>
                      <td>{String(section.correct)}</td>
                      <td>{String(section.timedOut)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={summary.availabilityGap}>
              <span class="mock-exam__gap-warning" data-testid="mock-availability-gap">
                {t('mlearn.LevelStudy.Mock.AvailabilityGap')}
              </span>
            </Show>
            <div class="mock-exam__patterns" data-testid="mock-missed-patterns">
              <span class="mock-exam__patterns-title">{t('mlearn.LevelStudy.Mock.MissedPatterns')}</span>
              <Show when={missedTargets().length > 0} fallback={
                <span class="mock-exam__no-missed">{t('mlearn.LevelStudy.Mock.NoMissed')}</span>
              }>
                <For each={missedTargets()}>
                  {(target) => (
                    <span class="mock-exam__pattern-row" data-pattern={target.pattern}>
                      <span class="mock-exam__pattern">{target.pattern}</span>
                      <Show when={target.meaning}>
                        <span class="mock-exam__pattern-meaning">{target.meaning}</span>
                      </Show>
                    </span>
                  )}
                </For>
                <div class="mock-exam__repair">
                  <button
                    type="button"
                    class="mock-exam__control-btn"
                    data-testid="mock-repair-btn"
                    onClick={(click) => { if (click.detail > 1) return; props.onRepair(summary.level); }}
                    onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                  >
                    {t('mlearn.LevelStudy.Mock.Repair')}
                  </button>
                  <Show when={props.onTargetedOutput !== undefined}>
                    <button
                      type="button"
                      class="mock-exam__control-btn"
                      data-testid="mock-output-btn"
                      onClick={(click) => { if (click.detail > 1) return; props.onTargetedOutput?.(missedTargets()); }}
                      onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                    >
                      {t('mlearn.LevelStudy.Mock.Discuss')}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
            <div class="mock-exam__disclaimer" data-testid="mock-disclaimer">
              {t('mlearn.LevelStudy.Mock.ResultsDisclaimer')}
            </div>
            <button
              type="button"
              class="mock-exam__control-btn"
              data-testid="mock-close-results"
              onClick={(click) => { if (click.detail > 1) return; closeResults(); }}
              onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
            >
              {t('mlearn.LevelStudy.Mock.BackToBlueprints')}
            </button>
          </div>
        )}
      </Show>

      {/* ── Idle view: declared blueprints + bounded summaries ── */}
      <Show when={results() === null && !live()}>
        <div class="mock-exam__blueprints" data-testid="mock-blueprints">
          {/* Without a Web Lock the session surface is disabled (G04): an
              honest localized note replaces the Start affordances — never an
              unserialized multi-window session. */}
          <Show when={locksAvailable()} fallback={
            <span class="mock-exam__empty" data-testid="mock-no-locks">{t('mlearn.LevelStudy.Mock.NoLocks')}</span>
          }>
          <Show when={storageUnavailable()}>
            <span class="mock-exam__empty" data-testid="mock-storage-unavailable">
              {t('mlearn.LevelStudy.Mock.StorageUnavailable')}
            </span>
          </Show>
          <Show when={blueprints().length > 0} fallback={
            <span class="mock-exam__empty">{t('mlearn.LevelStudy.Mock.NoBlueprints')}</span>
          }>
            <For each={blueprints()}>
              {(blueprint) => (
                <div class="mock-exam__blueprint" data-blueprint={blueprint.id}>
                  <span class="mock-exam__blueprint-level">{blueprint.levelLabel}</span>
                  <span class="mock-exam__chip">{t('mlearn.LevelStudy.Mock.ProviderChip')}</span>
                  <span class="mock-exam__blueprint-meta">
                    {t('mlearn.LevelStudy.Mock.BlueprintMeta', {
                      sections: String(blueprint.sections.length),
                      draw: String(blueprint.sections.reduce((total, section) => total + section.requestedCount, 0)),
                      seconds: String(blueprint.timing.perItemSeconds),
                    })}
                  </span>
                  <button
                    type="button"
                    class="mock-exam__control-btn"
                    data-testid={`mock-start-${blueprint.level}`}
                    onClick={(click) => { if (click.detail > 1) return; start(blueprint); }}
                    onKeyDown={(key) => { if (key.repeat) key.preventDefault(); }}
                  >
                    {t('mlearn.LevelStudy.Mock.Start')}
                  </button>
                  <Show when={assembleEmpty() === blueprint.id}>
                    <span class="mock-exam__empty" data-testid="mock-assemble-empty">
                      {t('mlearn.LevelStudy.Mock.NoItems')}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
          </Show>
        </div>
        <Show when={summaries().length > 0}>
          <div class="mock-exam__summaries" data-testid="mock-summaries">
            <span class="mock-exam__summaries-title">{t('mlearn.LevelStudy.Mock.Summaries')}</span>
            <For each={summaries()}>
              {(summary) => (
                <div class="mock-exam__summary-row" data-testid="mock-summary-row" data-blueprint={summary.blueprintId}>
                  <span>{summary.levelLabel}</span>
                  <span>
                    {t('mlearn.LevelStudy.Mock.SummaryCounts', {
                      correct: String(summary.totalCorrect),
                      answered: String(summary.totalAnswered),
                      timedOut: String(summary.totalTimedOut),
                    })}
                  </span>
                  <Show when={summary.abandoned}>
                    <span class="mock-exam__abandoned">{t('mlearn.LevelStudy.Mock.Abandoned')}</span>
                  </Show>
                  <span>{new Date(summary.startedAt).toLocaleString()}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
    </Show>
  );
};

export default MockExam;
