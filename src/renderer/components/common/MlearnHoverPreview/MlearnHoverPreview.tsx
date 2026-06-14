import { Component, JSX, Show, createMemo } from 'solid-js';
import { useLocalization } from '../../../context';
import { dueDateToString } from '../../../services/srsAlgorithm';
import type { Flashcard } from '../../../../shared/types';
import './MlearnHoverPreview.css';

export interface MlearnHoverPreviewProps {
  card: Flashcard | null;
  loading?: boolean;
  footer?: JSX.Element;
}

export const MlearnHoverPreview: Component<MlearnHoverPreviewProps> = (props) => {
  const { t } = useLocalization();

  const truncate = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  };

  const metaFooter = createMemo(() => {
    const card = props.card;
    if (!card) return null;

    const parts: string[] = [];

    if (card.ease !== undefined) {
      parts.push(`${t('mlearn.CardEditor.Statistics.Ease')} ${Math.round(card.ease * 100) / 100}`);
    }

    if (card.dueDate !== null && card.dueDate !== 0) {
      parts.push(`${t('mlearn.Flashcards.Card.Due')} ${dueDateToString(card.dueDate, t)}`);
    }

    if (card.state !== undefined) {
      parts.push(`${t('mlearn.CardEditor.Statistics.State')} ${card.state}`);
    }

    if (card.reviews !== undefined && card.reviews > 0) {
      parts.push(`${t('mlearn.CardEditor.Statistics.Reviews')} ${card.reviews}`);
    }

    if (card.lapses !== undefined && card.lapses > 0) {
      parts.push(`${t('mlearn.CardEditor.Statistics.Lapses')} ${card.lapses}`);
    }

    return parts.length > 0 ? parts.join(' | ') : null;
  });

  return (
    <div class="mlearn-hover-preview">
      <Show when={props.loading}>
        <span class="mlearn-hover-preview__loading">{t('mlearn.Global.Loading')}</span>
      </Show>
      <Show when={!props.loading && props.card}>
        {(card) => (
          <>
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
            </div>
            <Show when={metaFooter()}>
              <div class="mlearn-hover-preview__footer">{metaFooter()}</div>
            </Show>
            <Show when={props.footer}>
              {props.footer}
            </Show>
          </>
        )}
      </Show>
      <Show when={!props.loading && !props.card}>
        <span class="mlearn-hover-preview__loading">No card found</span>
      </Show>
    </div>
  );
};
