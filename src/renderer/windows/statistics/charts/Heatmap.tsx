/**
 * Heatmap Calendar Component
 * GitHub-style contribution heatmap showing daily review activity
 */

import { Component, For, createMemo } from 'solid-js';
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
}

export const Heatmap: Component<HeatmapProps> = (props) => {
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

    const maxVal = Math.max(...allValues, 1);
    return { weeks: days, maxVal };
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

  return (
    <div class={`heatmap-container ${props.class ?? ''}`}>
      <div class="heatmap-grid">
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
                    <div
                      class="heatmap-cell"
                      style={{ background: getColor(day.value, grid().maxVal) }}
                      data-tooltip={formatTooltip(day.date, day.value)}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
