/**
 * Anki Card Preview Modal
 * Shows the Anki note fields for a word, with HTML rendering.
 */

import { Component, createSignal, For, Show, onMount } from 'solid-js';
import { useLocalization } from '../../../context';
import { Modal, Spinner, AlertBanner, ModalFooter } from '../../../components/common';
import { getBackend } from '../../../../shared/backends';
import { dueDateToString } from '../../../services/srsAlgorithm';
import { getAnkiDueDisplayValue, shouldShowAnkiEase, type AnkiCardSchedulingInfo } from '../../../components/common/AnkiHoverPreview/ankiHoverPreviewLogic';
import './AnkiCardPreviewModal.css';

interface CardFields {
  [fieldName: string]: { value: string; order: number };
}

export interface AnkiCardPreviewModalProps {
  word: string;
  isOpen: boolean;
  onClose: () => void;
  /** Optional: allow exporting from the preview */
  onExport?: () => void;
}

export const AnkiCardPreviewModal: Component<AnkiCardPreviewModalProps> = (props) => {
  const { t } = useLocalization();
  const [loading, setLoading] = createSignal(true);
  const [cardFields, setCardFields] = createSignal<CardFields | null>(null);
  const [cardInfo, setCardInfo] = createSignal<AnkiCardSchedulingInfo | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const result = await getBackend().getCard({ word: props.word }) as { cards: Array<Record<string, unknown>>; error: boolean };
      if (!result.error && result.cards.length > 0) {
        const card = result.cards[0];
        if (card.fields) {
          setCardFields(card.fields as CardFields);
          setCardInfo({
            ease: typeof card.factor === 'number' ? card.factor : null,
            due: typeof card.due === 'number' ? card.due : null,
            queue: typeof card.queue === 'number' ? card.queue : null,
            type: typeof card.type === 'number' ? card.type : null,
            interval: typeof card.interval === 'number' ? card.interval : null,
            mod: typeof card.mod === 'number' ? card.mod : null,
          });
        } else {
          setError(t('mlearn.WordDbEditor.Anki.NoCardFound'));
        }
      } else {
        setError(t('mlearn.WordDbEditor.Anki.NoCardFound'));
      }
    } catch (e) {
      console.error(e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  });

  const sortedFields = () => {
    const fields = cardFields();
    if (!fields) return [];
    return Object.entries(fields)
      .sort(([, a], [, b]) => a.order - b.order);
  };

  const footer = () => {
    if (props.onExport && !cardFields()) {
      return (
        <ModalFooter
          cancelText={t('mlearn.Global.Close')}
          onCancel={props.onClose}
          confirmText={t('mlearn.WordDbEditor.Anki.ExportToAnki')}
          onConfirm={props.onExport}
        />
      );
    }
    return undefined;
  };

  const dueValue = () => getAnkiDueDisplayValue(
    cardInfo(),
    (timestamp) => dueDateToString(timestamp, t),
    t('mlearn.Flashcards.Card.Unseen'),
  );

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('mlearn.WordDbEditor.Anki.PreviewTitle', { word: props.word })}
      size="lg"
      footer={footer()}
    >
      <Show when={loading()}>
        <Spinner size={32} shape="square" text={t('mlearn.Global.Loading')} />
      </Show>

      <Show when={!loading() && error()}>
        <AlertBanner variant="warning" message={error()!} />
      </Show>

      <Show when={!loading() && cardFields()}>
        <div class="anki-card-preview-modal__content">
          <div class="anki-card-preview-modal__fields">
            <For each={sortedFields()}>{([fieldName, fieldData]) =>
              <div class="anki-card-preview-modal__field">
                <div class="anki-card-preview-modal__field-name">{fieldName}</div>
                <div
                  class="anki-card-preview-modal__field-value"
                  innerHTML={fieldData.value || '<em class="anki-card-preview-modal__empty">' + t('mlearn.WordDbEditor.Anki.EmptyField') + '</em>'}
                />
              </div>
            }</For>
            <Show when={shouldShowAnkiEase(cardInfo()?.ease)}>
              <div class="anki-card-preview-modal__field">
                <div class="anki-card-preview-modal__field-name">{t('mlearn.Flashcards.Card.Ease')}</div>
                <div class="anki-card-preview-modal__field-value">{cardInfo()!.ease}</div>
              </div>
            </Show>
            <Show when={dueValue()}>
              <div class="anki-card-preview-modal__field">
                <div class="anki-card-preview-modal__field-name">{t('mlearn.Flashcards.Card.Due')}</div>
                <div class="anki-card-preview-modal__field-value">{dueValue()!}</div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </Modal>
  );
};

export default AnkiCardPreviewModal;
