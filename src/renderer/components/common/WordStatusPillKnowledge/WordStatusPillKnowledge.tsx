import { projectedWordStatus } from '../../../../shared/graph/targets';
import { Show, createMemo, createSignal, type Component } from 'solid-js';
import { useFlashcards, useLocalization, useSettings } from '../../../context';
import { surfaceEntityId } from '../../../../shared/graph/load';
import { hashWordSync } from '../../../services/srsAlgorithm';
import { openKnowledgeInspector } from '../../../services/openKnowledgeInspector';
import { nextAttemptId } from '../../../../shared/knowledgeEvents';
import { useKnowledgeProjection } from '../../../hooks/useKnowledgeProjection';
import { Btn } from '../Button';
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
  const { recordAttempt } = useFlashcards();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const language = () => props.language ?? settings.language;
  const knowledge = useKnowledgeProjection(() => ({ language: language(), surface: props.word }));
  const overall = createMemo(() => projectedWordStatus(knowledge.projection()));
  const [showRate, setShowRate] = createSignal(false);
  const submit = (observations: readonly ProfileObservation[], options?: RateOptions) => {
    if (observations.length === 0) return;
    const attemptId = observations.length > 1 ? nextAttemptId() : undefined;
    for (const observation of observations) {
      recordAttempt(props.word, observation.capability, observation.quality, {
        language: language(),
        method: observation.method ?? options?.method,
        ...(attemptId ? { attemptId } : {}),
      });
    }
  };
  const inspect = () => {
    openKnowledgeInspector({ language: language(), surface: props.word, target: { kind: 'surface', id: surfaceEntityId(language(), hashWordSync(props.word)) } });
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
        armed
        resetKey={`${language()}:${props.word}`}
        onSubmit={submit}
      />
    </Show>
    <div class="word-status-knowledge__actions">
      <Btn
        variant="ghost"
        size="sm"
        aria-expanded={showRate()}
        onClick={() => { props.onPin?.(); setShowRate((shown) => !shown); }}
      >
        {t('mlearn.Knowledge.Popup.Rate')}
      </Btn>
      <Btn variant="ghost" size="sm" onClick={inspect}>{t('mlearn.Knowledge.Popup.Inspect')}</Btn>
    </div>
  </div>;
};
