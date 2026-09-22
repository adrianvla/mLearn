import { createMemo, createSignal, For, Show, onMount, onCleanup, type Component, type JSX } from 'solid-js';
import type { KnowledgeProjection } from '../../../../shared/graph/ipc';
import { CAPABILITY_LABEL_KEYS } from '../../../../shared/graph/access';
import type { CapabilityKey } from '../../../../shared/graph/types';
import { KNOWLEDGE_SOURCE_DISPLAY_NAMES, type KnowledgeSource } from '../../../../shared/constants';
import { effectiveThresholds } from '../../../../shared/knowledge/effectiveKnowledge';
import { useLocalization, useSettings } from '../../../context';
import { useKnowledgeHistory } from '../../../hooks/useKnowledgeHistory';
import { WordEaseTrajectory } from './WordEaseTrajectory';
import { SkeletonRows } from '../Skeleton';
import { PillBtn } from '../Button';
import { knowledgeTrajectoryData, type TrajectoryPoint, type TrajectoryState } from './knowledgeTrajectoryData';

const STATES: readonly TrajectoryState[] = ['known', 'learning', 'unknown', 'unmeasured'];
const LEFT = 124;
const y = (state: TrajectoryState) => 28 + STATES.indexOf(state) * 40;

interface TrajectoryProps { surface: string; language: string; projection?: KnowledgeProjection; currentEase?: number }

export const KnowledgeTrajectory: Component<TrajectoryProps> = (props) => {
  const { t } = useLocalization();
  const [selected, setSelected] = createSignal('overall');
  const capabilities = createMemo(() => [...new Set(props.projection?.targets.flatMap((target) => target.applicableCapabilities) ?? [])]);
  const selector = () => <select class="knowledge-trajectory__select" aria-label={t('mlearn.Knowledge.Projection.TrajectoryCapability')}
    value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
    <option value="overall">{t('mlearn.Knowledge.Projection.EaseOverall')}</option>
    <For each={capabilities()}>{(value) => <option value={value}>{t(CAPABILITY_LABEL_KEYS[value] ?? value)}</option>}</For>
  </select>;
  return <Show when={selected() !== 'overall'} fallback={<WordEaseTrajectory surface={props.surface} language={props.language} selector={selector()} currentEase={props.currentEase} />}>
    <CapabilityTrajectory {...props} capability={selected()} selector={selector()} />
  </Show>;
};

/** Capability history remains categorical and spelling scoped. */
const CapabilityTrajectory: Component<TrajectoryProps & { capability: CapabilityKey; selector: JSX.Element }> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  let container: HTMLElement | undefined;
  const [width, setWidth] = createSignal(640);
  onMount(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  const right = () => width() - 16;
  const [allTime, setAllTime] = createSignal(false);
  const [inspected, setInspected] = createSignal<TrajectoryPoint>();
  const capability = () => props.capability;
  const history = useKnowledgeHistory(() => props.surface, capability, () => props.language);
  const data = createMemo(() => knowledgeTrajectoryData(history.events() ?? [], history.archives(), capability() ?? '', effectiveThresholds(settings)));
  const points = createMemo(() => allTime() ? data().points : data().points.slice(-30));
  const compressed = () => allTime() || !points().length ? data().compressed : [];
  const times = () => [...points().map((point) => point.t), ...compressed().flatMap((range) => [range.from, range.to])];
  const start = () => Math.min(...times());
  const end = () => Math.max(...times());
  const x = (time: number) => start() === end() ? (LEFT + right()) / 2 : LEFT + (time - start()) / (end() - start()) * (right() - LEFT);
  const stateLabel = (state: TrajectoryState) => t(state === 'unmeasured' ? 'mlearn.Knowledge.Projection.TrajectoryUnmeasured' : `mlearn.WordHover.Status.${state[0].toUpperCase()}${state.slice(1)}`);
  const label = (point: TrajectoryPoint) => {
    const event = point.event;
    const kind = event.kind === 'status' && event.source === 'anki' ? 'SourceSnapshot' : event.kind[0].toUpperCase() + event.kind.slice(1);
    const source = t(`mlearn.Knowledge.History.Source.${KNOWLEDGE_SOURCE_DISPLAY_NAMES[event.source as KnowledgeSource]}`);
    const outcome = event.quality ? t(`mlearn.Rating.Matrix.${event.quality[0].toUpperCase()}${event.quality.slice(1)}`) : event.rating ?? '';
    return [new Date(point.t).toLocaleString(), t(event.kind === 'claim' && !event.toStatus ? 'mlearn.Knowledge.Projection.Evidence.ClaimCleared' : `mlearn.Knowledge.History.Kind.${kind}`), source, outcome,
      point.state ? [stateLabel(point.state), point.claim ? t('mlearn.Knowledge.Basis.Claim') : ''].filter(Boolean).join(' · ') : t('mlearn.Knowledge.Projection.TrajectoryGap')].filter(Boolean).join(' · ');
  };
  const paths = createMemo(() => points().slice(1).flatMap((point, index) => {
    const previous = points()[index];
    if (!point.state || !previous.state || data().compressed.some((range) => range.from < point.t && range.to > previous.t)) return [];
    return [`M ${x(previous.t)} ${y(previous.state)} H ${x(point.t)} V ${y(point.state)}`];
  }));
  return <section class="knowledge-trajectory" ref={container}>
    <div class="knowledge-trajectory__controls">
      {props.selector}
      <div class="knowledge-trajectory__range">
        <PillBtn size="sm" variant={!allTime() ? 'blue' : 'gray'} aria-pressed={!allTime()} label={t('mlearn.Knowledge.Projection.TrajectoryRecent')} onClick={() => setAllTime(false)} />
        <PillBtn size="sm" variant={allTime() ? 'blue' : 'gray'} aria-pressed={allTime()} label={t('mlearn.Knowledge.Projection.TrajectoryAll')} onClick={() => setAllTime(true)} />
      </div>
    </div>
    <p class="knowledge-prediction__caption">{t('mlearn.Knowledge.Projection.TrajectoryDescription')}</p>
    <Show when={!history.loading()} fallback={<SkeletonRows rows={3} />}>
      <Show when={!history.error()} fallback={<div class="knowledge-drawer__degraded"><p>{t('mlearn.Knowledge.Projection.TrajectoryUnavailable')}</p><button class="knowledge-card__done" onClick={history.retry}>{t('mlearn.Global.TryAgain')}</button></div>}>
      <Show when={times().length} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.History.Empty')}</p>}>
        <svg class="knowledge-trajectory__svg" viewBox={`0 0 ${width()} 228`} role="group" aria-label={t('mlearn.Knowledge.Projection.Tabs.Graph')}>
          <For each={STATES}>{(state) => <g>
            <text x={LEFT - 12} y={y(state) + 4} text-anchor="end">{stateLabel(state)}</text>
            <line class="knowledge-trajectory__grid" x1={LEFT} x2={right()} y1={y(state)} y2={y(state)} />
          </g>}</For>
          <For each={paths()}>{(d) => <path class="knowledge-trajectory__line" d={d} />}</For>
          <For each={compressed()}>{(range) => <g>
            <rect class="knowledge-trajectory__compressed" x={x(range.from) - 2} y="181" width={Math.max(4, x(range.to) - x(range.from))} height="12">
              <title>{t('mlearn.Knowledge.Projection.TrajectoryCompressed', { count: String(range.count) })} · {new Date(range.from).toLocaleDateString()} – {new Date(range.to).toLocaleDateString()}</title>
            </rect>
          </g>}</For>
          <Show when={compressed().length}><text x={LEFT - 12} y="191" text-anchor="end">{t('mlearn.Knowledge.Projection.TrajectoryArchive')}</text></Show>
          <For each={points()}>{(point) => <g classList={{ 'knowledge-trajectory__point': true, 'knowledge-trajectory__point--claim': point.event.kind === 'claim', 'knowledge-trajectory__point--passive': point.event.source === 'passiveTracking' }}>
            <circle cx={x(point.t)} cy={point.state ? y(point.state) : 187} r="5" tabindex="0" role="button" aria-label={label(point)}
              onMouseEnter={() => setInspected(point)} onFocus={() => setInspected(point)} onClick={() => setInspected(point)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setInspected(point); } }}>
              <title>{label(point)}</title>
            </circle>
          </g>}</For>
          <text x={LEFT} y="221">{new Date(start()).toLocaleDateString()}</text>
          <text x={right()} y="221" text-anchor="end">{new Date(end()).toLocaleDateString()}</text>
        </svg>
        <div class="knowledge-trajectory__legend">
          <span class="knowledge-trajectory__legend-evidence">{t('mlearn.Knowledge.Basis.Evidence')}</span>
          <span class="knowledge-trajectory__legend-claim">{t('mlearn.Knowledge.Basis.Claim')}</span>
          <Show when={points().some((point) => point.event.source === 'passiveTracking')}><span class="knowledge-trajectory__legend-passive">{t('mlearn.Knowledge.History.Source.PassiveTracking')}</span></Show>
        </div>
        <p class="knowledge-trajectory__detail" aria-live="polite">{inspected() && points().includes(inspected()!) ? label(inspected()!) : t('mlearn.Knowledge.Projection.TrajectoryHint')}</p>
      </Show>
      <Show when={data().compressed.length > 0}>
        <p class="knowledge-prediction__caption">{t('mlearn.Knowledge.Projection.TrajectoryCompressed', { count: String(data().compressed.reduce((sum, range) => sum + range.count, 0)) })}</p>
      </Show>
      </Show>
    </Show>
  </section>;
};
