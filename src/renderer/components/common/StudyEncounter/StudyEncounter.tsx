import { type Component, type JSX, Show } from 'solid-js';
import { useLocalization } from '../../../context';
import { Button } from '../Button';
import { Panel } from '../Panel';
import { RatingMatrix, type RatingMatrixProps } from '../RatingMatrix/RatingMatrix';
import './StudyEncounter.css';

/** One retrieval interaction, independent of which activity supplied the material. */
export interface StudyEncounterProps {
  prompt: JSX.Element;
  instruction?: string;
  answer: JSX.Element;
  revealed: boolean;
  onReveal: () => void;
  revealDisabled?: boolean;
  onSkip?: () => void;
  skipDisabled?: boolean;
  rating: RatingMatrixProps;
  children?: JSX.Element;
  answerControls?: JSX.Element;
  class?: string;
}

export const StudyEncounter: Component<StudyEncounterProps> = (props) => {
  const { t } = useLocalization();
  return (
    <section class={`study-encounter ${props.class ?? ''}`} aria-label={t('mlearn.StudyEncounter.Task')}>
      <p class="study-encounter__instruction">{props.revealed ? t('mlearn.StudyEncounter.Compare') : props.instruction ?? t('mlearn.StudyEncounter.Retrieve')}</p>
      <Panel class="study-encounter__card" padding="lg">
        <div class="study-encounter__prompt">{props.prompt}</div>
        <Show when={props.revealed} fallback={
          <Button variant="primary" disabled={props.revealDisabled} onClick={props.onReveal} class="study-encounter__reveal">
            {t('mlearn.StudyEncounter.Reveal')}
          </Button>
        }>
          <div class="study-encounter__answer">{props.answer}</div>
          {props.answerControls}
        </Show>
      </Panel>
      <div class="study-encounter__response" hidden={!props.revealed}>
          <p class="study-encounter__consequence">{t('mlearn.StudyEncounter.Consequence')}</p>
          <RatingMatrix {...props.rating} armed={props.revealed && props.rating.armed} scheduling={false} />
      </div>
      <div class="study-encounter__secondary">
        {props.children}
        <Show when={props.onSkip}>
          <Button variant="ghost" disabled={props.skipDisabled} onClick={() => props.onSkip?.()} class="study-encounter__skip">
            {t('mlearn.LevelStudy.Placement.Skip')}
          </Button>
        </Show>
      </div>
    </section>
  );
};
