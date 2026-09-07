import { Component, For, Show, createMemo } from 'solid-js';
import { getAvailableAccesses } from '../../../../shared/types';
import { isReadingScriptText } from '../../../../shared/languageFeatures';
import type { CapabilityKind } from '../../../../shared/graph/types';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../context';
import {
  capabilitySummary,
  knowledgeStatusLabelKey,
  projectionStateForCapability,
  BASIS_LABEL_KEYS,
  type CapabilityEffectiveState,
} from './knowledgeSummary';
import './KnowledgeCapabilitySummary.css';

export interface KnowledgeCapabilitySummaryProps {
  word: string;
  language: string;
  projection?: KnowledgeProjection;
}

/**
 * Compact per-capability knowledge summary (status + basis token) rendered by both
 * the WordStatusPillKnowledge preview and the WordHover knowledge strip — the
 * same derivation, the same queries, so the popover and hover always agree.
 */
export const KnowledgeCapabilitySummary: Component<KnowledgeCapabilitySummaryProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { getComprehensiveWordStatusWithSourceSync, getAccessStatus, isKnowledgeReady } = useFlashcards();
  const { langData, currentLangData } = useLanguage();
  const languageData = createMemo(() => (
    langData[props.language] ?? (props.language === settings.language ? currentLangData() : null)
  ));
  const availableAccesses = createMemo(() => getAvailableAccesses(languageData()));
  const meaningResult = createMemo(() => getComprehensiveWordStatusWithSourceSync(props.word, props.language));
  const capabilityState = (capability: CapabilityKind): CapabilityEffectiveState => {
    if (capability === 'sense-recognition') {
      const meaning = meaningResult();
      return { status: meaning.status, basis: meaning.basis === 'unmeasured' ? undefined : meaning.basis };
    }
    const state = getAccessStatus(props.word, capability, props.language);
    return { status: state.status, untracked: state.untracked === true, basis: state.basis, claim: state.claim };
  };

  const rows = createMemo(() => {
    // Unresolved ≠ Untracked: while the learner projection hydrates, access
    // records are absent because the store is empty, not because the learner
    // is unmeasured. Render nothing instead of a wall of false Untracked.
    if (!isKnowledgeReady()) return [];
    const word = props.word;
    // Applicable targets only; Untracked stays visible — it is the honest
    // "no measurement yet" state, not noise. Same-script reading is not a target.
    return availableAccesses()
      .filter((capability) => !(capability === 'surface-reading' && isReadingScriptText(word, languageData())))
      .map((capability) => capabilitySummary(capability, capabilityState(capability), meaningResult(), projectionStateForCapability(props.projection, capability)));
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