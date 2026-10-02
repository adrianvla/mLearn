import { projectedWordStatus } from '../../../../shared/graph/targets';
import { Show, createMemo, createSignal, type Component } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../../context';
import { openKnowledgeInspector } from '../../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../../services/surfaceKnowledgeInspection';
import { nextAttemptId, type AttemptId } from '../../../../shared/knowledgeEvents';
import { useKnowledgeProjection } from '../../../hooks/useKnowledgeProjection';
import { Button } from '../Button';
import { RatingMatrix, type ProfileObservation, type RateOptions } from '../RatingMatrix';
import { WriteStatusBanner } from '../WriteStatusBanner';
import type { StudyWriteState } from '../../../learning/studySession';
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
  // The acknowledged-write lifecycle is owned by the study session
  // contract, like every other surface that files a study write. This
  // surface used to keep its own 'idle' | 'saving' | 'failed' vocabulary
  // and hand-rolled the banner, which is how a rating failure ended up
  // worded and retried differently here than in flashcard review, word
  // sync and grammar coverage.
  const [ratingWrite, setRatingWrite] = createSignal<StudyWriteState | null>(null);
  type RatingCommand = {
    word: string;
    observations: readonly { capability: ProfileObservation['capability']; quality: ProfileObservation['quality']; method?: ProfileObservation['method'] }[];
    options: { language: string; attemptId: AttemptId; selfAssessment: true };
  };
  let failedCommand: RatingCommand | undefined;
  const runRating = async (command: RatingCommand) => {
    setRatingWrite('pending');
    try {
      await submitRating(command.word, command.observations, command.options);
      failedCommand = undefined;
      setRatingWrite(null);
      setShowRate(false);
    } catch {
      failedCommand = command;
      setRatingWrite('failed');
    }
  };
  const submit = (observations: readonly ProfileObservation[], options?: RateOptions) => {
    if (observations.length === 0 || ratingWrite() !== null) return;
    const command: RatingCommand = {
      word: props.word,
      observations: observations.map(({ capability, quality, method }) => ({
        capability,
        quality,
        ...(method ?? options?.method ? { method: method ?? options?.method } : {}),
      })),
      options: { language: language(), attemptId: nextAttemptId(), selfAssessment: true },
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
      <small class="word-status-knowledge__source">{t('mlearn.Knowledge.Popup.SelfAssessment')}</small>
      <RatingMatrix
        capabilities={knowledge.capabilities()}
        keyboardMode={settings.ratingKeyboardMode}
        armed={ratingWrite() === null}
        resetKey={`${language()}:${props.word}`}
        onSubmit={submit}
      />
      <WriteStatusBanner
        status={ratingWrite()}
        savingLabelKey="mlearn.Knowledge.Popup.Saving"
        failedLabelKey="mlearn.Knowledge.Popup.SaveFailed"
        canRetry={ratingWrite() === 'failed' && failedCommand !== undefined}
        onRetry={() => { if (failedCommand) void runRating(failedCommand); }}
        retryLabelKey="mlearn.Knowledge.Popup.Retry"
      />
    </Show>
    <div class="word-status-knowledge__actions">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={showRate()}
        onClick={() => { if (ratingWrite() !== null) return; props.onPin?.(); setShowRate((shown) => !shown); }}
      >
        {t('mlearn.Knowledge.Popup.Rate')}
      </Button>
      <Button variant="ghost" size="sm" onClick={inspect}>{t('mlearn.Knowledge.Popup.Inspect')}</Button>
    </div>
  </div>;
};
