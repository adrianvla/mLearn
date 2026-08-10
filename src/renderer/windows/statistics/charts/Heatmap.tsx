/**
 * Heatmap Calendar Component
 * GitHub-style contribution heatmap showing daily review activity
 */

import { Component, For, createMemo } from 'solid-js';
import { Tooltip } from '../../../components/common';
import { useLocalization } from '../../../context';
import './Heatmap.css';

interface HeatmapDay {
  date: string;
  value: number;
}

interface HeatmapProps {
  data: Record<string, number>; // YYYY-MM-DD -> count
  weeks?: number;
  colorScale?: string[];
  class?: string;
  /** Custom tooltip formatter. Receives (date, value). Defaults to "{date}: {value} reviews" */
  formatTooltip?: (date: string, value: number) => string;
  /** Formatter for the legend max-value caption. Defaults to "Max: {count}". */
  formatMax?: (max: number) => string;
}

export const Heatmap: Component<HeatmapProps> = (props) => {
  const { t } = useLocalization();
  const weeks = () => props.weeks ?? 20;

  const colorScale = () => props.colorScale ?? [
    'var(--bg-intense)',
    'color-mix(in srgb, var(--color-primary) 25%, transparent)',
    'color-mix(in srgb, var(--color-primary) 50%, transparent)',
    'color-mix(in srgb, var(--color-primary) 75%, transparent)',
    'var(--color-primary)',
  ];

  const grid = createMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay(); // 0=Sun
    const totalDays = weeks() * 7;

    // Start from the beginning of the earliest week
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - totalDays + (7 - dayOfWeek));

    const days: HeatmapDay[][] = [];
    let currentWeek: HeatmapDay[] = [];
    const allValues: number[] = [];

    for (let i = 0; i < totalDays + dayOfWeek + 1; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      if (d > today) break;

      const dateStr = d.toISOString().slice(0, 10);
      const value = props.data[dateStr] ?? 0;
      allValues.push(value);

      if (currentWeek.length === 7) {
        days.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push({ date: dateStr, value });
    }
    if (currentWeek.length > 0) {
      days.push(currentWeek);
    }

    // Label each month at the week containing its 1st — month starts are ≥28
    // days apart, so labels can never land on adjacent week slots and collide.
    const monthLabels: string[] = [];
    for (const week of days) {
      const firstOfMonth = week.find((d) => d.date.endsWith('-01'));
      monthLabels.push(
        firstOfMonth
          ? new Date(firstOfMonth.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' })
          : '',
      );
    }

    const maxVal = Math.max(...allValues, 1);
    return { weeks: days, maxVal, monthLabels };
  });

  const getColor = (value: number, maxVal: number) => {
    const scale = colorScale();
    if (value === 0) return scale[0];
    const ratio = value / maxVal;
    if (ratio <= 0.25) return scale[1];
    if (ratio <= 0.50) return scale[2];
    if (ratio <= 0.75) return scale[3];
    return scale[4];
  };

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  const formatTooltip = (date: string, value: number) =>
    props.formatTooltip ? props.formatTooltip(date, value) : `${date}: ${value}`;

  const maxCaption = () =>
    props.formatMax ? props.formatMax(grid().maxVal) : t('mlearn.Statistics.Dashboard.Heatmap.Max', { count: grid().maxVal });

  return (
    <div class={`heatmap-container ${props.class ?? ''}`}>
      <div class="heatmap-grid">
        <div class="heatmap-month-labels">
          <div class="heatmap-month-label-spacer" />
          <For each={grid().monthLabels}>
            {(label) => <div class="heatmap-month-label">{label}</div>}
          </For>
        </div>
        <div class="heatmap-body">
          <div class="heatmap-row">
            <div class="heatmap-day-labels">
              <For each={dayLabels}>
                {(label) => <div class="heatmap-day-label">{label}</div>}
              </For>
            </div>
            <div class="heatmap-weeks">
              <For each={grid().weeks}>
                {(week) => (
                  <div class="heatmap-week">
                    <For each={week}>
                      {(day) => (
                        <Tooltip content={formatTooltip(day.date, day.value)} position="top">
                          <div
                            class="heatmap-cell"
                            role="img"
                            tabindex={0}
                            aria-label={formatTooltip(day.date, day.value)}
                            style={{ background: getColor(day.value, grid().maxVal) }}
                          />
                        </Tooltip>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div class="heatmap-legend">
            <span>{t('mlearn.Statistics.Dashboard.Heatmap.Less')}</span>
            <For each={colorScale()}>
              {(color) => <span class="heatmap-legend-swatch" style={{ background: color }} />}
            </For>
            <span>{t('mlearn.Statistics.Dashboard.Heatmap.More')}</span>
            <span class="heatmap-legend-max">{maxCaption()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
