/**
 * FlashcardCreationChoiceModal
 * Shown when use_anki is enabled and a flashcard is about to be created.
 * Lets the user choose between saving to the app's SRS or exporting to Anki.
 */

import { Component, Show, createSignal, createMemo } from 'solid-js';
import { Modal, ToggleSwitch } from '../common';
import { ModalFooter } from '../common/Misc/ModalFooter';
import { useFlashcards } from '../../context/FlashcardContext';
import { useSettings, useLocalization } from '../../context';
import { useAnki } from '../../hooks/useAnki';
import { showToast } from '../common/Feedback/Toast';
import type { PendingFlashcardChoice } from '../../context/FlashcardContext';
import './FlashcardCreationChoiceModal.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.flashcardCreationChoiceModal");

interface FlashcardCreationChoiceModalProps {
  choice: PendingFlashcardChoice;
  onClose: () => void;
}

const FlashcardCreationChoiceModalInner: Component<FlashcardCreationChoiceModalProps> = (props) => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();
  const anki = useAnki();
  const [useAnkiTarget, setUseAnkiTarget] = createSignal(true);
  const [isExporting, setIsExporting] = createSignal(false);
  const [dontShowAgain, setDontShowAgain] = createSignal(false);

  const content = createMemo(() => props.choice.content);

  const handleConfirm = async () => {
    // If "don't show again" is checked and SRS is selected, persist the setting
    if (dontShowAgain() && !useAnkiTarget()) {
      updateSetting('flashcardSkipAnkiChoice', true);
    }

    if (useAnkiTarget()) {
      // Export to Anki
      setIsExporting(true);
      try {
        const c = content();
        const noteId = await anki.addNote({
          word: c.front,
          reading: c.reading,
          meaning: c.back,
          sentence: c.example,
          sentenceMeaning: c.exampleMeaning,
          audioUrl: c.audioUrl,
          imageUrl: c.imageUrl,
        });
        if (noteId) {
          showToast({ message: t('mlearn.FlashcardChoice.AnkiSuccess'), variant: 'success' });
          props.choice.resolve('anki');
        } else {
          showToast({ message: t('mlearn.FlashcardChoice.AnkiError'), variant: 'error' });
        }
      } catch (err) {
        log.error('Failed to export to Anki:', err);
        showToast({ message: t('mlearn.FlashcardChoice.AnkiError'), variant: 'error' });
      } finally {
        setIsExporting(false);
        props.onClose();
      }
    } else {
      // Save to SRS
      props.choice.resolve('srs');
      props.onClose();
    }
  };

  const handleCancel = () => {
    props.choice.resolve('cancel');
    props.onClose();
  };

  const fieldExpression = () => settings.anki_field_expression || 'Expression';
  const fieldReading = () => settings.anki_field_reading || 'Reading';
  const fieldMeaning = () => settings.anki_field_meaning || 'Meaning';

  return (
    <Modal
      isOpen={true}
      onClose={handleCancel}
      title={t('mlearn.FlashcardChoice.Title')}
      size="md"
      footer={
        <ModalFooter
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          cancelText={t('mlearn.Global.Cancel')}
          confirmText={useAnkiTarget() ? t('mlearn.FlashcardChoice.ExportToAnki') : t('mlearn.FlashcardChoice.SaveToSRS')}
          loading={isExporting()}
        />
      }
    >
      <div class="flashcard-choice__body">
        <div class="flashcard-choice__toggle-row">
          <span class="flashcard-choice__toggle-label">
            {t('mlearn.FlashcardChoice.SaveToSRS')}
          </span>
          <ToggleSwitch
            checked={useAnkiTarget()}
            onChange={setUseAnkiTarget}
          />
          <span class="flashcard-choice__toggle-label">
            {t('mlearn.FlashcardChoice.ExportToAnki')}
          </span>
        </div>

        <div class="flashcard-choice__preview">
          <Show when={useAnkiTarget()}>
            <div class="flashcard-choice__fields">
              <div class="flashcard-choice__field">
                <span class="flashcard-choice__field-name">{fieldExpression()}</span>
                <span class="flashcard-choice__field-value" innerHTML={content().front} />
              </div>
              <Show when={content().reading}>
                <div class="flashcard-choice__field">
                  <span class="flashcard-choice__field-name">{fieldReading()}</span>
                  <span class="flashcard-choice__field-value" innerHTML={content().reading} />
                </div>
              </Show>
              <div class="flashcard-choice__field">
                <span class="flashcard-choice__field-name">{fieldMeaning()}</span>
                <span class="flashcard-choice__field-value" innerHTML={content().back} />
              </div>
              <Show when={content().example}>
                <div class="flashcard-choice__field">
                  <span class="flashcard-choice__field-name">{t('mlearn.FlashcardChoice.Example')}</span>
                  <span class="flashcard-choice__field-value" innerHTML={content().example} />
                </div>
              </Show>
            </div>
          </Show>

          <Show when={!useAnkiTarget()}>
            <div class="flashcard-choice__srs-preview">
              <div class="flashcard-choice__srs-front" innerHTML={content().front} />
              <div class="flashcard-choice__srs-divider" />
              <div class="flashcard-choice__srs-back" innerHTML={content().back} />
              <Show when={content().reading}>
                <div class="flashcard-choice__srs-reading">{content().reading}</div>
              </Show>
              <Show when={content().example}>
                <div class="flashcard-choice__srs-divider" />
                <div class="flashcard-choice__srs-example" innerHTML={content().example} />
                <Show when={content().exampleMeaning}>
                  <div class="flashcard-choice__srs-example-meaning">{content().exampleMeaning}</div>
                </Show>
              </Show>
            </div>
          </Show>
        </div>

        <Show when={!useAnkiTarget()}>
          <div class="flashcard-choice__dont-show-row">
            <ToggleSwitch
                checked={dontShowAgain()}
                onChange={setDontShowAgain}
            />
            <span class="flashcard-choice__dont-show-label">
              {t('mlearn.FlashcardChoice.DontShowAgain')}
            </span>
          </div>
        </Show>
        <Show when={content().videoUrl} fallback={
          <Show when={content().imageUrl}>
            <div class="flashcard-choice__media">
              <img src={content().imageUrl!} alt="" />
            </div>
          </Show>
        }>
          <div class="flashcard-choice__media">
            <video
              src={content().videoUrl!}
              controls
              preload="metadata"
            />
          </div>
        </Show>

      </div>
    </Modal>
  );
};

/** Wrapper that reads from FlashcardContext */
export const FlashcardCreationChoiceModal: Component = () => {
  const { pendingFlashcardChoice, resolvePendingFlashcardChoice } = useFlashcards();

  return (
    <Show when={pendingFlashcardChoice()}>
      {(choice) => (
        <FlashcardCreationChoiceModalInner
          choice={choice()}
          onClose={() => resolvePendingFlashcardChoice('cancel')}
        />
      )}
    </Show>
  );
};
