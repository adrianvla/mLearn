import { type Component, type JSX, Show, createMemo } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useLocalization } from '../../../context';
import { Button } from '../Button';
import { ProgressBar } from '../Feedback/ProgressBar';
import { Panel } from '../Panel';
import { RatingMatrix, type RatingMatrixProps } from '../RatingMatrix/RatingMatrix';
import './StudyEncounter.css';

/** One retrieval interaction, independent of which activity supplied the material. */
export interface StudyEncounterProps {
  card?: JSX.Element;
  controlsMount?: HTMLElement;
  scheduling?: boolean;
  revealClass?: string;
  responseClass?: string;
  prompt: JSX.Element;
  instruction?: string;
  answer: JSX.Element;
  revealed: boolean;
  onReveal: () => void;
  revealDisabled?: boolean;
  revealLabel?: string;
  onSkip?: () => void;
  skipDisabled?: boolean;
  /** Suppress recall affordances after reference consultation or prior answer exposure. */
  ratingAvailable?: boolean;
  rating: RatingMatrixProps;
  children?: JSX.Element;
  answerControls?: JSX.Element;
  class?: string;
}

export const StudyEncounter: Component<StudyEncounterProps> = (props) => {
  const { t } = useLocalization();
  const card = createMemo(() => props.card);
  const rating = createMemo(() => props.rating);
  const revealed = createMemo(() => props.revealed);
  const ratingArmed = createMemo(() => revealed() && rating().armed);
  const controlsHost = document.createElement('div');
  const controls = <>
    <Show when={card() && !revealed()}>
      <Button variant="primary" size="lg" disabled={props.revealDisabled} onClick={props.onReveal}
        class={props.revealClass ?? 'study-encounter__reveal'}>{props.revealLabel ?? t('mlearn.StudyEncounter.Reveal')}</Button>
    </Show>
    <Show when={props.ratingAvailable !== false}><div class={`study-encounter__response ${props.responseClass ?? ''}`} hidden={!props.revealed}>
      <Show when={!props.scheduling || props.revealed}><RatingMatrix {...rating()} armed={ratingArmed()} scheduling={props.scheduling ?? false} /></Show>
    </div></Show>
    <div class="study-encounter__secondary">
      {props.children}
      <Show when={props.onSkip}>
        <Button variant="ghost" disabled={props.skipDisabled} onClick={() => props.onSkip?.()} class="study-encounter__skip">
          {t('mlearn.LevelStudy.Placement.Skip')}
        </Button>
      </Show>
    </div>
  </>;
  return <section class={`study-encounter ${props.class ?? ''}`} aria-label={t('mlearn.StudyEncounter.Task')}>
    <Show when={props.ratingAvailable !== false}><p class="study-encounter__instruction">{props.revealed ? t('mlearn.StudyEncounter.Compare') : props.instruction ?? t('mlearn.StudyEncounter.Retrieve')}</p></Show>
    <Show when={card()} fallback={<Panel class="study-encounter__card" padding="lg">
      <div class="study-encounter__prompt">{props.prompt}</div>
      <Show when={props.revealed} fallback={
        <Button variant="primary" disabled={props.revealDisabled} onClick={props.onReveal} class="study-encounter__reveal">
          {props.revealLabel ?? t('mlearn.StudyEncounter.Reveal')}
        </Button>
      }>
        <div class="study-encounter__answer">{props.answer}</div>
        {props.answerControls}
      </Show>
    </Panel>}>{card()}</Show>
    {controlsHost}
    <Portal mount={props.controlsMount ?? controlsHost}>{controls}</Portal>
  </section>;
};

/** A single encounter counter across retrieval families, separate from evidence rows. */
export const StudySessionHUD: Component<{ completed: number; total: number; label?: JSX.Element; class?: string }> = props => {
  const { t } = useLocalization();
  return <div class={`study-encounter__hud ${props.class ?? ''}`} role="status">
    <span>{props.label ?? t('mlearn.StudyEncounter.Progress', { count: props.completed, total: props.total })}</span>
    <ProgressBar value={props.total > 0 ? props.completed / props.total * 100 : 100} size="md" />
  </div>;
};
