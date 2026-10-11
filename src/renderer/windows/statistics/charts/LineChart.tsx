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
  valueUnit?: string;
  class?: string;
}

const VIEW_W = 100;
// Keep enough width for a readable month label even in a narrow dashboard card.
const MAX_X_LABELS = 5;

export const LineChart: Component<LineChartProps> = (props) => {
  const height = () => props.height ?? 100;
  const visibleLabels = createMemo(() => {
    const points = props.data;
    if (points.length <= MAX_X_LABELS) return points;
    return Array.from({ length: MAX_X_LABELS }, (_, index) => {
      const sourceIndex = Math.round(index * (points.length - 1) / (MAX_X_LABELS - 1));
      return points[sourceIndex];
    });
  });

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
  const valueRange = createMemo(() => {
    const values = props.data.map(point => point.value);
    return values.length ? { min: Math.min(0, ...values), max: Math.max(0, ...values) } : { min: 0, max: 0 };
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
      <div class="line-chart-value-range" aria-label={`${valueRange().min.toFixed(1)}–${valueRange().max.toFixed(1)} ${props.valueUnit ?? ''}`}>
        <span>{valueRange().min.toFixed(1)}</span><span>{props.valueUnit}</span><span>{valueRange().max.toFixed(1)}</span>
      </div>
      <div class="line-chart-labels">
        <For each={visibleLabels()}>
          {(point) => (
            <span class="line-chart-label" title={point.label}>
              {point.label}
            </span>
          )}
        </For>
      </div>
    </div>
  );
};
