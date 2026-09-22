import { createMemo, createSignal, For, Show, onMount, onCleanup, type Component, type JSX } from 'solid-js';
import { effectiveThresholds } from '../../../../shared/knowledge/effectiveKnowledge';
import { KNOWLEDGE_SOURCE_DISPLAY_NAMES, SRS_EASE } from '../../../../shared/constants';
import { CAPABILITY_LABEL_KEYS } from '../../../../shared/graph/access';
import { eventCapability } from '../../../../shared/knowledgeEvents';
import { useLocalization, useSettings } from '../../../context';
import { useWordEaseHistory } from '../../../hooks/useKnowledgeHistory';
import { PillBtn } from '../Button';
import { SkeletonRows } from '../Skeleton';
import { wordEaseTrajectoryData, type WordEasePoint } from './wordEaseTrajectoryData';

export const WordEaseTrajectory: Component<{ surface: string; language: string; selector: JSX.Element; currentEase?: number }> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const thresholds = () => effectiveThresholds(settings);
  const history = useWordEaseHistory(() => props.surface, () => props.language);
  const data = createMemo(() => wordEaseTrajectoryData(history.entries(), props.language, thresholds()));
  const [allTime, setAllTime] = createSignal(false);
  const [inspected, setInspected] = createSignal<WordEasePoint>();
  const [width, setWidth] = createSignal(640);
  let container: HTMLElement | undefined;
  onMount(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  const points = createMemo(() => allTime() ? data().points : data().points.slice(-30));
  const compressed = () => allTime() || !points().length ? data().compressed : [];
  const times = () => [...points().map((point) => point.t), ...compressed().flatMap((range) => [range.from, range.to])];
  const start = () => Math.min(...times());
  const end = () => Math.max(...times());
  const bands = () => [
    { state: 'Known', from: thresholds().known, to: scale().high },
    { state: 'Learning', from: thresholds().learning, to: thresholds().known },
    { state: 'Unknown', from: scale().low, to: thresholds().learning },
  ];
  const right = () => width() - Math.max(82, ...bands().map((band) => t(`mlearn.WordHover.Status.${band.state}`).length * 7 + 18));
  const x = (time: number) => start() === end() ? (54 + right()) / 2 : 54 + (time - start()) / (end() - start()) * (right() - 54);
  const scale = createMemo(() => {
    const values = points().flatMap((point) => point.ease === undefined ? [] : [point.ease]);
    const low = Math.floor(Math.min(SRS_EASE.MIN, thresholds().learning - 0.1, ...values) * 2) / 2;
    const high = Math.max(thresholds().known + 0.1, ...values);
    const step = Math.max(0.1, Math.ceil((high - low) / 4 * 10) / 10);
    return { low, high: low + step * 4, ticks: Array.from({ length: 5 }, (_, i) => low + step * i) };
  });
  const y = (ease: number) => 174 - (ease - scale().low) / (scale().high - scale().low) * 150;
  const paths = createMemo(() => points().slice(1).flatMap((point, index) => {
    const previous = points()[index];
    if (point.ease === undefined || previous.ease === undefined || data().compressed.some((range) => range.from < point.t && range.to > previous.t)) return [];
    return [`M ${x(previous.t)} ${y(previous.ease)} H ${x(point.t)} V ${y(point.ease)}`];
  }));
  const indices = createMemo(() => new Map(data().points.map((point, index) => [point, index])));
  const label = (point: WordEasePoint) => {
    const event = point.event;
    const capability = eventCapability(event);
    const source = KNOWLEDGE_SOURCE_DISPLAY_NAMES[event.source];
    const kind = event.kind === 'claim' && !event.toStatus ? 'mlearn.Knowledge.Projection.Evidence.ClaimCleared'
      : `mlearn.Knowledge.History.Kind.${event.kind === 'status' && event.source === 'anki' ? 'SourceSnapshot' : event.kind[0].toUpperCase() + event.kind.slice(1)}`;
    const previous = data().points[(indices().get(point) ?? 0) - 1];
    const delta = previous?.ease !== undefined && point.ease !== undefined && !data().compressed.some((range) => range.from < point.t && range.to > previous.t) ? point.ease - previous.ease : undefined;
    const value = point.ease === undefined ? t('mlearn.Knowledge.Projection.TrajectoryGap') : t('mlearn.Knowledge.Projection.EaseValue', { value: point.ease.toFixed(2) });
    return [new Date(point.t).toLocaleString(), t(kind), t(`mlearn.Knowledge.History.Source.${source}`),
      capability ? t(CAPABILITY_LABEL_KEYS[capability] ?? capability) : '', point.word,
      event.quality ? t(`mlearn.Rating.Matrix.${event.quality[0].toUpperCase()}${event.quality.slice(1)}`) : event.rating,
      value, delta === undefined ? '' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`,
    ].filter(Boolean).join(' · ');
  };
  return <section class="knowledge-trajectory" ref={container}>
    <div class="knowledge-trajectory__controls">
      {props.selector}
      <div class="knowledge-trajectory__range">
        <PillBtn size="sm" variant={!allTime() ? 'blue' : 'gray'} aria-pressed={!allTime()} label={t('mlearn.Knowledge.Projection.TrajectoryRecent')} onClick={() => setAllTime(false)} />
        <PillBtn size="sm" variant={allTime() ? 'blue' : 'gray'} aria-pressed={allTime()} label={t('mlearn.Knowledge.Projection.TrajectoryAll')} onClick={() => setAllTime(true)} />
      </div>
    </div>
    <div class="knowledge-ease__summary">
      <p class="knowledge-prediction__caption">{t('mlearn.Knowledge.Projection.EaseDescription')}</p>
      <Show when={props.currentEase !== undefined}><strong>{t('mlearn.Knowledge.Projection.EaseCurrent', { value: props.currentEase!.toFixed(2) })}</strong></Show>
    </div>
    <Show when={!history.loading()} fallback={<SkeletonRows rows={3} />}>
      <Show when={!history.error()} fallback={<div class="knowledge-drawer__degraded"><p>{t('mlearn.Knowledge.Projection.TrajectoryUnavailable')}</p><button class="knowledge-card__done" onClick={history.retry}>{t('mlearn.Global.TryAgain')}</button></div>}>
        <Show when={times().length} fallback={<p class="knowledge-drawer__empty">{t('mlearn.Knowledge.History.Empty')}</p>}>
          <svg class="knowledge-trajectory__svg knowledge-ease__svg" viewBox={`0 0 ${width()} 244`} role="group" aria-label={t('mlearn.Knowledge.Projection.EaseOverall')}>
            <For each={scale().ticks}>{(tick) => <g>
              <text x="42" y={y(tick) + 4} text-anchor="end">{tick.toFixed(1)}</text>
              <line class="knowledge-trajectory__grid" x1="54" x2={right()} y1={y(tick)} y2={y(tick)} />
            </g>}</For>
            <line class="knowledge-trajectory__grid" x1={right()} x2={right()} y1="24" y2="174" />
            <For each={[thresholds().learning, thresholds().known]}>{(threshold) => <line class="knowledge-ease__threshold" x1="54" x2={right() + 5} y1={y(threshold)} y2={y(threshold)} />}</For>
            <For each={bands()}>{(band) => <text class="knowledge-ease__band-label" x={right() + 9} y={y((band.from + band.to) / 2) + 4}>
              {t(`mlearn.WordHover.Status.${band.state}`)}
              <title>{band.state === 'Known' ? `≥ ${band.from.toFixed(2)}` : band.state === 'Unknown' ? `< ${band.to.toFixed(2)}` : `${band.from.toFixed(2)} – < ${band.to.toFixed(2)}`}</title>
            </text>}</For>
            <For each={paths()}>{(d) => <path class="knowledge-trajectory__line" d={d} />}</For>
            <Show when={compressed().length}><text x="54" y="193">{t('mlearn.Knowledge.Projection.TrajectoryArchive')}</text></Show>
            <For each={compressed()}>{(range) => <rect class="knowledge-trajectory__compressed" x={x(range.from) - 2} y="199" width={Math.max(4, x(range.to) - x(range.from))} height="12">
              <title>{t('mlearn.Knowledge.Projection.TrajectoryCompressed', { count: String(range.count) })} · {new Date(range.from).toLocaleDateString()} – {new Date(range.to).toLocaleDateString()}</title>
            </rect>}</For>
            <For each={points()}>{(point) => <g classList={{ 'knowledge-trajectory__point': true, 'knowledge-trajectory__point--claim': point.event.kind === 'claim', 'knowledge-trajectory__point--passive': point.event.source === 'passiveTracking' }}>
              <circle cx={x(point.t)} cy={point.ease === undefined ? 205 : y(point.ease)} r="4" tabindex="0" role="button" aria-label={label(point)}
                onMouseEnter={() => setInspected(point)} onFocus={() => setInspected(point)} onClick={() => setInspected(point)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setInspected(point); } }}><title>{label(point)}</title></circle>
            </g>}</For>
            <text x="54" y="237">{new Date(start()).toLocaleDateString()}</text>
            <text x={right()} y="237" text-anchor="end">{new Date(end()).toLocaleDateString()}</text>
          </svg>
          <div class="knowledge-trajectory__legend">
            <span class="knowledge-trajectory__legend-evidence">{t('mlearn.Knowledge.Basis.Evidence')}</span>
            <span class="knowledge-trajectory__legend-claim">{t('mlearn.Knowledge.Basis.Claim')}</span>
            <Show when={points().some((point) => point.event.source === 'passiveTracking')}><span class="knowledge-trajectory__legend-passive">{t('mlearn.Knowledge.History.Source.PassiveTracking')}</span></Show>
          </div>
          <p class="knowledge-trajectory__detail" aria-live="polite">{inspected() && points().includes(inspected()!) ? label(inspected()!) : t('mlearn.Knowledge.Projection.TrajectoryHint')}</p>
        </Show>
        <Show when={data().compressed.length}><p class="knowledge-prediction__caption">{t('mlearn.Knowledge.Projection.TrajectoryCompressed', { count: String(data().compressed.reduce((sum, range) => sum + range.count, 0)) })}</p></Show>
      </Show>
    </Show>
  </section>;
};
