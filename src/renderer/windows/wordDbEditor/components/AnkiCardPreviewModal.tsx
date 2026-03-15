/**
 * Anki Card Preview Modal
 * Shows the Anki note fields for a word, with HTML rendering.
 */

import { Component, createSignal, For, Show, onMount } from 'solid-js';
import { useLocalization } from '../../../context';
import { Modal, Spinner, AlertBanner, ModalFooter } from '../../../components/common';
import { getBackend } from '../../../../shared/backends';
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
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const result = await getBackend().getCard({ word: props.word }) as { cards: any[]; error: boolean };
      if (!result.error && result.cards.length > 0) {
        const card = result.cards[0];
        if (card.fields) {
          setCardFields(card.fields);
        } else {
          setError(t('mlearn.WordDbEditor.Anki.NoCardFound'));
        }
      } else {
        setError(t('mlearn.WordDbEditor.Anki.NoCardFound'));
      }
    } catch (e) {
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
          </div>
        </div>
      </Show>
    </Modal>
  );
};

export default AnkiCardPreviewModal;
