import { useKnowledgeProjections } from '../../hooks/useKnowledgeProjections';
import { projectedWordStatus } from '../../../shared/graph/targets';
import { Component, createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useLocalization, useFlashcards, useLanguage, useSettings } from '../../context';
import { LevelCard } from './LevelCard';
import { LevelDetailModal } from './LevelDetailModal';
import { BulkAddModal } from './BulkAddModal';
import { GrammarCoverage } from './GrammarCoverage';
import MockExam from './MockExam';
import PlacementSession, { backgroundRecordsForLanguage } from './PlacementSession';
import { summarizeGrammarCurriculum } from '../../utils/curriculumCoverage';
import { declaredItemStates, questionBankFromLanguageData } from '../../learning/questionBank';
import { languageDataWithStoredQuestionValidations } from '../../learning/questionValidation';
import type { MockJournalPayload } from '../../learning/mockExam';
import type { AttemptId } from '../../../shared/knowledgeEvents';
import { isLLMReady } from '../../services/llmProvider';
import { effectiveThresholds } from '../../../shared/knowledge/effectiveKnowledge';
import { eventsVersion, queryLanguageKeys } from '../../services/knowledgeEvents';
import { createResource } from 'solid-js';
import {
  computeBeyondExamLevelStats,
  computeLevelStats,
  getLevelStudyFrequency,
  getLevelStudyLevelNames,
  getWordLevelStatus,
  wordStorageKey,
} from '../../utils/wordLevelStats';
import { EmptyState, TargetIcon, Btn, PillBtn, SkeletonCard, SkeletonRows } from '../../components/common';
import { getWordFormCandidates } from '../../../shared/utils/wordForms';
import type { LevelStats } from '../../utils/wordLevelStats';
import {
  getFrequencyLevelLabel,
  getLearningLanguageLevelForLanguage,
  isFrequencyLevelAtOrEasierThanTarget,
  sortFrequencyLevelsByDifficulty,
} from '../../../shared/languageFeatures';
import { DEFAULT_SETTINGS, type LanguageData } from '../../../shared/types';
import type { AttemptTiming } from '../../../shared/encounterTiming';
import type { AttemptQuality } from '../../../shared/constants';
import type { HistoricalBackgroundRecord } from '../../../shared/learningBackground';
import { getBridge } from '../../../shared/bridges';

function resolveLevelStudyLanguage(
  selectedLanguage: string,
  installedLanguages: string[],
): string {
  if (selectedLanguage) return selectedLanguage;
  return installedLanguages.length === 1 ? installedLanguages[0] ?? '' : '';
}

function resolveLevelStudyLanguageData(
  selectedLanguage: string,
  installedLanguages: string[],
  currentLanguageData: LanguageData | null,
  installedLanguageData: Record<string, LanguageData>,
): { language: string; data: LanguageData | null } {
  if (currentLanguageData) {
    return {
      language: selectedLanguage,
      data: currentLanguageData,
    };
  }

  const language = resolveLevelStudyLanguage(selectedLanguage, installedLanguages);
  return {
    language,
    data: language ? installedLanguageData[language] ?? null : null,
  };
}

export const LevelStudyTab: Component = () => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const language = useLanguage();
  const { settings, updateSettings } = useSettings();
  const getCanonicalFormForLanguage = language.getCanonicalFormForLanguage;
  const getWordVariantsForLanguage = language.getWordVariantsForLanguage;
  const [selectedLevel, setSelectedLevel] = createSignal<LevelStats | null>(null);
  const [showBulkAdd, setShowBulkAdd] = createSignal(false);
  // Question-validation record store (R12) is non-reactive localStorage: this
  // version bumps after each run so the resolved data re-applies fresh records.
  const [validationsVersion, setValidationsVersion] = createSignal(0);
  let lastEmptyRefreshLanguage: string | null = null;

  const resolvedLanguageData = createMemo(() => {
    validationsVersion();
    const resolved = resolveLevelStudyLanguageData(
      settings.language,
      language.supportedLanguages(),
      language.currentLangData(),
      language.langData,
    );
    return resolved.data === null || resolved.language === ''
      ? resolved
      : { ...resolved, data: languageDataWithStoredQuestionValidations(resolved.language, resolved.data) };
  });

  const frequency = createMemo(() => {
    const langData = resolvedLanguageData().data;
    return langData ? getLevelStudyFrequency(langData) : {};
  });

  const levelNames = createMemo(() => {
    const langData = resolvedLanguageData().data;
    return langData ? getLevelStudyLevelNames(langData, frequency()) : {};
  });

  // F-N1 bound: request projections ONLY for evidence-bearing surfaces. A
  // word without stored state is unmeasured by definition — its projection
  // is empty and materializing it wastes an IPC round-trip per word per
  // reload (49k+ on the German package → the archived renderer OOM). The
  // candidate set is the JOURNAL keys (epistemic source of truth) unioned
  // with the materialized store keys (conservative superset that also
  // covers pre-journal legacy rows). Projections are requested only AFTER
  // the journal snapshot settles; while it loads, no request is issued. If
  // the snapshot query FAILS, the store-derived subset becomes the bound
  // (safe error policy, F-N1) and the resource retries on the next
  // eventsVersion change.
  const [journalKeysResource] = createResource(
    // No `projected.loading` here: journal keys must settle BEFORE the
    // projection request is built (circular otherwise). eventsVersion makes
    // the snapshot refresh after new evidence is appended.
    () => (flashcards.isKnowledgeReady() && !language.isLoading()
      ? { language: resolvedLanguageData().language || '', version: eventsVersion() }
      : undefined),
    async (source: { language: string; version: number }) => new Set(await queryLanguageKeys(source.language)),
  );
  // Settled = resolved OR errored: either way the store subset is the safe
  // bound and the projection request may proceed (never all surfaces).
  // 'errored' also permits the (store-subset) projection request so stats
  // stay populated, but it does NOT count as healthy for placement pool
  // selection: journal-only measured words must not look untracked.
  const journalKeysSettled = createMemo(() => journalKeysResource.state === 'ready' || journalKeysResource.state === 'errored');
  const journalKeysHealthy = createMemo(() => journalKeysResource.state === 'ready');
  const measuredStorageKeys = createMemo(() => new Set(Object.keys(flashcards.store?.wordKnowledge ?? {})));
  const projectionSurfaces = createMemo(() => {
    const lang = resolvedLanguageData().language;
    if (!lang) return [];
    const freqKeys = Object.keys(frequency());
    // After settlement a failed journal query falls back to the
    // store-derived subset ONLY (never the full package — that is the F-N1
    // fan-out) and never fabricates measured surfaces. While loading, the
    // query gate withholds the request entirely. An errored resource
    // throws on access: only a ready snapshot is read.
    const keys = new Set(journalKeysResource.state === 'ready' ? journalKeysResource() ?? [] : []);
    for (const key of measuredStorageKeys()) keys.add(key);
    if (keys.size === 0) return [];
    const canonicalize = (language: string, word: string) => getCanonicalFormForLanguage(language, word);
    // Match the writer-side identity exactly: journal keys are derived from
    // getWordFormCandidates(...)[0] (canonical, script-converted, or a
    // package-declared variant), so test every candidate form, not just the
    // raw surface and its canonical form.
    return freqKeys.filter((word) => {
      const candidates = getWordFormCandidates(word, (w) => canonicalize(lang, w), (w) => getWordVariantsForLanguage(lang, w), { language: lang, languageData: resolvedLanguageData().data });
      // The writer persists one hash per candidate form WITHOUT a second
      // canonicalization (FlashcardContext getWordFormsForLanguage →
      // langKey(hash(form))), so test each candidate's raw storage key.
      return candidates.some((c) => keys.has(wordStorageKey(lang, c)));
    });
  });

  const projected = useKnowledgeProjections(() => flashcards.isKnowledgeReady() && !language.isLoading() && journalKeysSettled()
    ? { language: resolvedLanguageData().language, surfaces: projectionSurfaces() } : undefined);

  const stats = createMemo(() => {
    if (flashcards.isLoading() || projected.loading()) return [];
    const resolved = resolvedLanguageData();
    const langData = resolved.data;
    if (!langData) return [];
    const freq = frequency();
    if (!freq || Object.keys(freq).length === 0) return [];
    return computeLevelStats(
      flashcards.store,
      freq,
      resolved.language,
      settings.easeThresholdKnown * 1000,
      settings.easeThresholdLearning * 1000,
      levelNames(),
      langData,
      undefined,
      (word) => {
        // Surfaces are bounded to evidence-bearing words (F-N1): an absent
        // projection means unmeasured, never unknown.
        const projection = projected.projections().get(word);
        return projection ? projectedWordStatus(projection) : { status: 'unknown' as const, basis: 'unmeasured' as const };
      },
    );
  });

  const beyondCard = createMemo<LevelStats | null>(() => {
    if (flashcards.isLoading() || projected.loading()) return null;
    const resolved = resolvedLanguageData();
    const langData = resolved.data;
    if (!langData) return null;
    const freq = frequency();
    if (!freq || Object.keys(freq).length === 0) return null;
    const beyond = computeBeyondExamLevelStats(
      flashcards.store,
      freq,
      resolved.language,
      settings.easeThresholdKnown * 1000,
      settings.easeThresholdLearning * 1000,
      levelNames(),
      langData,
      undefined,
      (word) => {
        const projection = projected.projections().get(word);
        return projection ? projectedWordStatus(projection) : { status: 'unknown' as const, basis: 'unmeasured' as const };
      },
    );
    return beyond != null ? { ...beyond, name: t('mlearn.LevelStudy.LevelCard.BeyondExam') } : null;
  });

  const userLevel = createMemo(() => (
    getLearningLanguageLevelForLanguage(settings, resolvedLanguageData().language || null)
  ));

  const userLevelLabel = createMemo(() => {
    const level = userLevel();
    if (level === null) return '';
    return getFrequencyLevelLabel(level, levelNames(), resolvedLanguageData().data);
  });

  const scopedStats = createMemo(() => {
    const level = userLevel();
    if (level === null) return stats();
    return stats().filter((levelStat) => (
      isFrequencyLevelAtOrEasierThanTarget(levelStat.level, level, resolvedLanguageData().data)
    ));
  });

  const coverageTotals = createMemo(() => {
    const totals = { known: 0, learning: 0, unknown: 0, untracked: 0 };
    for (const levelStat of scopedStats()) {
      totals.known += levelStat.known;
      totals.learning += levelStat.learning;
      totals.unknown += levelStat.unknown;
      totals.untracked += levelStat.untracked;
    }
    const total = totals.known + totals.learning + totals.unknown + totals.untracked;
    return {
      ...totals,
      total,
      tracked: total - totals.untracked,
      complete: total > 0 && totals.untracked === 0,
    };
  });

  const coverageWidths = createMemo(() => {
    const { known, learning, unknown, untracked, total } = coverageTotals();
    if (total === 0) return { known: 0, learning: 0, unknown: 0, untracked: 0 };
    const pct = (count: number) => (count / total) * 100;
    return { known: pct(known), learning: pct(learning), unknown: pct(unknown), untracked: pct(untracked) };
  });

  const hasFrequencyData = createMemo(() => stats().length > 0 || beyondCard() !== null);

  // ─── Returning-learner placement (R09) ──────────────
  /** Live untracked pools per package level, difficulty-ascending, capped
   *  per level: the cross-section the placement probe can draw from. */
  const PLACEMENT_POOL_CAP = 6;
  const placementPools = createMemo(() => {
    const resolved = resolvedLanguageData();
    const langData = resolved.data;
    if (!langData || flashcards.isLoading() || projected.loading()) return [];
    const freq = frequency();
    if (Object.keys(freq).length === 0) return [];
    const projections = projected.projections();
    const byLevel = new Map<number, string[]>();
    // Every DECLARED level participates, even when its rows appear late in a
    // frequency-ordered table: an easy-band-heavy prefix must never hide the
    // harder bands from a category-balanced probe (R09).
    const declaredLevels = Object.keys(levelNames())
      .map((key) => Number(key))
      .filter((level) => Number.isFinite(level));
    const full = new Set<number>();
    let fullDeclared = 0;
    for (const level of declaredLevels) byLevel.set(level, []);
    for (const [word, entry] of Object.entries(freq)) {
      if (fullDeclared === declaredLevels.length) break; // every declared band capped
      if (full.has(entry.raw_level)) continue;
      // Surfaces are bounded to evidence-bearing words (F-N1): an absent
      // projection is unmeasured, i.e. an untracked placement candidate.
      const projection = projections.get(word);
      const status = projection ? getWordLevelStatus(projectedWordStatus(projection)) : 'untracked';
      if (status !== 'untracked') continue;
      // G04 ignore policy: an ignored word stays epistemically unmeasured but is
      // NEVER selected, taught or tested — exclude it before it can be sampled.
      if (flashcards.isWordIgnoredSync(word, resolved.language)) continue;
      const bucket = byLevel.get(entry.raw_level);
      if (bucket === undefined) {
        // Undeclared level: keep it offerable, but it cannot satisfy the
        // declared-level stop condition on its own.
        byLevel.set(entry.raw_level, [word]);
        continue;
      }
      if (bucket.length >= PLACEMENT_POOL_CAP) {
        full.add(entry.raw_level);
        if (declaredLevels.includes(entry.raw_level)) fullDeclared += 1;
        continue;
      }
      bucket.push(word);
      if (bucket.length >= PLACEMENT_POOL_CAP) {
        full.add(entry.raw_level);
        if (declaredLevels.includes(entry.raw_level)) fullDeclared += 1;
      }
    }
    const names = levelNames();
    return sortFrequencyLevelsByDifficulty([...byLevel.keys()], langData)
      .map((level) => ({
        level,
        label: getFrequencyLevelLabel(level, names, langData),
        words: byLevel.get(level) ?? [],
      }))
      .filter((pool) => pool.words.length > 0);
  });

  const placementBackground = createMemo(() => backgroundRecordsForLanguage(
    (settings.learningBackground ?? DEFAULT_SETTINGS.learningBackground).records,
    resolvedLanguageData().language,
  ));

  const addBackground = (record: HistoricalBackgroundRecord) => {
    const current = settings.learningBackground ?? DEFAULT_SETTINGS.learningBackground;
    updateSettings({ learningBackground: { records: [...current.records, record] } });
  };

  const removeBackground = (id: string) => {
    const current = settings.learningBackground ?? DEFAULT_SETTINGS.learningBackground;
    updateSettings({ learningBackground: { records: current.records.filter((record) => record.id !== id) } });
  };

  const placementLanguage = createMemo(() => resolvedLanguageData().language);

  /** True while the tab's projections/knowledge are (re)loading — e.g. right
   *  after a placement rating bumped eventsVersion. PlacementSession stays
   *  mounted through these flips; this only hides its DOM and stops timing. */
  const placementBooting = createMemo(() => (
    flashcards.isLoading() || !flashcards.isKnowledgeReady() || language.isLoading() || projected.loading() || !journalKeysHealthy()
  ));

  const recordPlacementAttempt = (word: string, _level: number, quality: AttemptQuality, timing: AttemptTiming | null) => {
    void flashcards.recordAttempt(word, 'surface-recognition', quality, {
      language: placementLanguage(),
      origin: 'placement',
      taskType: 'placement',
      ...(timing ? { timing } : {}),
    });
  };

  const applyPlacement = (level: number) => {
    updateSettings({
      learningLanguageLevels: {
        ...(settings.learningLanguageLevels ?? {}),
        [placementLanguage()]: level,
      },
    });
  };



  // Grammar curriculum coverage aggregates over the package's OWN grammar
  // scale (grammarLevels), from the capability-scoped journal.
  const [grammarLog] = createResource(
    () => (flashcards.isKnowledgeReady() && !language.isLoading() ? { language: resolvedLanguageData().language, version: eventsVersion() } : undefined),
    async (source) => {
      // Grammar rows are ledger-exact (source 'grammar' never aggregates), so
      // the grammar-key slice of exact rows is the full curriculum evidence.
      const keys = await queryLanguageKeys(source.language, 'grammar:');
      return keys.length > 0 ? await getBridge().knowledgeEvents.queryKnowledgeEvents(keys) : {};
    },
  );
  const grammarSummary = createMemo(() => {
    const data = resolvedLanguageData().data;
    const log = grammarLog();
    if (!data || !log || resolvedLanguageData().language === '') return null;
    // Vocabulary-only packages: no grammar gate at all.
    if (!data.grammar?.length) return null;
    return summarizeGrammarCurriculum(resolvedLanguageData().language, data, log, effectiveThresholds(settings));
  });
  // Package-update invalidation (G03): once the grammar evidence for this
  // language is loaded, retire attempts recorded through practice items the
  // CURRENT package no longer declares, whose recorded itemRef version no
  // longer matches the item content (span/conditions/distractors/accepts
  // changed), or that are currently invalid (deterministically or
  // semantically rejected). Unreviewed unchanged items keep their attempts.
  // Idempotent (already-retracted attempts are skipped), bounded to grammar
  // keys and pure assembly (no LLM), and run off the rating path; guarded per
  // language AND package content version so a package replacement inside one
  // mounted tab re-runs the reconcile for the new declaration set.
  const reconciledItemPackages = new Set<string>();
  createEffect(() => {
    const log = grammarLog();
    const data = resolvedLanguageData().data;
    const lang = resolvedLanguageData().language;
    if (!log || !data || lang === '') return;
    const guardKey = `${lang}:${data.languageData?.version ?? ''}`;
    if (reconciledItemPackages.has(guardKey)) return;
    reconciledItemPackages.add(guardKey);
    void flashcards.reconcileGrammarItems(lang, declaredItemStates(questionBankFromLanguageData(lang, data)));
  });
  const levelComplete = createMemo(() => (
    coverageTotals().complete && (grammarSummary() === null || grammarSummary()!.complete)
  ));

  const openBehaviourSettings = () => {
    getBridge().window.openWindow({ type: 'settings', context: { section: 'behaviour' } });
  };

  // ─── Checkpoints & mocks (R13/R14) ──────────────
  /** Mock repair request: the SAME TeachingPolicy walk re-plans for the
   *  level (GrammarCoverage consumes it; a live walk is never replaced). */
  const [mockRepairRequest, setMockRepairRequest] = createSignal<{ level: number; requestedAt: number } | null>(null);
  /** Canonical journal write for a mock attempt: the SAME writer the
   *  practice walks use, carrying `mock-contrast`/`mock-typed` task
   *  provenance plus the versioned item reference (G03). */
  const recordMockAttempt = (payload: MockJournalPayload, attemptId: AttemptId): Promise<AttemptId> =>
    flashcards.recordGrammarAttemptAcknowledged(payload.pattern, payload.quality, {
      language: resolvedLanguageData().language,
      level: payload.level,
      ...(payload.scaffolds !== undefined ? { scaffolds: payload.scaffolds } : {}),
      itemRef: payload.itemRef,
      validationRef: payload.validationRef,
      taskType: payload.taskType,
      attemptId,
    });
  /** Targeted output (R14): the missed constructions pass into the SAME
   *  conversation agent experience. An unconfigured LLM routes to Settings
   *  → AI instead of opening an agent that cannot run (same gate as the
   *  home tutor). */
  const openTargetedOutput = (targets: readonly { pattern: string; meaning: string; level: number }[]) => {
    if (!isLLMReady(settings)) {
      getBridge().window.openWindow({
        type: 'settings',
        context: { section: 'ai' } as unknown as Record<string, unknown>,
      });
      return;
    }
    getBridge().window.openWindow({
      type: 'conversation-agent',
      context: {
        tutorConfig: {
          selectedGrammar: targets.map((target) => ({ pattern: target.pattern, meaning: target.meaning, level: target.level })),
          selectedWords: [],
          selectedMedia: [],
          customInstructions: '',
        },
      } as unknown as Record<string, unknown>,
    });
  };

  createEffect(() => {
    const currentLanguage = settings.language;
    if (language.isLoading() || flashcards.isLoading() || hasFrequencyData() || lastEmptyRefreshLanguage === currentLanguage) {
      return;
    }

    lastEmptyRefreshLanguage = currentLanguage;
    language.refreshLanguageData();
  });

  return (
    <div class="level-study-tab">
      {/* Level stats are derived from the learner projection and the
          installed frequency data: until both are authoritative, keep the
          tab's geometry with placeholders instead of a blank panel, zeroed
          coverage, or a false empty state. */}
      <Show when={flashcards.isKnowledgeReady() && !language.isLoading() && !projected.loading()} fallback={
        <div class="level-study-boot" aria-busy="true">
          <SkeletonCard lines={2} />
          <SkeletonRows rows={3} />
        </div>
      }>
        <Show
        when={hasFrequencyData()}
        fallback={
          <EmptyState
            icon={<TargetIcon size={32} />}
            title={t('mlearn.LevelStudy.EmptyState.Title')}
            description={t('mlearn.LevelStudy.EmptyState.Description')}
            variant="card"
            size="md"
          />
        }
      >
        <Show when={stats().length > 0}>
        <div class="level-study-coverage-bar">
          <div class="level-study-coverage-header">
            <span class="level-study-coverage-title">
              <Show
                when={userLevel() !== null}
                fallback={t('mlearn.LevelStudy.Coverage.AllLevels')}
              >
                {t('mlearn.LevelStudy.Coverage.UpTo')}
                <PillBtn size="sm" variant="primary" label={userLevelLabel()} onClick={openBehaviourSettings} />
              </Show>
            </span>
            <span>
              {coverageTotals().tracked} / {coverageTotals().total} {t('mlearn.LevelStudy.Coverage.Words')}
            </span>
          </div>
          <div class="level-card-bar level-study-coverage-progress">
            <Show when={coverageWidths().known > 0}>
              <div
                class="level-card-bar-segment level-card-bar-known"
                style={{ width: `${coverageWidths().known}%` }}
                title={`${t('mlearn.LevelStudy.LevelCard.Known')}: ${coverageTotals().known}`}
              />
            </Show>
            <Show when={coverageWidths().learning > 0}>
              <div
                class="level-card-bar-segment level-card-bar-learning"
                style={{ width: `${coverageWidths().learning}%` }}
                title={`${t('mlearn.LevelStudy.LevelCard.Learning')}: ${coverageTotals().learning}`}
              />
            </Show>
            <Show when={coverageWidths().unknown > 0}>
              <div
                class="level-card-bar-segment level-card-bar-unknown"
                style={{ width: `${coverageWidths().unknown}%` }}
                title={`${t('mlearn.LevelStudy.LevelCard.Unknown')}: ${coverageTotals().unknown}`}
              />
            </Show>
            <Show when={coverageWidths().untracked > 0}>
              <div
                class="level-card-bar-segment level-card-bar-untracked"
                style={{ width: `${coverageWidths().untracked}%` }}
                title={`${t('mlearn.LevelStudy.LevelCard.Untracked')}: ${coverageTotals().untracked}`}
              />
            </Show>
          </div>
          <Show
            when={!levelComplete()}
            fallback={
              <span class="level-study-coverage-hint">{t('mlearn.LevelStudy.Coverage.Complete')}</span>
            }
          >
             <Show
               when={userLevel() === null}
               fallback={
                 <span class="level-study-coverage-hint">{t('mlearn.LevelStudy.Coverage.Hint')}</span>
               }
             >
               <button type="button" class="level-study-set-level-link" onClick={openBehaviourSettings}>
                 {t('mlearn.LevelStudy.Coverage.SetLevelHint')}
               </button>
             </Show>
          </Show>
        </div>
        </Show>

        <div class="level-study-bulk-add">
          <Btn variant="primary" onClick={() => setShowBulkAdd(true)}>
            {t('mlearn.LevelStudy.BulkAdd.Button')}
          </Btn>
        </div>

        <div class="level-study-levels-grid">
          <For each={stats()}>
            {(levelStat) => (
              <LevelCard stats={levelStat} onClick={() => setSelectedLevel(levelStat)} />
            )}
          </For>
          <Show when={beyondCard()}>
            {(card) => (
              <LevelCard stats={card()} onClick={() => setSelectedLevel(card())} />
            )}
          </Show>
        </div>
        </Show>

        <Show when={grammarSummary() !== null && grammarSummary()!.total > 0 && grammarLog() !== undefined}>
          <GrammarCoverage
            language={resolvedLanguageData().language}
            languageData={resolvedLanguageData().data!}
            eventLog={grammarLog()!}
            summary={grammarSummary()!}
            repairRequest={mockRepairRequest()}
            onRepairRequestHandled={(requestedAt) => {
              setMockRepairRequest((request) => request?.requestedAt === requestedAt ? null : request);
            }}
            onValidated={() => setValidationsVersion((version) => version + 1)}
            onProbe={(pattern, quality, level, scaffolds, attempt) => {
              return flashcards.recordGrammarAttemptAcknowledged(pattern, quality, {
                language: resolvedLanguageData().language,
                level,
                ...(scaffolds ? { scaffolds } : {}),
                ...(attempt?.itemRef ? { itemRef: attempt.itemRef } : {}),
                ...(attempt?.validationRef ? { validationRef: attempt.validationRef } : {}),
                ...(attempt?.taskType !== undefined ? { taskType: attempt.taskType } : {}),
                ...(attempt?.attemptId !== undefined ? { attemptId: attempt.attemptId } : {}),
              });
            }}
          />
          {/* Checkpoints & mocks (R13): fixed declared blueprints over the
              same journal, results through the canonical writer, repair via
              the SAME policy walk, targeted output via the SAME agent. */}
          <MockExam
            language={resolvedLanguageData().language}
            languageData={resolvedLanguageData().data!}
            eventLog={grammarLog()!}
            onAttempt={recordMockAttempt}
            onRepair={(level) => setMockRepairRequest({ level, requestedAt: Date.now() })}
            onTargetedOutput={openTargetedOutput}
          />
      </Show>
      </Show>
      {/* Mounted OUTSIDE the boot gate above: every placement rating appends
          knowledge events, bumps eventsVersion and flips the projections to
          loading — a gate here would unmount the live panel mid-session.
          PlacementSession keeps its own state across those flips and only
          hides its DOM while booting is true. Keyed on the learning language:
          a language switch remounts the panel fresh, so a completed summary,
          in-memory baseline or cursor of one language can never leak into
          another language's placement (R19/G01). */}
      <Show when={placementLanguage()} keyed>
        {(keyedLanguage) => {
          const language = typeof keyedLanguage === 'function'
            ? (keyedLanguage as unknown as () => string)()
            : keyedLanguage as string;
          return (
            <PlacementSession
              language={language}
              pools={placementPools()}
              isWordAtLevel={(word, level) => frequency()[word]?.raw_level === level}
              background={placementBackground()}
              booting={placementBooting()}
              isWordIgnored={(word) => flashcards.isWordIgnoredSync(word, placementLanguage())}
              onAddBackground={addBackground}
              onRemoveBackground={removeBackground}
              declaredLevel={userLevel()}
              isLevelAtOrEasierThan={(level, target) => isFrequencyLevelAtOrEasierThanTarget(level, target, resolvedLanguageData().data)}
              onRate={recordPlacementAttempt}
              onApplyPlacement={applyPlacement}
            />
          );
        }}
      </Show>
      <Show when={selectedLevel()}>
        {(level) => (
          <LevelDetailModal
            level={level().level}
            levelName={level().name}
            language={resolvedLanguageData().language}
            languageData={resolvedLanguageData().data}
            onClose={() => setSelectedLevel(null)}
          />
        )}
      </Show>
      <Show when={showBulkAdd()}>
        <BulkAddModal
          language={resolvedLanguageData().language}
          languageData={resolvedLanguageData().data}
          frequency={frequency()}
          levelNames={levelNames()}
          targetLevel={userLevel()}
          onClose={() => setShowBulkAdd(false)}
        />
      </Show>
    </div>
  );
};

export default LevelStudyTab;
