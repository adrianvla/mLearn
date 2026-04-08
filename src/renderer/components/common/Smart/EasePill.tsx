import { Component, createMemo, Show } from 'solid-js';
import { useLocalization, useSettings } from '../../../context';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../AnkiHoverPreview';
import { AnkiHoverPreview } from '../AnkiHoverPreview';
import { PillBtn } from '../Button';
import { Tooltip } from '../Tooltip';
import Icon from '../Icons/Icon';
import { getAnkiEaseForStatus, type WordStatus } from '../../subtitle/wordHoverHelpers';
import './EasePill.css';

const ICON_ANKI = 'anki';
const ICON_MLEARN = 'mlearn-logo';

export interface EasePillProps {
  ease?: number;
  isInAnki: boolean;
  effectiveStatus: WordStatus;
  ankiHoverLoading: boolean;
  ankiHoverCard: AnkiCardFields | null;
  ankiHoverCardInfo: AnkiCardSchedulingInfo | null;
  onTooltipShow?: () => void;
}

export const EasePill: Component<EasePillProps> = (props) => {
  const { settings } = useSettings();
  const { t } = useLocalization();

  const easeLabel = createMemo(() => props.ease === undefined
    ? t('mlearn.Flashcards.Card.Tracked')
    : `${t('mlearn.Flashcards.Card.Ease')} ${Math.round(props.ease * 100) / 100}`
  );

  const tooltipContent = createMemo(() => {
    const parts: string[] = [];

    if (props.ease !== undefined) {
      parts.push(`${t('mlearn.Flashcards.Card.Ease')} ${Math.round(props.ease * 100) / 100}`);
    }

    if (props.isInAnki) {
      const ankiEase = getAnkiEaseForStatus(props.effectiveStatus, settings.ankiLearningEase, settings.ankiKnownEase);
      parts.push(t('mlearn.WordHover.AnkiEase', { ease: String(ankiEase) }));
    }

    return parts.join(' | ');
  });

  const dualIcon = () => (
    <div class="ease-pill__dual-icon">
      <Icon icon={ICON_MLEARN} color="currentColor" class="btn-svg-icon" />
      <Icon icon={ICON_ANKI} color="currentColor" class="btn-svg-icon" />
    </div>
  );

  return (
    <Show when={props.isInAnki} fallback={
      <PillBtn
        variant="green"
        icon={ICON_MLEARN}
        label={easeLabel()}
      />
    }>
      <Tooltip
        content={
          <AnkiHoverPreview
            loading={props.ankiHoverLoading}
            fields={props.ankiHoverCard}
            cardInfo={props.ankiHoverCardInfo}
            footer={<div class="anki-hover-preview__footer">{tooltipContent()}</div>}
          />
        }
        onShow={props.onTooltipShow}
      >
        <PillBtn
          variant="green"
          icon={dualIcon()}
          label={easeLabel()}
        />
      </Tooltip>
    </Show>
  );
};
