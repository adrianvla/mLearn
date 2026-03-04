/**
 * Anki Card Preview Modal
 * Shows the Anki note fields for a word, with HTML rendering.
 */

import { Component, createSignal, For, Show, onMount } from 'solid-js';
import { useLocalization } from '../../../context';
import { Modal, Spinner, AlertBanner, ModalFooter } from '../../../components/common';
import { useAnki, type AnkiNoteInfo } from '../../../hooks/useAnki';
import './AnkiCardPreviewModal.css';

export interface AnkiCardPreviewModalProps {
  word: string;
  isOpen: boolean;
  onClose: () => void;
  /** Optional: allow exporting from the preview */
  onExport?: () => void;
}

export const AnkiCardPreviewModal: Component<AnkiCardPreviewModalProps> = (props) => {
  const { t } = useLocalization();
  const anki = useAnki();
  const [loading, setLoading] = createSignal(true);
  const [note, setNote] = createSignal<AnkiNoteInfo | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const connected = await anki.checkConnection();
      if (!connected) {
        setError(t('mlearn.WordDbEditor.Anki.NotConnected'));
        setLoading(false);
        return;
      }

      const noteIds = await anki.findNotes(props.word);
      if (noteIds.length > 0) {
        const notes = await anki.getNotesInfo(noteIds);
        if (notes.length > 0) {
          setNote(notes[0]);
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
    const n = note();
    if (!n) return [];
    return Object.entries(n.fields)
      .sort(([, a], [, b]) => a.order - b.order);
  };

  const footer = () => {
    if (props.onExport && !note()) {
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

      <Show when={!loading() && note()}>
        <div class="anki-card-preview-modal__content">
          <div class="anki-card-preview-modal__meta">
            <span class="anki-card-preview-modal__model">{note()!.modelName}</span>
            <Show when={note()!.tags.length > 0}>
              <span class="anki-card-preview-modal__tags">
                <For each={note()!.tags}>{(tag) =>
                  <span class="anki-card-preview-modal__tag">{tag}</span>
                }</For>
              </span>
            </Show>
          </div>
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
