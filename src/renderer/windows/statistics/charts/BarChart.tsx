/**
 * Bar Chart Component
 * Vertical bar chart for time-series data (daily reviews, etc.)
 */

import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Tooltip } from '../../../components/common';
import { selectAxisTicks } from '../../../components/flashcard/barChartTicks';
import './BarChart.css';

export interface BarChartDataPoint {
  label: string;
  value: number;
  color?: string;
  secondaryValue?: number;
  secondaryColor?: string;
  tooltip?: string;
}

interface BarChartProps {
  data: BarChartDataPoint[];
  height?: number;
  valueMax?: number;
  showValues?: boolean;
  stacked?: boolean;
  formatValue?: (value: number) => string;
  class?: string;
}

export const BarChart: Component<BarChartProps> = (props) => {
  const height = () => props.height ?? 120;

  let chartElement: HTMLDivElement | undefined;
  // The axis can only be labelled as densely as the rendered columns allow.
  // A fixed stride ignores how narrow the card actually is, so the labels
  // are chosen from the measured column width instead of the data index.
  const [labelledTicks, setLabelledTicks] = createSignal<ReadonlyMap<number, 'center' | 'left' | 'right'>>(new Map());

  const relabel = () => {
    if (!chartElement) return;
    const columnWidth = chartElement.clientWidth / Math.max(1, props.data.length);
    if (columnWidth <= 0) return;
    // Measure with the label's own typography, not the container's.
    const label = chartElement.querySelector('.bar-chart-label');
    const labelFont = label ? getComputedStyle(label).font : '';
    const ticks = selectAxisTicks(
      props.data.map(point => point.label),
      columnWidth,
      text => {
        const probe = chartElement!.ownerDocument.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
        if (labelFont) probe.style.font = labelFont;
        probe.textContent = text;
        chartElement!.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return width;
      },
    );
    setLabelledTicks(new Map(ticks.map(tick => [tick.index, tick.align])));
  };

  onMount(() => {
    const observer = new ResizeObserver(relabel);
    if (chartElement) observer.observe(chartElement);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    props.data.map(point => point.label);
    relabel();
  });

  const maxValue = createMemo(() => {
    const observedMax = props.stacked
      ? Math.max(...props.data.map(d => d.value + (d.secondaryValue ?? 0)), 0)
      : Math.max(...props.data.map(d => Math.max(d.value, d.secondaryValue ?? 0)), 0);
    return Math.max(props.valueMax ?? 0, observedMax, 1);
  });

  return (
    <div class={`bar-chart-container ${props.class ?? ''}`}>
      <div class="bar-chart" ref={chartElement} style={{ height: `${height()}px` }}>
        <For each={props.data}>
          {(point, index) => {
            const primaryHeight = () => (point.value / maxValue()) * 100;
            const secondaryHeight = () => ((point.secondaryValue ?? 0) / maxValue()) * 100;

            const barSlot = (
              <div class="bar-chart-bar-wrapper" role="img" tabindex={point.tooltip ? 0 : undefined} aria-label={point.tooltip}>
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
            );

            return (
              <div class="bar-chart-column">
                <Show when={props.showValues !== false && (point.value > 0 || (point.secondaryValue ?? 0) > 0)}>
                  <div class="bar-chart-value">
                    {props.stacked
                      ? props.formatValue?.(point.value + (point.secondaryValue ?? 0)) ?? point.value + (point.secondaryValue ?? 0)
                      : props.formatValue?.(point.value) ?? point.value}
                  </div>
                </Show>
                <Show when={point.tooltip} fallback={barSlot}>
                  <Tooltip content={point.tooltip!}>{barSlot}</Tooltip>
                </Show>
                <div
                  class="bar-chart-label"
                  classList={{
                    'bar-chart-label-positioned': labelledTicks().has(index()),
                    'bar-chart-label-left': labelledTicks().get(index()) === 'left',
                    'bar-chart-label-center': labelledTicks().get(index()) === 'center',
                    'bar-chart-label-right': labelledTicks().get(index()) === 'right',
                  }}
                  title={labelledTicks().has(index()) ? point.label : undefined}
                >
                  {labelledTicks().has(index()) ? point.label : ''}
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
