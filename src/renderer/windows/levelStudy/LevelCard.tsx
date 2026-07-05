import { Component, Show } from 'solid-js';
import { useLocalization } from '../../context';
import { Card } from '../../components/common';
import type { LevelStats } from '../../utils/wordLevelStats';

interface LevelCardProps {
  stats: LevelStats;
  onClick: () => void;
}

export const LevelCard: Component<LevelCardProps> = (props) => {
  const { t } = useLocalization();
  const hasAny = () => props.stats.total > 0;

  const knownWidth = () => (hasAny() ? props.stats.knownPct : 0);
  const learningWidth = () => (hasAny() ? props.stats.learningPct : 0);
  const unknownWidth = () => (hasAny() ? props.stats.unknownPct : 0);
  const untrackedWidth = () => (hasAny() ? props.stats.untrackedPct : 0);

  return (
    <Card
      class="level-card-card"
      onClick={props.onClick}
      title={props.stats.name}
      subtitle={t('mlearn.LevelStudy.LevelCard.TotalWords', { count: String(props.stats.total) })}
      footer={
        <span class="level-card-card-action">
          {t('mlearn.LevelStudy.LevelCard.ViewWords')} →
        </span>
      }
    >
      <div class="level-card-bar">
        <Show when={knownWidth() > 0}>
          <div
            class="level-card-bar-segment level-card-bar-known"
            style={{ width: `${knownWidth()}%` }}
            title={`${t('mlearn.LevelStudy.LevelCard.Known')}: ${props.stats.known} (${knownWidth()}%)`}
          />
        </Show>
        <Show when={learningWidth() > 0}>
          <div
            class="level-card-bar-segment level-card-bar-learning"
            style={{ width: `${learningWidth()}%` }}
            title={`${t('mlearn.LevelStudy.LevelCard.Learning')}: ${props.stats.learning} (${learningWidth()}%)`}
          />
        </Show>
        <Show when={unknownWidth() > 0}>
          <div
            class="level-card-bar-segment level-card-bar-unknown"
            style={{ width: `${unknownWidth()}%` }}
            title={`${t('mlearn.LevelStudy.LevelCard.Unknown')}: ${props.stats.unknown} (${unknownWidth()}%)`}
          />
        </Show>
        <Show when={untrackedWidth() > 0}>
          <div
            class="level-card-bar-segment level-card-bar-untracked"
            style={{ width: `${untrackedWidth()}%` }}
            title={`${t('mlearn.LevelStudy.LevelCard.Untracked')}: ${props.stats.untracked} (${untrackedWidth()}%)`}
          />
        </Show>
      </div>

      <div class="level-card-card-legend">
        <div class="level-card-legend-item">
          <span class="level-card-legend-dot level-card-bar-known" />
          <span class="level-card-legend-label">{t('mlearn.LevelStudy.LevelCard.Known')}</span>
          <span class="level-card-legend-count">{props.stats.known}</span>
          <span class="level-card-legend-pct">({knownWidth()}%)</span>
        </div>
        <div class="level-card-legend-item">
          <span class="level-card-legend-dot level-card-bar-learning" />
          <span class="level-card-legend-label">{t('mlearn.LevelStudy.LevelCard.Learning')}</span>
          <span class="level-card-legend-count">{props.stats.learning}</span>
          <span class="level-card-legend-pct">({learningWidth()}%)</span>
        </div>
        <div class="level-card-legend-item">
          <span class="level-card-legend-dot level-card-bar-unknown" />
          <span class="level-card-legend-label">{t('mlearn.LevelStudy.LevelCard.Unknown')}</span>
          <span class="level-card-legend-count">{props.stats.unknown}</span>
          <span class="level-card-legend-pct">({unknownWidth()}%)</span>
        </div>
        <div class="level-card-legend-item">
          <span class="level-card-legend-dot level-card-bar-untracked" />
          <span class="level-card-legend-label">{t('mlearn.LevelStudy.LevelCard.Untracked')}</span>
          <span class="level-card-legend-count">{props.stats.untracked}</span>
          <span class="level-card-legend-pct">({untrackedWidth()}%)</span>
        </div>
      </div>
    </Card>
  );
};

export default LevelCard;
