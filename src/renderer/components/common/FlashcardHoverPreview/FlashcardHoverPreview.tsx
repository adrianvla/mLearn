import { Component, JSX } from 'solid-js';
import { Tooltip } from '../Tooltip';
import { AnkiHoverPreviewContent } from '../AnkiHoverPreview/AnkiHoverPreview';
import { MlearnHoverPreview } from '../MlearnHoverPreview/MlearnHoverPreview';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../AnkiHoverPreview/AnkiHoverPreview';
import type { Flashcard } from '../../../../shared/types';
import './FlashcardHoverPreview.css';

export interface FlashcardHoverPreviewProps {
  mlearnCard?: Flashcard | null;
  ankiLoading?: boolean;
  ankiFields?: AnkiCardFields | null;
  ankiCardInfo?: AnkiCardSchedulingInfo | null;
  footer?: JSX.Element;
  children: JSX.Element;
  onShow?: () => void;
  position?: 'top' | 'bottom';
  class?: string;
}

export const FlashcardHoverPreview: Component<FlashcardHoverPreviewProps> = (props) => {
  const hasMlearn = () => props.mlearnCard != null;
  const hasAnki = () => props.ankiFields != null || (props.ankiLoading ?? false);
  const both = () => hasMlearn() && hasAnki();

  const tooltipContent = () => {
    if (both()) {
      return (
        <div class="flashcard-hover-preview">
          <div class="flashcard-hover-preview__column">
            <div class="flashcard-hover-preview__column-header">mLearn</div>
            <MlearnHoverPreview card={props.mlearnCard!} />
          </div>
          <div class="flashcard-hover-preview__divider" />
          <div class="flashcard-hover-preview__column">
            <div class="flashcard-hover-preview__column-header">Anki</div>
            <AnkiHoverPreviewContent
              loading={props.ankiLoading ?? false}
              fields={props.ankiFields ?? null}
              cardInfo={props.ankiCardInfo}
            />
          </div>
        </div>
      );
    }

    if (hasMlearn()) {
      return <MlearnHoverPreview card={props.mlearnCard!} />;
    }

    return (
      <AnkiHoverPreviewContent
        loading={props.ankiLoading ?? false}
        fields={props.ankiFields ?? null}
        cardInfo={props.ankiCardInfo}
        footer={props.footer}
      />
    );
  };

  return (
    <Tooltip
      content={tooltipContent()}
      onShow={props.onShow}
      position={props.position}
    >
      <span class={props.class}>{props.children}</span>
    </Tooltip>
  );
};
