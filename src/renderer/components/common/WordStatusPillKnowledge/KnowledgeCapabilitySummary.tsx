import { Component, For, Show, createMemo } from 'solid-js';
import { getAvailableAspects } from '../../../../shared/types';
import { isReadingScriptText } from '../../../../shared/languageFeatures';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../context';
import {
  aspectCapabilitySummary,
  knowledgeStatusLabelKey,
  projectionStateForAspect,
  BASIS_LABEL_KEYS,
  type AspectEffectiveState,
} from './knowledgeSummary';
import './KnowledgeCapabilitySummary.css';

export interface KnowledgeCapabilitySummaryProps {
  word: string;
  language: string;
  projection?: KnowledgeProjection;
}

/**
 * Compact per-aspect capability summary (status + basis token) rendered by both
 * the WordStatusPillKnowledge preview and the WordHover knowledge strip — the
 * same derivation, the same queries, so the popover and hover always agree.
 */
export const KnowledgeCapabilitySummary: Component<KnowledgeCapabilitySummaryProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { getComprehensiveWordStatusWithSourceSync, getAspectStatus, isKnowledgeReady } = useFlashcards();
  const { langData, currentLangData } = useLanguage();
  const languageData = createMemo(() => (
    langData[props.language] ?? (props.language === settings.language ? currentLangData() : null)
  ));
  const availableAspects = createMemo(() => getAvailableAspects(languageData()));
  const meaningResult = createMemo(() => getComprehensiveWordStatusWithSourceSync(props.word, props.language));
  const aspectState = (aspect: KnowledgeAspect): AspectEffectiveState => {
    if (aspect === 'meaning') {
      const meaning = meaningResult();
      return { status: meaning.status, basis: meaning.basis === 'unmeasured' ? undefined : meaning.basis };
    }
    const state = getAspectStatus(props.word, aspect, props.language);
    return { status: state.status, untracked: state.untracked === true, basis: state.basis, claim: state.claim };
  };

  const rows = createMemo(() => {
    // Unresolved ≠ Untracked: while the learner projection hydrates, aspect
    // records are absent because the store is empty, not because the learner
    // is unmeasured. Render nothing instead of a wall of false Untracked.
    if (!isKnowledgeReady()) return [];
    const word = props.word;
    // Applicable targets only; Untracked stays visible — it is the honest
    // "no measurement yet" state, not noise. Same-script reading is not a target.
    return availableAspects()
      .filter((aspect) => !(aspect === 'reading' && isReadingScriptText(word, languageData())))
      .map((aspect) => aspectCapabilitySummary(aspect, aspectState(aspect), meaningResult(), projectionStateForAspect(props.projection, aspect)));
  });

  return <Show when={rows().length > 0}>
    <span class="knowledge-capability-summary" role="list" aria-label={t('mlearn.Knowledge.Projection.Capabilities')}>
      <For each={rows()}>{(row) => (
        <span
          class={`knowledge-capability-summary__item knowledge-capability-summary__item--${row.basis}`}
          title={`${t(row.labelKey)} · ${t(knowledgeStatusLabelKey(row.status, row.basis, row.untracked))} · ${t(BASIS_LABEL_KEYS[row.basis])}`}
        >
          <span class="knowledge-capability-summary__mark" aria-hidden="true" />
          <span class="knowledge-capability-summary__label">{t(row.labelKey)}</span>
          <span class={`knowledge-capability-summary__status knowledge-capability-summary__status--${row.status}`}>{t(knowledgeStatusLabelKey(row.status, row.basis, row.untracked))}</span>
        </span>
      )}</For>
    </span>
  </Show>;
};