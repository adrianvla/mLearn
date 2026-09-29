import { describe, expect, it } from 'vitest';
import { selectAxisTicks } from './barChartTicks';

/** Fixed-width measurer: every glyph is `perChar` wide. */
const fixed = (perChar: number) => (text: string) => text.length * perChar;

describe('selectAxisTicks', () => {
  it('keeps every label when the axis is sparse enough', () => {
    const labels = ['A', 'B', 'C', 'D'];
    const ticks = selectAxisTicks(labels, 40, fixed(8));
    expect(ticks.map(t => t.index)).toEqual([0, 1, 2, 3]);
    // Interior labels centre; the endpoints anchor inward so they are not clipped.
    expect(ticks.map(t => t.align)).toEqual(['left', 'center', 'center', 'right']);
  });

  it('drops labels that cannot fit at their natural width', () => {
    const labels = Array.from({ length: 30 }, (_, i) => String(i + 1));
    // ~6px per bar slot: a 2-character label needs 12px, so it never fits.
    const ticks = selectAxisTicks(labels, 6, fixed(6));
    expect(ticks.map(t => t.index)).toEqual([0, 29]);
  });

  it('thins the axis by striding instead of dropping it entirely', () => {
    const labels = Array.from({ length: 30 }, (_, i) => String(i + 1));
    // 2-char labels are 12px wide; at a 28px slot every other tick fits.
    const ticks = selectAxisTicks(labels, 28, fixed(6));
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks.length).toBeLessThan(30);
    // Stride must be even enough that retained labels do not collide.
    const indices = ticks.map(t => t.index);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i] - indices[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  it('always retains the last label so the window end is readable', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `d${i + 1}`);
    const ticks = selectAxisTicks(labels, 10, fixed(6));
    expect(ticks.map(t => t.index)).toContain(labels.length - 1);
  });

  it('anchors the edge labels inward so they are not clipped by the canvas', () => {
    const labels = Array.from({ length: 30 }, (_, i) => String(i + 1));
    const ticks = selectAxisTicks(labels, 6, fixed(6));
    expect(ticks[0].align).toBe('left');
    expect(ticks[ticks.length - 1].align).toBe('right');
  });

  it('returns nothing for an empty axis or a non-positive slot', () => {
    expect(selectAxisTicks([], 40, fixed(8))).toEqual([]);
    expect(selectAxisTicks(['A'], 0, fixed(8))).toEqual([]);
  });

  it('centres a single-label axis, which cannot be clipped', () => {
    // With one bar the label is centred over it; the edge-anchor rules that
    // exist to stop clipping at the canvas border do not apply.
    const ticks = selectAxisTicks(['abcdefgh'], 20, fixed(4));
    expect(ticks.map(t => t.index)).toEqual([0]);
    expect(ticks[0].align).toBe('center');
  });
});
