import { Component, JSX, Show } from 'solid-js';
import { useLocalization } from '../../../context';
import { dueDateToString } from '../../../services/srsAlgorithm';
import type { Flashcard } from '../../../../shared/types';
import './BuiltInFlashcardHoverPreview.css';

export interface BuiltInFlashcardHoverPreviewProps {
  card: Flashcard | null;
  loading?: boolean;
  footer?: JSX.Element;
}

export const BuiltInFlashcardHoverPreview: Component<BuiltInFlashcardHoverPreviewProps> = (props) => {
  const { t } = useLocalization();

  const truncate = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  };

  return (
    <div class="built-in-flashcard-hover-preview">
      <Show when={props.loading}>
        <span class="built-in-flashcard-hover-preview__loading">{t('mlearn.Global.Loading')}</span>
      </Show>
      <Show when={!props.loading && props.card}>
        {(card) => (
          <>
            <div class="built-in-flashcard-hover-preview__fields">
              <Show when={card().content.front}>
                <div class="built-in-flashcard-hover-preview__field">
                  <span class="built-in-flashcard-hover-preview__label">{t('mlearn.CardEditor.Fields.Word')}</span>
                  <span class="built-in-flashcard-hover-preview__value">{card().content.front}</span>
                </div>
              </Show>
              <Show when={card().content.reading}>
                <div class="built-in-flashcard-hover-preview__field">
                  <span class="built-in-flashcard-hover-preview__label">{t('mlearn.CardEditor.Fields.Reading')}</span>
                  <span class="built-in-flashcard-hover-preview__value">{card().content.reading}</span>
                </div>
              </Show>
              <Show when={card().content.back}>
                <div class="built-in-flashcard-hover-preview__field">
                  <span class="built-in-flashcard-hover-preview__label">{t('mlearn.Flashcards.Modals.AddCard.MeaningLabel')}</span>
                  <span class="built-in-flashcard-hover-preview__value" innerHTML={card().content.back} />
                </div>
              </Show>
              <Show when={card().content.example && card().content.example !== '-'}>
                <div class="built-in-flashcard-hover-preview__field">
                  <span class="built-in-flashcard-hover-preview__label">{t('mlearn.FlashcardChoice.Example')}</span>
                  <span class="built-in-flashcard-hover-preview__value" innerHTML={truncate(card().content.example!, 200)} />
                </div>
              </Show>
            </div>
            <Show when={card().ease !== undefined || card().dueDate !== undefined || card().state !== undefined || (card().reviews !== undefined && card().reviews > 0) || (card().lapses !== undefined && card().lapses > 0)}>
              <div class="built-in-flashcard-hover-preview__footer">
                <Show when={card().ease !== undefined}>
                  <div class="built-in-flashcard-hover-preview__footer-field">
                    <span class="built-in-flashcard-hover-preview__label">{t('mlearn.CardEditor.Statistics.Ease')}</span>
                    <span class="built-in-flashcard-hover-preview__value">{Math.round(card().ease * 100) / 100}</span>
                  </div>
                </Show>
                <Show when={card().dueDate !== null && card().dueDate !== 0}>
                  <div class="built-in-flashcard-hover-preview__footer-field">
                    <span class="built-in-flashcard-hover-preview__label">{t('mlearn.Flashcards.Card.Due')}</span>
                    <span class="built-in-flashcard-hover-preview__value">{dueDateToString(card().dueDate, t)}</span>
                  </div>
                </Show>
                <Show when={card().state !== undefined}>
                  <div class="built-in-flashcard-hover-preview__footer-field">
                    <span class="built-in-flashcard-hover-preview__label">{t('mlearn.CardEditor.Statistics.State')}</span>
                    <span class="built-in-flashcard-hover-preview__value">{card().state}</span>
                  </div>
                </Show>
                <Show when={card().reviews !== undefined && card().reviews > 0}>
                  <div class="built-in-flashcard-hover-preview__footer-field">
                    <span class="built-in-flashcard-hover-preview__label">{t('mlearn.CardEditor.Statistics.Reviews')}</span>
                    <span class="built-in-flashcard-hover-preview__value">{card().reviews}</span>
                  </div>
                </Show>
                <Show when={card().lapses !== undefined && card().lapses > 0}>
                  <div class="built-in-flashcard-hover-preview__footer-field">
                    <span class="built-in-flashcard-hover-preview__label">{t('mlearn.CardEditor.Statistics.Lapses')}</span>
                    <span class="built-in-flashcard-hover-preview__value">{card().lapses}</span>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={props.footer}>
              {props.footer}
            </Show>
          </>
        )}
      </Show>
      <Show when={!props.loading && !props.card}>
        <span class="built-in-flashcard-hover-preview__loading">No card found</span>
      </Show>
    </div>
  );
};
