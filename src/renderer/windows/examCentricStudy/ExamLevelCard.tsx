import { Component, Show } from 'solid-js';
import { useLocalization } from '../../context';
import { Card } from '../../components/common';
import type { ExamLevelStats } from '../../utils/wordLevelStats';

interface ExamLevelCardProps {
  stats: ExamLevelStats;
  onClick: () => void;
}

export const ExamLevelCard: Component<ExamLevelCardProps> = (props) => {
  const { t } = useLocalization();
  const hasAny = () => props.stats.total > 0;

  const knownWidth = () => (hasAny() ? props.stats.knownPct : 0);
  const learningWidth = () => (hasAny() ? props.stats.learningPct : 0);
  const unknownWidth = () => (hasAny() ? props.stats.unknownPct : 0);
  const untrackedWidth = () => (hasAny() ? props.stats.untrackedPct : 0);

  return (
    <Card
      class="exam-level-card"
      onClick={props.onClick}
      title={props.stats.name}
      subtitle={t('mlearn.ExamStudy.LevelCard.TotalWords', { count: String(props.stats.total) })}
      footer={
        <span class="exam-level-card-action">
          {t('mlearn.ExamStudy.LevelCard.ViewWords')} →
        </span>
      }
    >
      <div class="exam-level-bar">
        <Show when={knownWidth() > 0}>
          <div
            class="exam-level-bar-segment exam-level-bar-known"
            style={{ width: `${knownWidth()}%` }}
            title={`${t('mlearn.ExamStudy.LevelCard.Known')}: ${props.stats.known} (${knownWidth()}%)`}
          />
        </Show>
        <Show when={learningWidth() > 0}>
          <div
            class="exam-level-bar-segment exam-level-bar-learning"
            style={{ width: `${learningWidth()}%` }}
            title={`${t('mlearn.ExamStudy.LevelCard.Learning')}: ${props.stats.learning} (${learningWidth()}%)`}
          />
        </Show>
        <Show when={unknownWidth() > 0}>
          <div
            class="exam-level-bar-segment exam-level-bar-unknown"
            style={{ width: `${unknownWidth()}%` }}
            title={`${t('mlearn.ExamStudy.LevelCard.Unknown')}: ${props.stats.unknown} (${unknownWidth()}%)`}
          />
        </Show>
        <Show when={untrackedWidth() > 0}>
          <div
            class="exam-level-bar-segment exam-level-bar-untracked"
            style={{ width: `${untrackedWidth()}%` }}
            title={`${t('mlearn.ExamStudy.LevelCard.Untracked')}: ${props.stats.untracked} (${untrackedWidth()}%)`}
          />
        </Show>
      </div>

      <div class="exam-level-card-legend">
        <div class="exam-level-legend-item">
          <span class="exam-level-legend-dot exam-level-bar-known" />
          <span class="exam-level-legend-label">{t('mlearn.ExamStudy.LevelCard.Known')}</span>
          <span class="exam-level-legend-count">{props.stats.known}</span>
          <span class="exam-level-legend-pct">({knownWidth()}%)</span>
        </div>
        <div class="exam-level-legend-item">
          <span class="exam-level-legend-dot exam-level-bar-learning" />
          <span class="exam-level-legend-label">{t('mlearn.ExamStudy.LevelCard.Learning')}</span>
          <span class="exam-level-legend-count">{props.stats.learning}</span>
          <span class="exam-level-legend-pct">({learningWidth()}%)</span>
        </div>
        <div class="exam-level-legend-item">
          <span class="exam-level-legend-dot exam-level-bar-unknown" />
          <span class="exam-level-legend-label">{t('mlearn.ExamStudy.LevelCard.Unknown')}</span>
          <span class="exam-level-legend-count">{props.stats.unknown}</span>
          <span class="exam-level-legend-pct">({unknownWidth()}%)</span>
        </div>
        <div class="exam-level-legend-item">
          <span class="exam-level-legend-dot exam-level-bar-untracked" />
          <span class="exam-level-legend-label">{t('mlearn.ExamStudy.LevelCard.Untracked')}</span>
          <span class="exam-level-legend-count">{props.stats.untracked}</span>
          <span class="exam-level-legend-pct">({untrackedWidth()}%)</span>
        </div>
      </div>
    </Card>
  );
};

export default ExamLevelCard;
