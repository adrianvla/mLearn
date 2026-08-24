import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import type { KnowledgeProjection, KnowledgeProjectionState } from '../../../../shared/graph/ipc';
import { useLocalization } from '../../../context';
import './KnowledgeProjection.css';

type Tone = 'evidence' | 'predicted' | 'unmeasured' | 'excluded';

export const knowledgeTone = (state: Pick<KnowledgeProjectionState, 'basis' | 'classification'>): Tone => {
  if (state.classification === 'excluded' || state.basis === 'excluded') return 'excluded';
  if (state.basis === 'evidence') return 'evidence';
  if (state.basis === 'prediction') return 'predicted';
  return 'unmeasured';
};

export const knowledgeStateLabelKey = (state: Pick<KnowledgeProjectionState, 'basis' | 'classification'>): string => {
  const tone = knowledgeTone(state);
  if (tone === 'evidence') return `mlearn.Knowledge.Projection.Evidence.${state.classification === 'known' ? 'Known' : 'Learning'}`;
  return `mlearn.Knowledge.Projection.${tone[0].toUpperCase()}${tone.slice(1)}`;
};

interface ProjectionProps {
  projection: KnowledgeProjection | undefined;
}

export const KnowledgeCapabilityChips: Component<ProjectionProps> = (props) => {
  const { t } = useLocalization();
  const states = createMemo(() => props.projection?.targets.flatMap((target) => target.states) ?? []);

  return <Show when={props.projection?.status === 'ready' && states().length > 0}>
    <span class="knowledge-capability-chips" title={t('mlearn.Knowledge.Projection.Capabilities')}>
      <For each={states()}>{(state) => <span class={`knowledge-chip knowledge-chip--${knowledgeTone(state)}`}>
        <span aria-hidden="true">{knowledgeTone(state) === 'evidence' ? '●' : '◐'}</span>
        {t(`mlearn.Knowledge.Capability.${state.capability}`)}
        <Show when={Object.keys(state.evidenceSourceCounts).length > 0}>
          <small title={Object.entries(state.evidenceSourceCounts).map(([source, count]) => `${source}: ${count}`).join(', ')}>
            {Object.values(state.evidenceSourceCounts).reduce((sum, count) => sum + count, 0)}
          </small>
        </Show>
      </span>}</For>
    </span>
  </Show>;
};

export const KnowledgeProjectionDrawer: Component<ProjectionProps & { open: boolean; onClose: () => void; onGraph?: (entityId: string) => void }> = (props) => {
  const { t } = useLocalization();
  const [selected, setSelected] = createSignal(0);
  const states = createMemo(() => props.projection?.targets.flatMap((target) => target.states.map((state) => ({ state, entityId: target.targetRef.id }))) ?? []);
  const active = createMemo(() => states()[Math.min(selected(), Math.max(states().length - 1, 0))]);

  return <Show when={props.open}>
    <aside class="knowledge-drawer" aria-label={t('mlearn.Knowledge.Projection.Details')}>
      <header class="knowledge-drawer__header">
        <strong>{t('mlearn.Knowledge.Projection.Details')}</strong>
        <button type="button" class="knowledge-drawer__close" onClick={props.onClose} aria-label={t('mlearn.Global.Close')}>×</button>
      </header>
      <Show when={states().length > 0} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.Projection.Unavailable')}</p>}>
        <div class="knowledge-drawer__tabs" role="tablist">
          <For each={states()}>{({ state }, index) => <button type="button" role="tab" aria-selected={selected() === index()} class={selected() === index() ? 'is-active' : ''} onClick={() => setSelected(index())}>
            {t(`mlearn.Knowledge.Capability.${state.capability}`)}
          </button>}</For>
        </div>
        <Show when={active()}>{(item) => <section class={`knowledge-drawer__state knowledge-state--${knowledgeTone(item().state)}`}>
          <p class="knowledge-drawer__label">{t(knowledgeStateLabelKey(item().state))}</p>
          <Show when={item().state.strength}>{(strength) => <p>{t('mlearn.Knowledge.Projection.Strength', { ease: strength().ease.toFixed(2), seen: String(strength().timesSeen), hovered: String(strength().timesHovered) })}</p>}</Show>
          <Show when={item().state.retention}>{(retention) => <p>{t('mlearn.Knowledge.Projection.Retention', { pressure: retention().pressure.toFixed(2), due: new Date(retention().dueAt).toLocaleString() })}</p>}</Show>
          <Show when={(item().state.prediction?.reasons.length ?? 0) > 0}><div><strong>{t('mlearn.Knowledge.Projection.Because')}</strong><ul><For each={item().state.prediction?.reasons ?? []}>{(reason) => <li>{reason}</li>}</For></ul></div></Show>
          <h3>{t('mlearn.Knowledge.Projection.Evidence.Title')}</h3>
          <Show when={item().state.evidence.length > 0} fallback={<p>{t('mlearn.Knowledge.Projection.Evidence.None')}</p>}>
            <ul class="knowledge-drawer__evidence"><For each={item().state.evidence}>{(evidence) => <li>{new Date(evidence.timestamp).toLocaleString()} · {evidence.source}<Show when={evidence.quality}> · {evidence.quality}</Show>{evidence.latencyMs !== undefined && ` · ${evidence.latencyMs}ms`}</li>}</For></ul>
            <p class="knowledge-drawer__provenance">{Object.entries(item().state.evidenceSourceCounts).map(([source, count]) => `${source} ${count}`).join(' · ')}</p>
          </Show>
          <Show when={props.onGraph}><button type="button" class="knowledge-drawer__graph" onClick={() => props.onGraph?.(item().entityId)}>{t('mlearn.Knowledge.Projection.Graph')}</button></Show>
        </section>}</Show>
      </Show>
    </aside>
  </Show>;
};
