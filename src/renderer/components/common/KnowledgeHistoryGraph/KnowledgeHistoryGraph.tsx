import { Component, For, Show, createMemo } from 'solid-js';
import { useLocalization } from '../../../context';
import type { KnowledgeAspect } from '../../../../shared/knowledgeEvents';
import type { HistoryCurvePoint, SourceReignBand } from '../../../utils/knowledgeHistory';
import './KnowledgeHistoryGraph.css';

const VIEW_WIDTH = 320;
const PAD_TOP = 10;
const PAD_RIGHT = 6;
const PAD_BOTTOM = 6;
const PAD_LEFT = 6;
const MARKER_RADIUS = 2.5;
const ROLLUP_RADIUS = 1.5;
const STATUS_TRIANGLE_RADIUS = 4;
const RATING_SQUARE_SIZE = 5;
const BAND_STRIP_HEIGHT = 4;
// Normalized-strength midpoint of the learning→known range: below = learning.
const LEARNING_THRESHOLD_STRENGTH = 0.5;

const ASPECT_LABEL_KEYS: Record<KnowledgeAspect, string> = {
  meaning: 'mlearn.Knowledge.Aspect.Meaning',
  reading: 'mlearn.Knowledge.Aspect.Reading',
  prosody: 'mlearn.Knowledge.Aspect.Prosody',
};

export interface KnowledgeHistoryGraphProps {
  points: HistoryCurvePoint[];
  bands: SourceReignBand[];
  aspect: KnowledgeAspect;
  availableAspects: readonly KnowledgeAspect[];
  onAspectChange: (aspect: KnowledgeAspect) => void;
  mode: 'compact' | 'full';
  now: number;
  firstSeen?: number;
}

export const KnowledgeHistoryGraph: Component<KnowledgeHistoryGraphProps> = (props) => {
  const { t } = useLocalization();

  const viewHeight = () => (props.mode === 'compact' ? 56 : 120);

  const startTime = createMemo(() => {
    const first = props.points[0]?.t;
    if (first === undefined) return props.now;
    if (props.firstSeen !== undefined && props.firstSeen < first) return props.firstSeen;
    return first;
  });

  const endTime = createMemo(() => Math.max(props.now, props.points[props.points.length - 1]?.t ?? props.now));

  const plotWidth = () => VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = () => viewHeight() - PAD_TOP - PAD_BOTTOM;

  const x = (time: number): number => {
    const span = endTime() - startTime();
    return span > 0 ? PAD_LEFT + ((time - startTime()) / span) * plotWidth() : PAD_LEFT;
  };

  const y = (strength: number): number => {
    const clamped = Math.max(0, Math.min(1, strength));
    return PAD_TOP + (1 - clamped) * plotHeight();
  };

  const linePath = createMemo(() => {
    const pts = props.points;
    if (pts.length === 0) return '';
    const first = pts[0];
    const path: string[] = [`M ${x(startTime())} ${y(0)}`];
    if (startTime() < first.t) {
      path.push(`L ${x(first.t)} ${y(0)}`);
    }
    path.push(`L ${x(first.t)} ${y(first.strength)}`);
    for (let i = 1; i < pts.length; i += 1) {
      path.push(`L ${x(pts[i].t)} ${y(pts[i - 1].strength)}`);
      path.push(`L ${x(pts[i].t)} ${y(pts[i].strength)}`);
    }
    return path.join(' ');
  });

  const markerLabel = (point: HistoryCurvePoint): string => {
    const parts = [`${point.kind}`, point.source, `strength ${point.strength.toFixed(2)}`];
    if (point.event.easeAfter !== undefined) parts.push(`ease ${point.event.easeAfter}`);
    if (point.event.rating) parts.push(point.event.rating);
    return parts.join(' · ');
  };

  const markerCenter = (point: HistoryCurvePoint): { cx: number; cy: number } => ({
    cx: x(point.t),
    cy: y(point.strength),
  });

  const renderMarker = (point: HistoryCurvePoint) => {
    const classes = `khistory-marker khistory-marker-${point.source} khistory-shape-${point.kind}`;
    const { cx, cy } = markerCenter(point);
    const label = markerLabel(point);
    if (point.kind === 'status') {
      const r = STATUS_TRIANGLE_RADIUS;
      return (
        <path
          class={classes}
          d={`M ${cx} ${cy - r} L ${cx - r} ${cy + r} L ${cx + r} ${cy + r} Z`}
        >
          <title>{label}</title>
        </path>
      );
    }
    if (point.kind === 'rating') {
      const half = RATING_SQUARE_SIZE / 2;
      return (
        <rect class={classes} x={cx - half} y={cy - half} width={RATING_SQUARE_SIZE} height={RATING_SQUARE_SIZE}>
          <title>{label}</title>
        </rect>
      );
    }
    return (
      <circle class={classes} cx={cx} cy={cy} r={point.kind === 'rollup' ? ROLLUP_RADIUS : MARKER_RADIUS}>
        <title>{label}</title>
      </circle>
    );
  };

  return (
    <div class={`khistory khistory-mode-${props.mode}`}>
      <div class="khistory-tabs" role="tablist">
        <For each={props.availableAspects}>
          {(aspect) => (
            <button
              type="button"
              role="tab"
              aria-selected={aspect === props.aspect}
              class={`khistory-tab${aspect === props.aspect ? ' khistory-tab-active' : ''}`}
              onClick={() => props.onAspectChange(aspect)}
            >
              {t(ASPECT_LABEL_KEYS[aspect])}
            </button>
          )}
        </For>
      </div>
      <Show
        when={props.points.length > 0}
        fallback={<div class="khistory-empty">{t('mlearn.Knowledge.History.Empty')}</div>}
      >
        <svg
          class="khistory-svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight()}`}
          role="img"
          aria-label="knowledge history"
        >
          <For each={props.bands}>
            {(band) => (
              <rect
                class={`khistory-band khistory-band-${band.source}`}
                x={x(band.from)}
                y={viewHeight() - PAD_BOTTOM - BAND_STRIP_HEIGHT}
                width={Math.max(0, x(band.to) - x(band.from))}
                height={BAND_STRIP_HEIGHT}
              />
            )}
          </For>
          <line
            class="khistory-threshold"
            x1={PAD_LEFT}
            y1={y(LEARNING_THRESHOLD_STRENGTH)}
            x2={VIEW_WIDTH - PAD_RIGHT}
            y2={y(LEARNING_THRESHOLD_STRENGTH)}
          />
          <path class="khistory-line" d={linePath()} />
          <For each={props.points}>{(point) => renderMarker(point)}</For>
        </svg>
        <div class="khistory-xaxis">
          <span>{new Date(startTime()).toLocaleDateString()}</span>
          <span>{new Date(endTime()).toLocaleDateString()}</span>
        </div>
      </Show>
    </div>
  );
};
