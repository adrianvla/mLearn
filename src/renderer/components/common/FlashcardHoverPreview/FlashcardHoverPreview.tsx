import { Component, JSX, Show } from 'solid-js';
import { Tooltip } from '../Tooltip';
import { AnkiHoverPreviewContent } from '../AnkiHoverPreview/AnkiHoverPreview';
import { BuiltInFlashcardHoverPreview } from '../BuiltInFlashcardHoverPreview/BuiltInFlashcardHoverPreview';
import type { AnkiCardFields, AnkiCardSchedulingInfo } from '../AnkiHoverPreview/AnkiHoverPreview';
import type { Flashcard } from '../../../../shared/types';
import './FlashcardHoverPreview.css';

export interface FlashcardHoverPreviewProps {
  builtInCard?: Flashcard | null;
  ankiLoading?: boolean;
  ankiFields?: AnkiCardFields | null;
  ankiCardInfo?: AnkiCardSchedulingInfo | null;
  footer?: JSX.Element;
  children: JSX.Element;
  onShow?: () => void;
  position?: 'top' | 'bottom';
  class?: string;
}

interface PreviewColumnProps {
  title: string;
  children: JSX.Element;
}

const PreviewColumn: Component<PreviewColumnProps> = (props) => (
  <div class="flashcard-hover-preview__column">
    <div class="flashcard-hover-preview__column-header">{props.title}</div>
    {props.children}
  </div>
);

const renderExternalFooter = (footer?: JSX.Element) => (
  <Show when={footer}>
    <div class="flashcard-hover-preview__footer">{footer}</div>
  </Show>
);

export const FlashcardHoverPreview: Component<FlashcardHoverPreviewProps> = (props) => {
  const hasMlearn = () => props.builtInCard != null;
  const hasAnki = () => props.ankiFields != null || (props.ankiLoading ?? false);
  const both = () => hasMlearn() && hasAnki();

  const tooltipContent = () => {
    if (both()) {
      return (
        <>
          <div class="flashcard-hover-preview">
            <PreviewColumn title="mLearn">
              <BuiltInFlashcardHoverPreview card={props.builtInCard!} />
            </PreviewColumn>
            <div class="flashcard-hover-preview__divider" />
            <PreviewColumn title="Anki">
              <AnkiHoverPreviewContent
                loading={props.ankiLoading ?? false}
                fields={props.ankiFields ?? null}
                cardInfo={props.ankiCardInfo}
              />
            </PreviewColumn>
          </div>
          {renderExternalFooter(props.footer)}
        </>
      );
    }

    if (hasMlearn()) {
      return (
        <>
          <BuiltInFlashcardHoverPreview card={props.builtInCard!} />
          {renderExternalFooter(props.footer)}
        </>
      );
    }

    return (
      <>
        <AnkiHoverPreviewContent
          loading={props.ankiLoading ?? false}
          fields={props.ankiFields ?? null}
          cardInfo={props.ankiCardInfo}
        />
        {renderExternalFooter(props.footer)}
      </>
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
