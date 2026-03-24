/**
 * SVG Pie Chart Component
 * Renders a donut/pie chart from segmented data with labels
 */

import { Component, For, Show, createMemo } from 'solid-js';
import './PieChart.css';

export interface PieSegment {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  segments: PieSegment[];
  size?: number;
  thickness?: number;
  showLegend?: boolean;
  centerLabel?: string;
  centerValue?: string | number;
  class?: string;
}

export const PieChart: Component<PieChartProps> = (props) => {
  const size = () => props.size ?? 160;
  const thickness = () => props.thickness ?? 28;
  const radius = () => (size() - thickness()) / 2;
  const center = () => size() / 2;
  const circumference = () => 2 * Math.PI * radius();

  const total = createMemo(() =>
    props.segments.reduce((sum, s) => sum + s.value, 0)
  );

  const arcs = createMemo(() => {
    const t = total();
    if (t === 0) return [];
    let offset = 0;
    return props.segments
      .filter(s => s.value > 0)
      .map(segment => {
        const pct = segment.value / t;
        const dashLength = pct * circumference();
        const dashOffset = -offset * circumference();
        offset += pct;
        return { ...segment, pct, dashLength, dashOffset };
      });
  });

  return (
    <div class={`pie-chart-container ${props.class ?? ''}`}>
      <svg
        width={size()}
        height={size()}
        viewBox={`0 0 ${size()} ${size()}`}
        class="pie-chart-svg"
      >
        {/* Background circle */}
        <circle
          cx={center()}
          cy={center()}
          r={radius()}
          fill="none"
          stroke="var(--bg-intense)"
          stroke-width={thickness()}
        />

        {/* Segments */}
        <For each={arcs()}>
          {(arc) => (
            <circle
              cx={center()}
              cy={center()}
              r={radius()}
              fill="none"
              stroke={arc.color}
              stroke-width={thickness()}
              stroke-dasharray={`${arc.dashLength} ${circumference() - arc.dashLength}`}
              stroke-dashoffset={arc.dashOffset}
              stroke-linecap="butt"
              transform={`rotate(-90 ${center()} ${center()})`}
              class="pie-chart-segment"
            >
              <title>{arc.label}: {arc.value} ({(arc.pct * 100).toFixed(1)}%)</title>
            </circle>
          )}
        </For>

        {/* Center text */}
        <Show when={props.centerValue !== undefined}>
          <text
            x={center()}
            y={center() - 6}
            text-anchor="middle"
            dominant-baseline="middle"
            class="pie-chart-center-value"
          >
            {props.centerValue}
          </text>
          <Show when={props.centerLabel}>
            <text
              x={center()}
              y={center() + 14}
              text-anchor="middle"
              dominant-baseline="middle"
              class="pie-chart-center-label"
            >
              {props.centerLabel}
            </text>
          </Show>
        </Show>
      </svg>

      <Show when={props.showLegend !== false}>
        <div class="pie-chart-legend">
          <For each={props.segments.filter(s => s.value > 0)}>
            {(segment) => (
              <div class="pie-legend-entry">
                <span class="pie-legend-dot" style={{ background: segment.color }} />
                <span class="pie-legend-label">{segment.label}</span>
                <span class="pie-legend-value">{segment.value}</span>
                <span class="pie-legend-pct">
                  {total() > 0 ? ((segment.value / total()) * 100).toFixed(0) : 0}%
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
