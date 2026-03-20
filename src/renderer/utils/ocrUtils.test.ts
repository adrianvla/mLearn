import { describe, it, expect } from 'vitest';
import {
  computeBoxMetrics,
  filterNarrowBoxes,
  buildOcrContextMap,
  getBoundingRect,
} from '@renderer/utils/ocrUtils';
import type { BoxMetrics } from '@renderer/utils/ocrUtils';
import type { OcrBox } from '@renderer/components/reader/OcrOverlay';

// ============================================================================
// Test Helpers
// ============================================================================

function makeBox(
  x: number,
  y: number,
  w: number,
  h: number,
  text = '',
  is_vertical?: boolean,
): OcrBox {
  return {
    box: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    text,
    is_vertical,
  };
}

// ============================================================================
// computeBoxMetrics
// ============================================================================

describe('computeBoxMetrics', () => {
  it('computes correct metrics for a typical horizontal box', () => {
    const box = makeBox(10, 20, 100, 30, 'hello');
    const m = computeBoxMetrics(box, 0);
    expect(m.idx).toBe(0);
    expect(m.text).toBe('hello');
    expect(m.minX).toBe(10);
    expect(m.maxX).toBe(110);
    expect(m.minY).toBe(20);
    expect(m.maxY).toBe(50);
    expect(m.width).toBe(100);
    expect(m.height).toBe(30);
    expect(m.centerX).toBe(60);
    expect(m.centerY).toBe(35);
    expect(m.orientation).toBe('horizontal');
  });

  it('computes correct metrics for a vertical box (height > width * 1.25)', () => {
    const box = makeBox(0, 0, 20, 100, '縦');
    const m = computeBoxMetrics(box, 3);
    expect(m.idx).toBe(3);
    expect(m.width).toBe(20);
    expect(m.height).toBe(100);
    expect(m.orientation).toBe('vertical');
  });

  it('uses is_vertical flag to override aspect-ratio orientation', () => {
    // Wide box but explicitly marked vertical
    const box: OcrBox = { ...makeBox(0, 0, 100, 30, 'wide'), is_vertical: true };
    const m = computeBoxMetrics(box, 1);
    expect(m.orientation).toBe('vertical');
  });

  it('uses is_vertical=false to mark wide box as horizontal', () => {
    const box: OcrBox = { ...makeBox(0, 0, 20, 100, 'tall'), is_vertical: false };
    const m = computeBoxMetrics(box, 0);
    expect(m.orientation).toBe('horizontal');
  });

  it('handles empty box array — returns zero metrics', () => {
    const box: OcrBox = { box: [], text: 'empty' };
    const m = computeBoxMetrics(box, 0);
    expect(m.minX).toBe(0);
    expect(m.maxX).toBe(0);
    expect(m.minY).toBe(0);
    expect(m.maxY).toBe(0);
    expect(m.width).toBe(1);
    expect(m.height).toBe(1);
  });

  it('clamps width and height to minimum of 1 for zero-dimension box', () => {
    const box: OcrBox = { box: [[5, 5], [5, 5], [5, 5], [5, 5]], text: '' };
    const m = computeBoxMetrics(box, 0);
    expect(m.width).toBe(1);
    expect(m.height).toBe(1);
  });

  it('handles null/undefined box gracefully', () => {
    const box = { box: null, text: 'x' } as unknown as OcrBox;
    const m = computeBoxMetrics(box, 2);
    expect(m.width).toBe(1);
    expect(m.height).toBe(1);
  });

  it('handles non-string text gracefully', () => {
    const box = { box: [[0, 0], [10, 0], [10, 10], [0, 10]], text: null } as unknown as OcrBox;
    const m = computeBoxMetrics(box, 0);
    expect(m.text).toBe('');
  });

  it('assigns correct index', () => {
    const box = makeBox(0, 0, 50, 50, 'test');
    expect(computeBoxMetrics(box, 7).idx).toBe(7);
    expect(computeBoxMetrics(box, 0).idx).toBe(0);
  });

  it('computes center correctly for non-zero origin box', () => {
    const box = makeBox(100, 200, 60, 40, '');
    const m = computeBoxMetrics(box, 0);
    expect(m.centerX).toBe(130);
    expect(m.centerY).toBe(220);
  });
});

// ============================================================================
// getBoundingRect
// ============================================================================

describe('getBoundingRect', () => {
  it('returns correct bounding rect for an axis-aligned rectangle', () => {
    const box = [[10, 20], [60, 20], [60, 50], [10, 50]];
    const r = getBoundingRect(box);
    expect(r.x).toBe(10);
    expect(r.y).toBe(20);
    expect(r.width).toBe(50);
    expect(r.height).toBe(30);
  });

  it('returns correct bounding rect for a rotated quad (skewed points)', () => {
    // Diamond-like points
    const box = [[50, 0], [100, 50], [50, 100], [0, 50]];
    const r = getBoundingRect(box);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(100);
    expect(r.height).toBe(100);
  });

  it('returns zero rect for fewer than 4 points', () => {
    expect(getBoundingRect([[0, 0], [10, 0], [10, 10]])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(getBoundingRect([[0, 0]])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(getBoundingRect([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('handles null/undefined input', () => {
    expect(getBoundingRect(null as unknown as number[][])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(getBoundingRect(undefined as unknown as number[][])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('handles a degenerate single-point quad (all same)', () => {
    const box = [[5, 5], [5, 5], [5, 5], [5, 5]];
    const r = getBoundingRect(box);
    expect(r.x).toBe(5);
    expect(r.y).toBe(5);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });

  it('handles negative coordinates', () => {
    const box = [[-10, -20], [10, -20], [10, 0], [-10, 0]];
    const r = getBoundingRect(box);
    expect(r.x).toBe(-10);
    expect(r.y).toBe(-20);
    expect(r.width).toBe(20);
    expect(r.height).toBe(20);
  });

  it('correctly uses all 4+ points when more are provided', () => {
    // 5 points
    const box = [[0, 0], [100, 0], [100, 80], [50, 100], [0, 80]];
    const r = getBoundingRect(box);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.width).toBe(100);
    expect(r.height).toBe(100);
  });
});

// ============================================================================
// filterNarrowBoxes
// ============================================================================

describe('filterNarrowBoxes', () => {
  it('returns input unchanged for empty array', () => {
    const result = filterNarrowBoxes([]);
    expect(result).toEqual([]);
  });

  it('returns input unchanged for single-element array', () => {
    const boxes = [makeBox(0, 0, 40, 40, 'a')];
    const result = filterNarrowBoxes(boxes);
    expect(result).toBe(boxes);
  });

  it('returns input unchanged when no furigana candidates exist', () => {
    // All same-sized boxes — none should be filtered
    const boxes = [
      makeBox(0, 0, 30, 100, '一', true),
      makeBox(40, 0, 30, 100, '二', true),
      makeBox(80, 0, 30, 100, '三', true),
    ];
    const result = filterNarrowBoxes(boxes, { zoneDeltaThreshold: 100 });
    expect(result).toHaveLength(3);
  });

  it('filters a narrow furigana box next to a larger neighbor in a vertical zone', () => {
    // Main vertical text boxes (wide enough to be dominant)
    const main1 = makeBox(40, 0, 30, 80, '漢', true);
    const main2 = makeBox(40, 90, 30, 80, '字', true);
    // Furigana: narrow width, adjacent horizontally, overlaps vertically
    const furigana = makeBox(75, 5, 10, 70, 'かん', true);

    const boxes = [main1, main2, furigana];
    const result = filterNarrowBoxes(boxes, {
      ratio: 1.5,
      zoneDeltaThreshold: 60,
    });

    expect(result).not.toContain(furigana);
    expect(result).toContain(main1);
    expect(result).toContain(main2);
  });

  it('does not filter an isolated small box with no larger neighbor nearby', () => {
    // Small isolated box far from anything
    const small = makeBox(0, 0, 10, 40, 'a', true);
    // Large box far away
    const large = makeBox(500, 0, 30, 100, 'b', true);

    const result = filterNarrowBoxes([small, large], { zoneDeltaThreshold: 15 });
    // They are far apart; each is in its own zone of 1 → nothing filtered
    expect(result).toHaveLength(2);
  });

  it('preserves all boxes when ratio is very large (nothing qualifies as furigana)', () => {
    const boxes = [
      makeBox(0, 0, 30, 100, '一', true),
      makeBox(35, 0, 15, 90, 'いち', true),
    ];
    // ratio=100 means furiganaThreshold = dominant/100 ≈ near zero, nothing removed
    const result = filterNarrowBoxes(boxes, { ratio: 100, zoneDeltaThreshold: 50 });
    expect(result).toHaveLength(2);
  });

  it('handles non-array input gracefully', () => {
    const result = filterNarrowBoxes(null as unknown as OcrBox[]);
    expect(result).toBeNull();
  });

  it('calls debugOutput with zone data when provided', () => {
    const boxes = [
      makeBox(0, 0, 30, 100, '語', true),
      makeBox(35, 0, 30, 100, '彙', true),
    ];
    let debugCalled = false;
    filterNarrowBoxes(boxes, {
      zoneDeltaThreshold: 100,
      debugOutput: (zones) => {
        debugCalled = true;
        expect(Array.isArray(zones)).toBe(true);
      },
    });
    expect(debugCalled).toBe(true);
  });

  it('filters horizontal furigana (smaller height above a wide box)', () => {
    // Wide horizontal main text
    const main = makeBox(0, 30, 200, 40, 'Hello World', false);
    // Furigana-like: narrow height, above main text, overlapping horizontally
    const furigana = makeBox(10, 5, 180, 15, 'small', false);

    const boxes = [main, furigana];
    const result = filterNarrowBoxes(boxes, {
      ratio: 1.5,
      zoneDeltaThreshold: 50,
    });

    expect(result).not.toContain(furigana);
    expect(result).toContain(main);
  });
});

// ============================================================================
// buildOcrContextMap
// ============================================================================

describe('buildOcrContextMap', () => {
  it('returns empty map for empty array', () => {
    const map = buildOcrContextMap([]);
    expect(map.size).toBe(0);
  });

  it('returns map with single entry for single box', () => {
    const boxes = [makeBox(0, 0, 100, 30, 'hello')];
    const map = buildOcrContextMap(boxes);
    expect(map.size).toBe(1);
    expect(map.get(0)).toBe('hello');
  });

  it('groups nearby boxes into the same zone and assigns same context', () => {
    const boxes = [
      makeBox(0, 0, 80, 30, 'Hello', false),
      makeBox(90, 0, 80, 30, 'World', false),
    ];
    const map = buildOcrContextMap(boxes);
    expect(map.size).toBe(2);
    // Both are in the same zone, context should contain both words
    const ctx0 = map.get(0)!;
    const ctx1 = map.get(1)!;
    expect(ctx0).toBe(ctx1);
    expect(ctx0).toContain('Hello');
    expect(ctx0).toContain('World');
  });

  it('separates far-apart boxes into different zones', () => {
    const boxes = [
      makeBox(0, 0, 80, 30, 'Left', false),
      makeBox(1000, 1000, 80, 30, 'Right', false),
    ];
    const map = buildOcrContextMap(boxes);
    expect(map.size).toBe(2);
    expect(map.get(0)).not.toBe(map.get(1));
  });

  it('handles non-array input gracefully (returns empty map)', () => {
    const map = buildOcrContextMap(null as unknown as OcrBox[]);
    expect(map.size).toBe(0);
  });

  it('skips empty text boxes when building context phrase', () => {
    const boxes = [
      makeBox(0, 0, 80, 30, '', false),
      makeBox(90, 0, 80, 30, 'text', false),
    ];
    const map = buildOcrContextMap(boxes);
    const ctx = map.get(0)!;
    expect(ctx.trim()).toBe('text');
  });

  it('joins vertical zone boxes without spaces', () => {
    const boxes = [
      makeBox(0, 0, 20, 80, '一', true),
      makeBox(0, 90, 20, 80, '二', true),
    ];
    const map = buildOcrContextMap(boxes);
    const ctx = map.get(0)!;
    // No spaces for vertical zone
    expect(ctx).not.toContain(' ');
    expect(ctx).toContain('一');
    expect(ctx).toContain('二');
  });

  it('joins horizontal zone boxes with spaces', () => {
    const boxes = [
      makeBox(0, 0, 60, 25, 'foo', false),
      makeBox(70, 0, 60, 25, 'bar', false),
    ];
    const map = buildOcrContextMap(boxes);
    const ctx = map.get(0)!;
    expect(ctx).toContain(' ');
    expect(ctx).toBe('foo bar');
  });

  it('limits context to 500 characters', () => {
    const longText = 'a'.repeat(600);
    const boxes = [makeBox(0, 0, 100, 30, longText)];
    const map = buildOcrContextMap(boxes);
    expect(map.get(0)!.length).toBeLessThanOrEqual(500);
  });

  it('assigns context to ALL boxes in the same zone', () => {
    const boxes = [
      makeBox(0, 0, 60, 25, 'A', false),
      makeBox(70, 0, 60, 25, 'B', false),
      makeBox(140, 0, 60, 25, 'C', false),
    ];
    const map = buildOcrContextMap(boxes);
    expect(map.get(0)).toBe(map.get(1));
    expect(map.get(1)).toBe(map.get(2));
  });

  it('returns a Map instance', () => {
    const map = buildOcrContextMap([makeBox(0, 0, 50, 20, 'x')]);
    expect(map).toBeInstanceOf(Map);
  });
});
