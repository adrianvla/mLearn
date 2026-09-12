import { For, Show, createMemo, type Component } from 'solid-js';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import { CAPABILITY_LABEL_KEYS } from '../../../../shared/graph/access';
import { useLocalization } from '../../../context';
import { useKnowledgeProjection } from '../../../hooks/useKnowledgeProjection';
import { knowledgeStatusLabelKey, projectionStateForCapability, BASIS_LABEL_KEYS } from './knowledgeSummary';
import './KnowledgeCapabilitySummary.css';

export interface KnowledgeCapabilitySummaryProps {
  word: string;
  language: string;
  projection?: KnowledgeProjection;
}

export const KnowledgeCapabilitySummary: Component<KnowledgeCapabilitySummaryProps> = (props) => {
  const { t } = useLocalization();
  const queried = useKnowledgeProjection(() => props.projection ? undefined : { language: props.language, surface: props.word });
  const projection = () => props.projection ?? queried.projection();
  const rows = createMemo(() => [...new Set(projection()?.targets.flatMap((target) => target.applicableCapabilities) ?? [])].flatMap((capability) => {
    const state = projectionStateForCapability(projection(), capability);
    if (!state || state.basis === 'unmeasured') return [];
    return [{
      capability,
      labelKey: CAPABILITY_LABEL_KEYS[capability] ?? capability,
      basis: state.basis,
      status: state.classification === 'known' ? 'known' as const : state.classification === 'learning' ? 'learning' as const : 'unknown' as const,
    }];
  }));
  return <Show when={rows().length > 0}>
    <span class="knowledge-capability-summary" role="list" aria-label={t('mlearn.Knowledge.Projection.Capabilities')}>
      <For each={rows()}>{(row) => (
        <span class={`knowledge-capability-summary__item knowledge-capability-summary__item--${row.basis}`}
          title={`${t(row.labelKey)} · ${t(knowledgeStatusLabelKey(row.status, row.basis))} · ${t(BASIS_LABEL_KEYS[row.basis])}`}>
          <span class="knowledge-capability-summary__mark" aria-hidden="true" />
          <span class="knowledge-capability-summary__label">{t(row.labelKey)}</span>
          <span class={`knowledge-capability-summary__status knowledge-capability-summary__status--${row.status}`}>{t(knowledgeStatusLabelKey(row.status, row.basis))}</span>
        </span>
      )}</For>
    </span>
  </Show>;
};
