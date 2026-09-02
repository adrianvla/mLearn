import { Component, createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useLocalization, useFlashcards, useLanguage, useSettings } from '../../context';
import { LevelCard } from './LevelCard';
import { LevelDetailModal } from './LevelDetailModal';
import { BulkAddModal } from './BulkAddModal';
import { computeBeyondExamLevelStats, computeLevelStats, getLevelStudyFrequency, getLevelStudyLevelNames } from '../../utils/wordLevelStats';
import { buildAnkiStatusKeySets } from '../../services/ankiWordsCache';
import { EmptyState, TargetIcon, Btn, PillBtn } from '../../components/common';
import type { LevelStats } from '../../utils/wordLevelStats';
import {
  getFrequencyLevelLabel,
  getLearningLanguageLevelForLanguage,
  isFrequencyLevelAtOrEasierThanTarget,
} from '../../../shared/languageFeatures';
import { getBridge } from '../../../shared/bridges';
import type { LanguageData } from '../../../shared/types';

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
  const { settings } = useSettings();
  const [selectedLevel, setSelectedLevel] = createSignal<LevelStats | null>(null);
  const [showBulkAdd, setShowBulkAdd] = createSignal(false);
  let lastEmptyRefreshLanguage: string | null = null;

  const resolvedLanguageData = createMemo(() => (
    resolveLevelStudyLanguageData(
      settings.language,
      language.supportedLanguages(),
      language.currentLangData(),
      language.langData,
    )
  ));

  const frequency = createMemo(() => {
    const langData = resolvedLanguageData().data;
    return langData ? getLevelStudyFrequency(langData) : {};
  });

  const levelNames = createMemo(() => {
    const langData = resolvedLanguageData().data;
    return langData ? getLevelStudyLevelNames(langData, frequency()) : {};
  });

  const stats = createMemo(() => {
    if (flashcards.isLoading()) return [];
    const resolved = resolvedLanguageData();
    const langData = resolved.data;
    if (!langData) return [];
    const freq = frequency();
    if (!freq || Object.keys(freq).length === 0) return [];
    // Canonical-form keys mirror wordKey() inside computeLevelStats (write-where-you-read).
    const ankiKeys = settings.use_anki
      ? buildAnkiStatusKeySets(
        resolved.language,
        settings.ankiLearningThreshold,
        settings.ankiKnownThreshold,
        (word) => [language.getCanonicalFormForLanguage(resolved.language, word)],
        langData,
      )
      : undefined;
    return computeLevelStats(
      flashcards.store,
      freq,
      resolved.language,
      settings.known_ease_threshold,
      settings.srsLearningThreshold,
      levelNames(),
      langData,
      language.getCanonicalFormForLanguage,
      ankiKeys,
    );
  });

  const beyondCard = createMemo<LevelStats | null>(() => {
    if (flashcards.isLoading()) return null;
    const resolved = resolvedLanguageData();
    const langData = resolved.data;
    if (!langData) return null;
    const freq = frequency();
    if (!freq || Object.keys(freq).length === 0) return null;
    const beyond = computeBeyondExamLevelStats(
      flashcards.store,
      freq,
      resolved.language,
      settings.known_ease_threshold,
      settings.srsLearningThreshold,
      levelNames(),
      langData,
      language.getCanonicalFormForLanguage,
      settings.use_anki
        ? buildAnkiStatusKeySets(
          resolved.language,
          settings.ankiLearningThreshold,
          settings.ankiKnownThreshold,
          (word) => [language.getCanonicalFormForLanguage(resolved.language, word)],
          langData,
        )
        : undefined,
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

  const openBehaviourSettings = () => {
    getBridge().window.openWindow({ type: 'settings', context: { section: 'behaviour' } });
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
      <Show when={!flashcards.isLoading()}>
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
            when={!coverageTotals().complete}
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
