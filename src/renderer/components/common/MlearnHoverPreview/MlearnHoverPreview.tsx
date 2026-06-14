import { Component, Show } from 'solid-js';
import { useLocalization } from '../../../context';
import { dueDateToString } from '../../../services/srsAlgorithm';
import type { Flashcard } from '../../../../shared/types';
import './MlearnHoverPreview.css';

export interface MlearnHoverPreviewProps {
  card: Flashcard | null;
  loading?: boolean;
}

export const MlearnHoverPreview: Component<MlearnHoverPreviewProps> = (props) => {
  const { t } = useLocalization();

  const truncate = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  };

  return (
    <div class="mlearn-hover-preview">
      <Show when={props.loading}>
        <span class="mlearn-hover-preview__loading">{t('mlearn.Global.Loading')}</span>
      </Show>
      <Show when={!props.loading && props.card}>
        {(card) => (
          <div class="mlearn-hover-preview__fields">
            <Show when={card().content.front}>
              <div class="mlearn-hover-preview__field">
                <span class="mlearn-hover-preview__label">{t('mlearn.CardEditor.Fields.Word')}</span>
                <span class="mlearn-hover-preview__value">{card().content.front}</span>
              </div>
            </Show>
            <Show when={card().content.reading}>
              <div class="mlearn-hover-preview__field">
                <span class="mlearn-hover-preview__label">{t('mlearn.CardEditor.Fields.Reading')}</span>
                <span class="mlearn-hover-preview__value">{card().content.reading}</span>
              </div>
            </Show>
            <Show when={card().content.back}>
              <div class="mlearn-hover-preview__field">
                <span class="mlearn-hover-preview__label">{t('mlearn.Flashcards.Modals.AddCard.MeaningLabel')}</span>
                <span class="mlearn-hover-preview__value" innerHTML={card().content.back} />
              </div>
            </Show>
            <Show when={card().content.example && card().content.example !== '-'}>
              <div class="mlearn-hover-preview__field">
                <span class="mlearn-hover-preview__label">{t('mlearn.FlashcardChoice.Example')}</span>
                <span class="mlearn-hover-preview__value" innerHTML={truncate(card().content.example!, 200)} />
              </div>
            </Show>
            <Show when={card().ease !== undefined || card().dueDate !== undefined || card().state !== undefined || (card().reviews !== undefined && card().reviews > 0) || (card().lapses !== undefined && card().lapses > 0)}>
              <div class="mlearn-hover-preview__field mlearn-hover-preview__field--meta">
                <Show when={card().ease !== undefined}>
                  <span class="mlearn-hover-preview__label">{t('mlearn.CardEditor.Statistics.Ease')}</span>
                  <span class="mlearn-hover-preview__value">{Math.round(card().ease * 100) / 100}</span>
                </Show>
                <Show when={card().dueDate !== null && card().dueDate !== 0}>
                  <span class="mlearn-hover-preview__label">{t('mlearn.Flashcards.Card.Due')}</span>
                  <span class="mlearn-hover-preview__value">{dueDateToString(card().dueDate, t)}</span>
                </Show>
                <Show when={card().state !== undefined}>
                  <span class="mlearn-hover-preview__label">{t('mlearn.CardEditor.Statistics.State')}</span>
                  <span class="mlearn-hover-preview__value">{card().state}</span>
                </Show>
                <Show when={card().reviews !== undefined && card().reviews > 0}>
                  <span class="mlearn-hover-preview__label">{t('mlearn.CardEditor.Statistics.Reviews')}</span>
                  <span class="mlearn-hover-preview__value">{card().reviews}</span>
                </Show>
                <Show when={card().lapses !== undefined && card().lapses > 0}>
                  <span class="mlearn-hover-preview__label">{t('mlearn.CardEditor.Statistics.Lapses')}</span>
                  <span class="mlearn-hover-preview__value">{card().lapses}</span>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
      <Show when={!props.loading && !props.card}>
        <span class="mlearn-hover-preview__loading">No card found</span>
      </Show>
    </div>
  );
};
