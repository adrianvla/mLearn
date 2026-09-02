/**
 * Line Chart Component
 * SVG trend line for time-series data (cohort medians, slopes)
 */

import { Component, For, createMemo } from 'solid-js';
import './LineChart.css';

export interface LineChartPoint {
  label: string;
  value: number;
  tooltip?: string;
}

interface LineChartProps {
  data: LineChartPoint[];
  height?: number;
  class?: string;
}

const VIEW_W = 100;
// Dense series (24+ monthly cohorts) can't fit one label per point.
const MAX_X_LABELS = 6;

export const LineChart: Component<LineChartProps> = (props) => {
  const height = () => props.height ?? 100;
  const labelEvery = createMemo(() => Math.max(1, Math.ceil(props.data.length / MAX_X_LABELS)));

  const geometry = createMemo(() => {
    const points = props.data;
    if (points.length === 0) return { line: '', ticks: [] as { x: number; y: number; tooltip: string }[] };
    const max = Math.max(...points.map((p) => p.value), 0);
    const min = Math.min(...points.map((p) => p.value), 0);
    const range = max - min || 1;
    const pad = 4;
    const y = (value: number) => pad + ((max - value) / range) * (height() - 2 * pad);
    const x = (index: number) => (points.length === 1 ? VIEW_W / 2 : (index / (points.length - 1)) * VIEW_W);
    return {
      line: points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' '),
      ticks: points.map((p, i) => ({ x: x(i), y: y(p.value), tooltip: p.tooltip ?? `${p.label}: ${p.value}` })),
    };
  });

  return (
    <div class={`line-chart-container ${props.class ?? ''}`}>
      <svg
        class="line-chart-svg"
        viewBox={`0 0 ${VIEW_W} ${height()}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ height: `${height()}px` }}
      >
        <polyline points={geometry().line} class="line-chart-line" />
        <For each={geometry().ticks}>
          {(tick) => (
            <line x1={tick.x} y1={tick.y - 3} x2={tick.x} y2={tick.y + 3} class="line-chart-tick">
              <title>{tick.tooltip}</title>
            </line>
          )}
        </For>
      </svg>
      <div class="line-chart-labels">
        <For each={props.data}>
          {(point, i) => (
            <span class="line-chart-label">
              {i() % labelEvery() === 0 || i() === props.data.length - 1 ? point.label : ''}
            </span>
          )}
        </For>
      </div>
    </div>
  );
};
