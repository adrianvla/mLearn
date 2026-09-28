import { projectedWordStatus } from '../../../../shared/graph/targets';
import { Show, createMemo, createSignal, type Component } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../../context';
import { openKnowledgeInspector } from '../../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../../services/surfaceKnowledgeInspection';
import { nextAttemptId, type AttemptId } from '../../../../shared/knowledgeEvents';
import { useKnowledgeProjection } from '../../../hooks/useKnowledgeProjection';
import { Button } from '../Button';
import { RatingMatrix, type ProfileObservation, type RateOptions } from '../RatingMatrix';
import { KnowledgeCapabilitySummary } from './KnowledgeCapabilitySummary';
import { isUnmeasuredKnowledge, knowledgeStatusLabelKey } from './knowledgeSummary';
import './WordStatusPillKnowledge.css';

export interface WordStatusPillKnowledgeProps {
  word: string;
  language?: string;
  pinned?: boolean;
  onClose?: () => void;
  onPin?: () => void;
  statusSourceLabel?: string;
}

export const WordStatusPillKnowledge: Component<WordStatusPillKnowledgeProps> = (props) => {
  const { submitRating } = useFlashcards();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const language = () => props.language ?? settings.language;
  const knowledge = useKnowledgeProjection(() => ({ language: language(), surface: props.word }));
  const overall = createMemo(() => projectedWordStatus(knowledge.projection()));
  const [showRate, setShowRate] = createSignal(false);
  const [ratingStatus, setRatingStatus] = createSignal<'idle' | 'saving' | 'failed'>('idle');
  type RatingCommand = {
    observations: readonly { capability: ProfileObservation['capability']; quality: ProfileObservation['quality']; method?: ProfileObservation['method'] }[];
    options: { language: string; attemptId: AttemptId };
  };
  let failedCommand: RatingCommand | undefined;
  const runRating = async (command: RatingCommand) => {
    setRatingStatus('saving');
    try {
      await submitRating(props.word, command.observations, command.options);
      failedCommand = undefined;
      setRatingStatus('idle');
      setShowRate(false);
    } catch {
      failedCommand = command;
      setRatingStatus('failed');
    }
  };
  const submit = (observations: readonly ProfileObservation[], options?: RateOptions) => {
    if (observations.length === 0 || ratingStatus() !== 'idle') return;
    const command: RatingCommand = {
      observations: observations.map(({ capability, quality, method }) => ({
        capability,
        quality,
        ...(method ?? options?.method ? { method: method ?? options?.method } : {}),
      })),
      options: { language: language(), attemptId: nextAttemptId() },
    };
    void runRating(command);
  };
  const inspect = () => {
    openKnowledgeInspector(surfaceKnowledgeInspection(language(), props.word));
    props.onClose?.();
  };
  return <div class={`word-status-knowledge${props.pinned !== false ? ' word-status-knowledge--pinned' : ''}`}>
    <div class="word-status-knowledge__summary">
      <strong>{props.word}</strong>
      <span class={`word-status-knowledge__status word-status-knowledge__status--${isUnmeasuredKnowledge(overall().status, overall().basis) ? 'untracked' : overall().status}`}>
        {t(knowledgeStatusLabelKey(overall().status, overall().basis))}
      </span>
      <Show when={props.pinned !== false}>
        <button type="button" class="word-status-knowledge__close" aria-label={t('mlearn.Global.Close')} onClick={props.onClose}>×</button>
      </Show>
    </div>
    <KnowledgeCapabilitySummary word={props.word} language={language()} projection={knowledge.projection()} />
    <Show when={props.statusSourceLabel}><small class="word-status-knowledge__source">{props.statusSourceLabel}</small></Show>
    <Show when={showRate()}>
      <RatingMatrix
        capabilities={knowledge.capabilities()}
        keyboardMode={settings.ratingKeyboardMode}
        armed={ratingStatus() === 'idle'}
        resetKey={`${language()}:${props.word}`}
        onSubmit={submit}
      />
      <Show when={ratingStatus() === 'saving'}><small role="status">{t('mlearn.Knowledge.Popup.Saving')}</small></Show>
      <Show when={ratingStatus() === 'failed'}>
        <small role="alert">{t('mlearn.Knowledge.Popup.SaveFailed')}</small>
        <Button variant="ghost" size="sm" onClick={() => { if (failedCommand) void runRating(failedCommand); }}>
          {t('mlearn.Knowledge.Popup.Retry')}
        </Button>
      </Show>
    </Show>
    <div class="word-status-knowledge__actions">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={showRate()}
        onClick={() => { if (ratingStatus() !== 'idle') return; props.onPin?.(); setShowRate((shown) => !shown); }}
      >
        {t('mlearn.Knowledge.Popup.Rate')}
      </Button>
      <Button variant="ghost" size="sm" onClick={inspect}>{t('mlearn.Knowledge.Popup.Inspect')}</Button>
    </div>
  </div>;
};
