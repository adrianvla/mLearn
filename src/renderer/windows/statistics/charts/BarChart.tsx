/**
 * Bar Chart Component
 * Vertical bar chart for time-series data (daily reviews, etc.)
 */

import { Component, For, Show, createMemo } from 'solid-js';
import './BarChart.css';

export interface BarChartDataPoint {
  label: string;
  value: number;
  color?: string;
  secondaryValue?: number;
  secondaryColor?: string;
}

interface BarChartProps {
  data: BarChartDataPoint[];
  height?: number;
  showValues?: boolean;
  stacked?: boolean;
  class?: string;
}

export const BarChart: Component<BarChartProps> = (props) => {
  const height = () => props.height ?? 120;

  const maxValue = createMemo(() => {
    if (props.stacked) {
      return Math.max(...props.data.map(d => d.value + (d.secondaryValue ?? 0)), 1);
    }
    return Math.max(...props.data.map(d => Math.max(d.value, d.secondaryValue ?? 0)), 1);
  });

  return (
    <div class={`bar-chart-container ${props.class ?? ''}`}>
      <div class="bar-chart" style={{ height: `${height()}px` }}>
        <For each={props.data}>
          {(point) => {
            const primaryHeight = () => (point.value / maxValue()) * 100;
            const secondaryHeight = () => ((point.secondaryValue ?? 0) / maxValue()) * 100;

            return (
              <div class="bar-chart-column">
                <Show when={props.showValues !== false && (point.value > 0 || (point.secondaryValue ?? 0) > 0)}>
                  <div class="bar-chart-value">
                    {props.stacked
                      ? point.value + (point.secondaryValue ?? 0)
                      : point.value}
                  </div>
                </Show>
                <div class="bar-chart-bar-wrapper">
                  <Show when={props.stacked}>
                    <div class="bar-chart-bar-stacked">
                      <div
                        class="bar-chart-bar"
                        style={{
                          height: `${primaryHeight()}%`,
                          background: point.color ?? 'var(--color-primary)',
                        }}
                      />
                      <Show when={point.secondaryValue}>
                        <div
                          class="bar-chart-bar"
                          style={{
                            height: `${secondaryHeight()}%`,
                            background: point.secondaryColor ?? 'var(--color-success)',
                          }}
                        />
                      </Show>
                    </div>
                  </Show>
                  <Show when={!props.stacked}>
                    <div
                      class="bar-chart-bar"
                      style={{
                        height: `${primaryHeight()}%`,
                        background: point.color ?? 'var(--color-primary)',
                      }}
                    />
                  </Show>
                </div>
                <div class="bar-chart-label">{point.label}</div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
