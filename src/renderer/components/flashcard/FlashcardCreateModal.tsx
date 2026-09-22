import { Component, createSignal, Show } from 'solid-js';
import { useLocalization } from '../../context';
import { Btn, Input, Modal } from '../common';
import type { FlashcardContent } from '../../../shared/types';

export const FlashcardCreateModal: Component<{
  isOpen: boolean;
  onClose: () => void;
  onAdd: (content: FlashcardContent) => Promise<unknown>;
}> = (props) => {
  const { t } = useLocalization();
  // Add card form state (simple mode)
  const [newWord, setNewWord] = createSignal('');
  const [addingCard, setAddingCard] = createSignal(false);
  const [addCardFailed, setAddCardFailed] = createSignal(false);
  const [newReading, setNewReading] = createSignal('');
  const [newMeaning, setNewMeaning] = createSignal('');

  const handleAddCard = async () => {
    if (addingCard() || !newWord().trim() || !newMeaning().trim()) return;
    setAddingCard(true);
    setAddCardFailed(false);
    try {
      await props.onAdd({ type: 'word', front: newWord().trim(), back: newMeaning().trim(), reading: newReading().trim() || undefined });
      setNewWord('');
      setNewReading('');
      setNewMeaning('');
      props.onClose();
    } catch {
      setAddCardFailed(true);
    } finally {
      setAddingCard(false);
    }
  };

  const close = () => { if (!addingCard()) props.onClose(); };
  return (
      <Modal
        isOpen={props.isOpen}
        onClose={close}
        title={t('mlearn.Flashcards.Modals.AddCard.Title')}
        footer={
          <>
            <Btn onClick={close} disabled={addingCard()}>{t('mlearn.Global.Cancel')}</Btn>
            <Btn variant="primary" onClick={handleAddCard} disabled={addingCard() || !newWord().trim() || !newMeaning().trim()}>{t('mlearn.Flashcards.Modals.AddCard.Submit')}</Btn>
          </>
        }
      >
        <div class="flashcards-add-form" aria-busy={addingCard()}>
          <Show when={addCardFailed()}><p role="alert">{t('mlearn.Flashcards.Modals.AddCard.Error')}</p></Show>
          <Input disabled={addingCard()}
            label={t('mlearn.Flashcards.Modals.AddCard.WordLabel')}
            value={newWord()}
            onInput={(e) => setNewWord(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.WordPlaceholder')}
            fullWidth
          />
          <Input disabled={addingCard()}
            label={t('mlearn.Flashcards.Modals.AddCard.ReadingLabel')}
            value={newReading()}
            onInput={(e) => setNewReading(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.ReadingPlaceholder')}
            fullWidth
          />
          <Input disabled={addingCard()}
            label={t('mlearn.Flashcards.Modals.AddCard.MeaningLabel')}
            value={newMeaning()}
            onInput={(e) => setNewMeaning(e.currentTarget.value)}
            placeholder={t('mlearn.Flashcards.Modals.AddCard.MeaningPlaceholder')}
            fullWidth
          />
        </div>
      </Modal>

  );
};
