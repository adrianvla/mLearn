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
  pauseMockSession,
  presentedMockStep,
  resumeMockSession,
  saveMockSummary,
  savePendingMockResults,
  saveStoredMockSession,
  startMockSession,
  summarizeMockResults,
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
import './MockExam.css';

export interface MockExamProps {
  language: string;
  languageData: LanguageData;
  /** Capability-scoped journal for the language (already loaded by the tab). */
  eventLog: KnowledgeEventLog;
  /** Canonical journal writer — the SAME provider the practice walks use.
   *  Returns the attempt id the session binds to its answer (G01: a real
   *  submission without the writer's id is rejected by the core). */
  onAttempt: (payload: MockJournalPayload) => AttemptId;
  /** Opens the SAME TeachingPolicy practice walk for the level (R13: repair
   *  through the existing policy, never a second scheduler). */
  onRepair: (level: number) => void;
  /** Passes the missed constructions into the EXISTING conversation agent —
   *  the one conversation implementation (R14 targeted output). */
  onTargetedOutput?: (targets: readonly { pattern: string; meaning: string; level: number }[]) => void;
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

  const [state, setState] = createSignal<MockSessionState | null>(
    loadStoredMockSession(props.language, props.languageData),
  );
  const [results, setResults] = createSignal<MockResults | null>(loadPendingMockResults(props.language));
  const [summaries, setSummaries] = createSignal<MockResults[]>(loadMockSummaries(props.language));
  /** A blueprint whose sections assembled ZERO deliverable items (G04). */
  const [assembleEmpty, setAssembleEmpty] = createSignal<string | null>(null);
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
   *  under another's key (R19/G01). */
  createEffect(on([() => props.language, () => props.languageData], ([language, data]) => {
    setSubmissionsLocked(false);
    clearTimeout(submissionLockTimer);
    setResults(loadPendingMockResults(language));
    setAssembleEmpty(null);
    setSummaries(loadMockSummaries(language));
    setState(loadStoredMockSession(language, data));
    setNow(0);
  }, { defer: true }));

  /** Terminal transitions record the summary bookkeeping and clear the
   *  stored in-progress session (never a finished/abandoned session). */
  const commit = (next: MockSessionState) => {
    setState(next);
    if (next.finishedAt !== undefined || next.abandoned === true) {
      const summary = summarizeMockResults(next);
      setResults(summary);
      saveMockSummary(props.language, summary);
      savePendingMockResults(props.language, summary);
      saveStoredMockSession(props.language, null);
    } else {
      saveStoredMockSession(props.language, next);
    }
  };

  const live = createMemo(() => {
    const active = state();
    return active !== null && active.finishedAt === undefined && active.abandoned !== true;
  });
  const step = createMemo(() => {
    const active = state();
    return active === null ? null : presentedMockStep(active);
  });
  const paused = createMemo(() => state() !== null && isMockPaused(state()!));

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
    if (!live() || paused()) return;
    const interval = window.setInterval(() => {
      const active = state();
      if (active === null || !live() || isMockPaused(active)) return;
      const at = Date.now();
      setNow(at);
      if (isMockStepTimedOut(active, at)) {
        // Declared timeout: unanswered, no journal event — but the SAME
        // commit path: finishing the last step this way records the summary
        // bookkeeping exactly like a submitted finish (G01).
        commit(applyMockAnswer(active, { kind: 'timeout', stepIndex: active.cursor }, undefined, at));
      }
    }, 500);
    onCleanup(() => window.clearInterval(interval));
  });

  const start = (blueprint: MockBlueprint) => {
    if (state() !== null || results() !== null) return;
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
    commit(startMockSession(instance, at));
  };

  /** Submits a REAL answer (G01): the payload is derived for the presented
   *  step, the canonical writer records it, and the core applies the
   *  submission bound to the returned attempt id. A click arriving after the
   *  declared ACTIVE budget is exhausted is late: it commits the SAME
   *  declared timeout (unanswered — no journal event), never an answer. */
  const submit = (submission: { kind: 'mcq'; index: number } | { kind: 'typed'; value: string; suppliedBy?: 'keyboard' | 'ime' | 'speech' }) => {
    if (submissionsLocked()) return;
    const active = state();
    if (active === null || step() === null || isMockPaused(active)) return;
    const envelope = { ...submission, stepIndex: active.cursor } as MockSubmission;
    const at = Date.now();
    if (isMockStepTimedOut(active, at)) {
      // Declared budget is a hard cutoff (throttled tick, backlog click):
      // late answers are not scored; the single "unanswered" writer is the
      // declared timeout path (no evidence, G01).
      commit(applyMockAnswer(active, { kind: 'timeout', stepIndex: active.cursor }, undefined, at));
      return;
    }
    const payload = mockAttemptPayload(active, envelope, at);
    if (payload === null) return;
    setSubmissionsLocked(true);
    clearTimeout(submissionLockTimer);
    submissionLockTimer = window.setTimeout(() => setSubmissionsLocked(false), 150);
    const attemptId = props.onAttempt(payload);
    commit(applyMockAnswer(active, envelope, attemptId, at));
  };

  /** Explicit pause (R13): recorded, excluded from the item clock. */
  const togglePause = () => {
    const active = state();
    if (active === null || !live()) return;
    const at = Date.now();
    const next = isMockPaused(active) ? resumeMockSession(active, at) : pauseMockSession(active, at);
    setState(next);
    saveStoredMockSession(props.language, next);
  };

  /** Abandoning is non-epistemic (G04): answered attempts stand in the
   *  journal, unanswered stay unanswered, results are marked abandoned. */
  const abandon = () => {
    const active = state();
    if (active === null || !live()) return;
    commit(abandonMockSession(active));
  };

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
    <section class="mock-exam" data-testid="mock-exam">
      <div class="mock-exam__header">
        <h3 class="mock-exam__title">{t('mlearn.LevelStudy.Mock.Title')}</h3>
        <span class="mock-exam__subtitle">{t('mlearn.LevelStudy.Mock.Subtitle')}</span>
      </div>

      {/* ── Session view: the fixed queue, no mid-session feedback ── */}
      <Show when={live() && step() !== null}>
        <div class="mock-exam__session" data-testid="mock-session" data-blueprint={state()!.instance.blueprint.id}>
          <div class="mock-exam__step-header">
            <span class="mock-exam__progress">
              {t('mlearn.LevelStudy.Mock.Progress', {
                index: String(state()!.cursor + 1),
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
            <div class="mock-exam__provenance" data-testid="mock-results-provenance">
              <span>{t('mlearn.LevelStudy.Mock.BlueprintVersion', { version: summary.blueprintVersion })}</span>
              <Show when={summary.contentVersion !== undefined}>
                <span>{t('mlearn.LevelStudy.Mock.ContentVersion', { version: summary.contentVersion! })}</span>
              </Show>
              <span>{t('mlearn.LevelStudy.Mock.Seed', { seed: String(summary.seed) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.ActiveTime', { seconds: String(fmtSeconds(summary.activeMs)) })}</span>
              <span>{t('mlearn.LevelStudy.Mock.PausedTime', { seconds: String(fmtSeconds(summary.pausedMs)), count: String(summary.pauseCount) })}</span>
            </div>
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
  );
};

export default MockExam;
