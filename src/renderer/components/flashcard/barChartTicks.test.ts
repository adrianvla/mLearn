import { describe, expect, it } from 'vitest';
import { selectAxisTicks } from './barChartTicks';

/** Fixed-width measurer: every glyph is `perChar` wide. */
const fixed = (perChar: number) => (text: string) => text.length * perChar;

/** Thirty day-of-month labels, the densest axis the app actually renders. */
const dayAxis = Array.from({ length: 30 }, (_, index) => String(index + 1));

describe('selectAxisTicks', () => {
  it('keeps every label when the axis is sparse enough', () => {
    const labels = ['A', 'B', 'C', 'D'];
    const ticks = selectAxisTicks(labels, 40, fixed(8));
    expect(ticks.map(tick => tick.index)).toEqual([0, 1, 2, 3]);
    // Interior labels centre; the endpoints anchor inward so they are not clipped.
    expect(ticks.map(tick => tick.align)).toEqual(['left', 'center', 'center', 'right']);
  });

  it('keeps every label on a dense axis that still has room between ticks', () => {
    // 2-char labels are 12px; adjacent ticks at 26px leave 24.7px of gap.
    expect(selectAxisTicks(dayAxis, 26, fixed(6))).toHaveLength(30);
  });

  it('thins the axis by striding instead of dropping it entirely', () => {
    // At 14px slots only every third pair of labels clears its neighbour.
    const ticks = selectAxisTicks(dayAxis, 14, fixed(6));
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks.length).toBeLessThan(30);
    // Retained labels must never be closer than one skipped tick.
    const indices = ticks.map(tick => tick.index);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i] - indices[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it('never lets two retained labels overlap', () => {
    for (const slot of [6, 8, 10, 12, 14, 16, 20, 24, 26, 30, 40]) {
      const indices = selectAxisTicks(dayAxis, slot, fixed(6)).map(tick => tick.index);
      for (let i = 1; i < indices.length; i++) {
        const gap = (indices[i] - indices[i - 1]) * slot;
        expect(12).toBeLessThanOrEqual(gap);
      }
    }
  });

  it('falls back to the range endpoints when nothing can fit', () => {
    // 30 labels of 12px in slots of 1px: even the endpoints collide.
    const ticks = selectAxisTicks(dayAxis, 1, fixed(6));
    expect(ticks.map(tick => tick.index)).toEqual([0, 29]);
  });

  it('always retains the last label so the window end is readable', () => {
    const ticks = selectAxisTicks(dayAxis, 6, fixed(6));
    expect(ticks.map(tick => tick.index)).toContain(29);
  });

  it('anchors the edge labels inward so they are not clipped by the chart', () => {
    const ticks = selectAxisTicks(dayAxis, 4, fixed(6));
    expect(ticks[0].align).toBe('left');
    expect(ticks[ticks.length - 1].align).toBe('right');
  });

  it('returns nothing for an empty axis or a non-positive slot', () => {
    expect(selectAxisTicks([], 40, fixed(8))).toEqual([]);
    expect(selectAxisTicks(['A'], 0, fixed(8))).toEqual([]);
  });

  it('centres a single-label axis, which cannot be clipped', () => {
    const ticks = selectAxisTicks(['abcdefgh'], 20, fixed(4));
    expect(ticks.map(tick => tick.index)).toEqual([0]);
    expect(ticks[0].align).toBe('center');
  });
});
