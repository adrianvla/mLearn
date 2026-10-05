import { learningScopeForSettings } from '../../../shared/learningScope';
import type { PolicyContext } from '../../learning/types';
import { useEvidenceLinkedProjections } from '../../hooks/useEvidenceLinkedProjections';
import { projectedWordStatus } from '../../../shared/graph/targets';
import { Component, createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useLocalization, useFlashcards, useLanguage, useSettings } from '../../context';
import { LevelCard } from './LevelCard';
import { LevelDetailModal } from './LevelDetailModal';
import { BulkAddModal } from './BulkAddModal';
import { GrammarCoverage } from './GrammarCoverage';
import MockExam from './MockExam';
import LearningBackgroundPanel from './LearningBackgroundPanel';
import { summarizeGrammarCurriculum, grammarLevelName } from '../../utils/curriculumCoverage';
import { declaredItemStates, questionBankFromLanguageData } from '../../learning/questionBank';
import { languageDataWithStoredQuestionValidations } from '../../learning/questionValidation';
import type { MockJournalPayload } from '../../learning/mockExam';
import type { AttemptId, KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import type { GrammarProjectionMap } from '../../../shared/knowledge/historyQueries';
import { effectiveThresholds } from '../../../shared/knowledge/effectiveKnowledge';
import { eventsVersion, queryLanguageKeys } from '../../services/knowledgeEvents';
import { createResource } from 'solid-js';
import {
  computeBeyondExamLevelStats,
  computeLevelStats,
  getLevelStudyFrequency,
  getLevelStudyLevelNames,
} from '../../utils/wordLevelStats';
import { Button, EmptyState, KnowledgeLoadError, Panel, TargetIcon, SkeletonCard, SkeletonRows } from '../../components/common';
import type { LevelStats } from '../../utils/wordLevelStats';
import {
  getFrequencyLevelLabel,
  getLearningLanguageLevelForLanguage,
  isFrequencyLevelAtOrEasierThanTarget,
} from '../../../shared/languageFeatures';
import type { LanguageData } from '../../../shared/types';
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

export const LevelStudyTab: Component<{ view?: 'plan' | 'grammar' | 'grammar-check' | 'mock'; grammarResumeId?: string; mockAction?: 'open' | 'start' | 'resume'; mockResumeId?: string; mockLevel?: number; onEditPlan?: () => void; policyContext?: PolicyContext; onGrammarRequestHandled?: () => void; grammarRequest?: { level: number; patterns: string[]; requestedAt: number; handoffDecision?: import('../../../shared/learningDecision').LearningDecision } }> = (props) => {
  const { t } = useLocalization();
  const flashcards = useFlashcards();
  const language = useLanguage();
  const { settings } = useSettings();
  const [selectedLevel, setSelectedLevel] = createSignal<LevelStats | null>(null);
  const view = () => props.view ?? 'plan';
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

  const targetScope = createMemo(() => learningScopeForSettings(settings, resolvedLanguageData().data, resolvedLanguageData().language));
  const scopedGrammarData = createMemo(() => {
    const data = resolvedLanguageData().data;
    return data && targetScope().selected ? { ...data, grammar: data.grammar?.filter(point => targetScope().patterns.includes(point.pattern)) } : data;
  });
  const frequency = createMemo(() => {
    const langData = resolvedLanguageData().data;
    return targetScope().selected ? targetScope().frequency : langData ? getLevelStudyFrequency(langData) : {};
  });

  const levelNames = createMemo(() => {
    const langData = resolvedLanguageData().data;
    return langData ? getLevelStudyLevelNames(langData, frequency()) : {};
  });

  const projected = useEvidenceLinkedProjections(() => flashcards.isKnowledgeReady() && !language.isLoading() ? {
    language: resolvedLanguageData().language,
    surfaces: Object.keys(frequency()),
    materializedKeys: Object.keys(flashcards.store?.wordKnowledge ?? {}),
  } : undefined);
  const evidenceKeys = createMemo(() => new Set(projected.evidenceKeys()));
  const projectionSurfaces = createMemo(() => [...projected.projections().keys()]);

  let settledStats: { language: string; scope: string; value: LevelStats[] } | null = null;
  const stats = createMemo(() => {
    const resolved = resolvedLanguageData();
    if (flashcards.isLoading() || !projected.ready()) {
      return settledStats?.language === resolved.language && settledStats.scope === JSON.stringify(targetScope().goals.map(goal => goal.outcomeRef)) ? settledStats.value : [];
    }
    const langData = resolved.data;
    if (!langData) return [];
    const freq = frequency();
    if (!freq || Object.keys(freq).length === 0) return [];
    const value = computeLevelStats(
      flashcards.store,
      freq,
      resolved.language,
      effectiveThresholds(settings),
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
    settledStats = { language: resolved.language, scope: JSON.stringify(targetScope().goals.map(goal => goal.outcomeRef)), value };
    return value;
  });

  let settledBeyond: { language: string; value: LevelStats | null } | null = null;
  const beyondCard = createMemo<LevelStats | null>(() => {
    const resolved = resolvedLanguageData();
    if (flashcards.isLoading() || projected.loading()) {
      return settledBeyond?.language === resolved.language ? settledBeyond.value : null;
    }
    const langData = resolved.data;
    if (!langData) return null;
    const freq = frequency();
    if (!freq || Object.keys(freq).length === 0) return null;
    const beyond = computeBeyondExamLevelStats(
      flashcards.store,
      freq,
      resolved.language,
      effectiveThresholds(settings),
      levelNames(),
      langData,
      undefined,
      (word) => {
        const projection = projected.projections().get(word);
        return projection ? projectedWordStatus(projection) : { status: 'unknown' as const, basis: 'unmeasured' as const };
      },
    );
    const value = beyond != null ? { ...beyond, name: t('mlearn.LevelStudy.LevelCard.BeyondExam') } : null;
    settledBeyond = { language: resolved.language, value };
    return value;
  });

  const userLevel = createMemo(() => (
    targetScope().selected ? null : getLearningLanguageLevelForLanguage(settings, resolvedLanguageData().language || null)
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

  // Grammar curriculum coverage aggregates over the package's OWN grammar
  // scale (grammarLevels), from the capability-scoped journal.
  const [grammarLogResource, { refetch: retryGrammarLog }] = createResource(
    () => (flashcards.isKnowledgeReady() && !language.isLoading() ? { language: resolvedLanguageData().language, version: eventsVersion() } : undefined),
    async (source) => {
      const keys = await queryLanguageKeys(source.language, 'grammar:');
      const [projections, itemLog] = await Promise.all([
        getBridge().knowledgeEvents.getGrammarProjections(source.language),
        keys.length > 0 ? getBridge().knowledgeEvents.queryKnowledgeItemEvents(keys) : Promise.resolve({} as KnowledgeEventLog),
      ]);
      return { projections, itemLog };
    },
  );
  let settledGrammarLog: { language: string; value: { projections: GrammarProjectionMap; itemLog: KnowledgeEventLog } } | null = null;
  const grammarEvidence = createMemo(() => {
    const currentLanguage = resolvedLanguageData().language;
    const value = grammarLogResource();
    if (grammarLogResource.state === 'ready' && value !== undefined) {
      settledGrammarLog = { language: currentLanguage, value };
      return value;
    }
    return settledGrammarLog?.language === currentLanguage ? settledGrammarLog.value : undefined;
  });
  const grammarLog = () => grammarEvidence()?.itemLog;
  const grammarProjections = () => grammarEvidence()?.projections;
  const requiresGrammar = () => Boolean(scopedGrammarData()?.grammar?.length);
  const grammarSummary = createMemo(() => {
    const data = scopedGrammarData();
    const projections = grammarProjections();
    if (!data || !projections || resolvedLanguageData().language === '') return null;
    // Vocabulary-only packages: no grammar gate at all.
    if (!data.grammar?.length) return null;
    return summarizeGrammarCurriculum(resolvedLanguageData().language, data, projections, effectiveThresholds(settings));
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
    coverageTotals().complete && (!requiresGrammar() || grammarSummary()?.complete === true)
  ));

  const openBehaviourSettings = () => {
    if (props.onEditPlan) props.onEditPlan();
    else getBridge().window.openWindow({ type: 'level-study', context: { activity: 'plan' } });
  };

  // ─── Checkpoints & mocks (R13/R14) ──────────────
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
  /** Preparation and saved Messenger history stay accessible before provider setup. */
  const openTargetedOutput = (targets: readonly { pattern: string; meaning: string; level: number }[]) => {
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
      <Show when={view() === 'plan' && projected.failed()}>
        <KnowledgeLoadError onRetry={() => { projected.retry(); }} />
      </Show>
      <Show when={view() === 'plan' && resolvedLanguageData().language !== ''}>
        <LearningBackgroundPanel language={resolvedLanguageData().language} />
      </Show>
      {/* Level stats are derived from the learner projection and the
          installed frequency data: until both are authoritative, keep the
          tab's geometry with placeholders instead of a blank panel, zeroed
          coverage, or a false empty state. */}
      <Show when={view() === 'plan'}>
      <Show when={flashcards.isKnowledgeReady() && !language.isLoading() && ((projected.ready()) || stats().length > 0)} fallback={
        <Show when={!projected.failed()}>
        <div class="level-study-boot" aria-busy="true">
          <SkeletonCard lines={2} />
          <SkeletonRows rows={3} />
        </div>
        </Show>
      }>
        <Show
        when={hasFrequencyData()}
        fallback={
          <Show when={!targetScope().selected || targetScope().words.length > 0}><EmptyState
            icon={<TargetIcon size={32} />}
            title={t('mlearn.LevelStudy.EmptyState.Title')}
            description={t('mlearn.LevelStudy.EmptyState.Description')}
            variant="card"
            size="md"
          /></Show>
        }
      >
        <Show when={stats().length > 0}>
        <Panel class="level-study-coverage-bar" padding="md">
          <div class="level-study-coverage-header">
            <span class="level-study-coverage-title">
              <Show
                when={userLevel() !== null}
                fallback={t('mlearn.LevelStudy.Coverage.AllLevels')}
              >
                {t('mlearn.LevelStudy.Coverage.UpTo')}
                <Button buttonType="pill" size="sm" variant="primary" label={userLevelLabel()} onClick={openBehaviourSettings} />
              </Show>
            </span>
            <span>
              {coverageTotals().tracked} / {coverageTotals().total} {t('mlearn.LevelStudy.Coverage.Words')} · {t('mlearn.LevelStudy.Coverage.Assessed')}
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
        </Panel>
        </Show>

        <div class="level-study-bulk-add">
          <Button variant="primary" onClick={() => setShowBulkAdd(true)}>
            {t('mlearn.LevelStudy.BulkAdd.Button')}
          </Button>
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

      </Show>
      </Show>
        <Show when={requiresGrammar() && grammarLog() === undefined}>
          <Show when={grammarLogResource.state === 'errored'} fallback={<SkeletonRows rows={3} />}>
            <KnowledgeLoadError onRetry={() => void retryGrammarLog()} />
          </Show>
        </Show>
        <Show when={view() !== 'plan' && !language.isLoading() && resolvedLanguageData().data && grammarLog() !== undefined && !requiresGrammar()}>
          <EmptyState title={t('mlearn.Product.GrammarUnavailable')} variant="card" size="md" />
        </Show>
        <Show when={grammarSummary() !== null && grammarSummary()!.total > 0 && grammarLog() !== undefined}>
          <Show when={view() === 'plan'}>
            <Panel class="level-study-grammar-summary" padding="md">
              <h3>{t('mlearn.LevelStudy.Grammar.Title')}</h3>
              <For each={grammarSummary()!.buckets}>{bucket => <div class="level-study-grammar-summary-row">
                <span>{grammarLevelName(Number(bucket.level), resolvedLanguageData().data!)}</span>
                <span>{bucket.known + bucket.learning + bucket.unknown} / {bucket.total} {t('mlearn.LevelStudy.Coverage.Assessed')}</span>
                <Button onClick={() => getBridge().window.openWindow({ type: 'level-study', context: {
                  activity: 'grammar', level: bucket.level, returnTo: 'plan',
                  patterns: scopedGrammarData()!.grammar!.filter(point => point.level === bucket.level).map(point => point.pattern),
                } })}>{t('mlearn.Product.Practise')}</Button>
              </div>}</For>
              <Button onClick={() => getBridge().window.openWindow({ type: 'level-study', context: { activity: 'grammar', purpose: 'evaluate', returnTo: 'plan' } })}>{t('mlearn.Product.Evaluate')}</Button>
            </Panel>
          </Show>
          <Show when={view() === 'grammar' || view() === 'grammar-check'}>
          <GrammarCoverage
            purpose={view() === 'grammar-check' ? 'check' : 'practice'}
            initiallyPaused={true}
            resumeSessionId={props.grammarResumeId}
            language={resolvedLanguageData().language}
            languageData={resolvedLanguageData().data!}
            eventLog={grammarLog()!}
            projections={grammarProjections()!}
            summary={grammarSummary()!}
            policyContext={props.policyContext}
            scopePatterns={props.grammarRequest?.patterns ?? (targetScope().selected ? targetScope().patterns : undefined)}
            repairRequest={props.grammarRequest}
            onRepairRequestHandled={() => props.onGrammarRequestHandled?.()}
            onValidated={() => setValidationsVersion((version) => version + 1)}
            undoLifecycle={{
              record: flashcards.recordPendingRetraction,
              complete: flashcards.completePendingRetraction,
              recover: flashcards.recoverPendingRetraction,
              register: flashcards.registerRetractionProjection,
            }}
            onProbe={(pattern, quality, level, scaffolds, attempt) => {
              return flashcards.recordGrammarAttemptAcknowledged(pattern, quality, {
                language: resolvedLanguageData().language,
                level,
                ...(scaffolds ? { scaffolds } : {}),
                ...(attempt?.itemRef ? { itemRef: attempt.itemRef } : {}),
                ...(attempt?.validationRef ? { validationRef: attempt.validationRef } : {}),
                ...(attempt?.method !== undefined ? { method: attempt.method } : {}),
                ...(attempt?.taskType !== undefined ? { taskType: attempt.taskType } : {}),
                ...(attempt?.attemptId !== undefined ? { attemptId: attempt.attemptId } : {}),
                ...(attempt?.decision ? { decision: attempt.decision } : {}),
                ...(attempt?.correctsAttemptId ? { correctsAttemptId: attempt.correctsAttemptId } : {}),
              });
            }}
          />
          </Show>
          <Show when={view() === 'mock'}>
          {/* Checkpoints & mocks (R13): fixed declared blueprints over the
              same journal, results through the canonical writer, repair via
              the SAME policy walk, targeted output via the SAME agent. */}
          <MockExam
            workspaceAction={props.mockAction}
            resumeSessionId={props.mockResumeId}
            requestedLevel={props.mockLevel}
            language={resolvedLanguageData().language}
            languageData={resolvedLanguageData().data!}
            eventLog={grammarLog()!}
            onAttempt={recordMockAttempt}
            onRepair={(level) => getBridge().window.openWindow({ type: 'level-study', context: { activity: 'grammar', level, patterns: (resolvedLanguageData().data?.grammar ?? []).filter(point => point.level === level).map(point => point.pattern), returnTo: 'mock' } })}
            onTargetedOutput={openTargetedOutput}
          />
          </Show>
      </Show>
      <Show when={selectedLevel()}>
        {(level) => (
          <LevelDetailModal
            level={level().level}
            levelName={level().name}
            language={resolvedLanguageData().language}
            languageData={resolvedLanguageData().data}
            frequency={frequency()}
            evidenceSurfaces={projectionSurfaces()}
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
          evidenceSurfaces={projectionSurfaces()}
          evidenceKeys={evidenceKeys()}
          targetLevel={userLevel()}
          onClose={() => setShowBulkAdd(false)}
        />
      </Show>
    </div>
  );
};

export default LevelStudyTab;
