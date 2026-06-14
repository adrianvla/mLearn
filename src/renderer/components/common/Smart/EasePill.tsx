import { Component, createMemo, Show } from 'solid-js';
import { useLocalization } from '../../../context';
import type { Flashcard } from '../../../../shared/types';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../AnkiHoverPreview';
import { FlashcardHoverPreview } from '../FlashcardHoverPreview';
import { PillBtn } from '../Button';
import Icon from '../Icons/Icon';
import { getAnkiEaseForStatus, type WordStatus } from '../../subtitle/wordHoverHelpers';
import { ANKI_EASE } from '../../../../shared/constants';
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
  mlearnCard?: Flashcard | null;
  onTooltipShow?: () => void;
}

export const EasePill: Component<EasePillProps> = (props) => {

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
      const ankiEase = getAnkiEaseForStatus(props.effectiveStatus, ANKI_EASE.DEFAULT_LEARNING, ANKI_EASE.DEFAULT_KNOWN);
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
      <FlashcardHoverPreview
        mlearnCard={props.mlearnCard ?? null}
      >
        <PillBtn
          variant="green"
          icon={ICON_MLEARN}
          label={easeLabel()}
        />
      </FlashcardHoverPreview>
    }>
      <FlashcardHoverPreview
        mlearnCard={props.mlearnCard ?? null}
        ankiLoading={props.ankiHoverLoading}
        ankiFields={props.ankiHoverCard}
        ankiCardInfo={props.ankiHoverCardInfo}
        footer={<div class="anki-hover-preview__footer">{tooltipContent()}</div>}
        onShow={props.onTooltipShow}
      >
        <PillBtn
          variant="green"
          icon={dualIcon()}
          label={easeLabel()}
        />
      </FlashcardHoverPreview>
    </Show>
  );
};
