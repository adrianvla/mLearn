import { createEffect, createSignal, on, Show } from 'solid-js';
import { useLocalization } from '../../context';
import './FlashcardImage.css';

export type FlashcardImageProps = {
  src: string;
  alt?: string;
  class?: string;
};

export function FlashcardImage(props: FlashcardImageProps) {
  const { t } = useLocalization();
  const [failed, setFailed] = createSignal(false);
  createEffect(on(() => props.src, () => setFailed(false)));

  return (
    <Show
      when={!failed()}
      fallback={
        <div class={`flashcard-image-unavailable ${props.class ?? ''}`}>
          {t('mlearn.Flashcards.Card.ImageUnavailable')}
        </div>
      }
    >
      <img
        src={props.src}
        alt={props.alt ?? ''}
        class={props.class}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}
