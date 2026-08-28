import { Component, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { getAvailableAspects } from '../../../../shared/types';
import { isReadingScriptText } from '../../../../shared/languageFeatures';
import { nextAttemptId } from '../../../../shared/knowledgeEvents';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import { Btn } from '../Button';
import { RatingMatrix, type ProfileObservation } from '../RatingMatrix';
import { KnowledgeCapabilitySummary } from './KnowledgeCapabilitySummary';
import { isUntrackedKnowledge, knowledgeStatusLabelKey } from './knowledgeSummary';
import { openWordDbEditor } from '../../../services/openWordDbEditor';
import './WordStatusPillKnowledge.css';

export interface WordStatusPillKnowledgeProps {
  word: string;
  language?: string;
  pinned?: boolean;
  onClose?: () => void;
  /** Pin the owner tooltip — the rating matrix is keyboard-driven and must stay up mid-rating. */
  onPin?: () => void;
  statusSourceLabel?: string;
}

/**
 * The word knowledge popup: overall status, the shared per-aspect capability
 * summary (compact presentation), and exactly two actions — Rate… (measured
 * attempt evidence, matrix on request only) and Inspect… (full Word DB
 * inspector). Deliberate Unknown/Learning/claim-clear editing lives in the
 * inspector; the fast Known path is the pill click itself.
 */
export const WordStatusPillKnowledge: Component<WordStatusPillKnowledgeProps> = (props) => {
  const { getComprehensiveWordStatusWithSourceSync, recordAttempt } = useFlashcards();
  const { settings } = useSettings();
  const { langData, currentLangData } = useLanguage();
  const { t } = useLocalization();
  const [projection, setProjection] = createSignal<KnowledgeProjection>();
  const [showRate, setShowRate] = createSignal(false);
  const [projectionKey, setProjectionKey] = createSignal('');
  const isPinned = () => props.pinned ?? true;

  const effectiveLanguage = createMemo(() => props.language ?? settings.language);
  const isActiveLanguage = createMemo(() => effectiveLanguage() === settings.language);
  const languageData = createMemo(() => langData[effectiveLanguage()] ?? (isActiveLanguage() ? currentLangData() : null));
  const availableAspects = createMemo(() => getAvailableAspects(languageData()));
  const meaningResult = createMemo(() => getComprehensiveWordStatusWithSourceSync(props.word, effectiveLanguage()));
  // Rows the matrix can test: every language-offered aspect; reading is not a
  // target when the surface itself is the reading script. Untracked aspects
  // stay — Untracked is exactly what a rating measures.
  const applicableAspects = createMemo(() => availableAspects().filter(
    (aspect) => !(aspect === 'reading' && isReadingScriptText(props.word, languageData())),
  ));

  createEffect(() => {
    const key = `${effectiveLanguage()}:${props.word}`;
    if (projectionKey() === key) return;
    setProjectionKey(key);
    void getBridge().graph.getKnowledgeProjection(effectiveLanguage(), props.word)
      .then(setProjection)
      .catch(() => setProjection(undefined));
  });

  const submitProfile = (observations: readonly ProfileObservation[]) => {
    const attemptId = nextAttemptId();
    for (const observation of observations) {
      recordAttempt(props.word, observation.aspect, observation.quality, {
        language: effectiveLanguage(), method: observation.method ?? 'recall', attemptId,
      });
    }
    setShowRate(false);
    props.onClose?.();
  };

  return (
    <div class={`word-status-knowledge${isPinned() ? ' word-status-knowledge--pinned' : ''}`}>
      <div class="word-status-knowledge__summary">
        <strong>{props.word}</strong>
        <span class={`word-status-knowledge__status word-status-knowledge__status--${isUntrackedKnowledge(meaningResult().status, meaningResult().basis) ? 'untracked' : meaningResult().status}`}>
          {t(knowledgeStatusLabelKey(meaningResult().status, meaningResult().basis))}
        </span>
        <Show when={isPinned()}>
          <button type="button" class="word-status-knowledge__close" aria-label={t('mlearn.Global.Close')} onClick={props.onClose}>×</button>
        </Show>
      </div>
      <KnowledgeCapabilitySummary word={props.word} language={effectiveLanguage()} projection={projection()} />
      <Show when={props.statusSourceLabel}>
        <small class="word-status-knowledge__source">{props.statusSourceLabel}</small>
      </Show>
      <Show when={showRate()}>
        <RatingMatrix
          aspects={applicableAspects()}
          keyboardMode={settings.ratingKeyboardMode}
          armed
          mode="profile"
          resetKey={`${props.word}:${effectiveLanguage()}`}
          onRate={() => undefined}
          onProfileSubmit={submitProfile}
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
        <Btn variant="ghost" size="sm" onClick={() => openWordDbEditor(props.word)}>
          {t('mlearn.Knowledge.Popup.Inspect')}
        </Btn>
      </div>
    </div>
  );
};
