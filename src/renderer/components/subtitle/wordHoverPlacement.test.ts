import { describe, expect, it } from 'vitest';
import { wordHoverAvailableSize, placeWordHover, wordHoverBoundsFromChrome } from './wordHoverPlacement';

describe('word popup safe content bounds', () => {
  it('uses actual shifted chrome edges rather than heights at the viewport origin', () => {
    const bounds = wordHoverBoundsFromChrome({ width: 800, height: 600 }, {
      top: [{ left: 0, right: 800, top: 0, bottom: 28 }, { left: 0, right: 800, top: 28, bottom: 88 }],
      left: [{ left: 0, right: 160, top: 88, bottom: 560 }],
      right: [{ left: 480, right: 800, top: 88, bottom: 560 }],
      bottom: [{ left: 0, right: 800, top: 560, bottom: 600 }],
    }, 12);
    expect(bounds).toEqual({ minX: 172, maxX: 468, minY: 100, maxY: 548 });
    expect(wordHoverBoundsFromChrome({ width: 640, height: 480 }, {
      top: [{ left: 0, right: 0, top: 0, bottom: 28 }],
    }, 12)).toEqual({ minX: 12, maxX: 628, minY: 12, maxY: 468 });
  });

  it('fits a large popup beside a reader sidebar', () => {
    const bounds = { minX: 172, maxX: 988, minY: 60, maxY: 978 };
    const available = wordHoverAvailableSize(bounds);
    expect(available.width).toBe(816);
    const size = { width: Math.min(840, available.width), height: 490 };
    const placed = placeWordHover(size, bounds, { left: 940, right: 980, top: 450, bottom: 480 });
    expect(placed.left).toBe(172);
    expect(placed.left + size.width).toBe(988);
  });

  it('fits a short reader window between navigation and status bars', () => {
    const bounds = { minX: 12, maxX: 988, minY: 60, maxY: 478 };
    const available = wordHoverAvailableSize(bounds);
    expect(available.height).toBe(418);
    const size = { width: 840, height: Math.min(490, available.height) };
    const placed = placeWordHover(size, bounds, { left: 460, right: 500, top: 300, bottom: 320 });
    expect(placed.top).toBe(60);
    expect(placed.top + size.height).toBe(478);
  });

  it('prefers free space above bottom subtitles and below top text', () => {
    const bounds = { minX: 12, maxX: 988, minY: 12, maxY: 588 };
    const size = { width: 600, height: 200 };
    expect(placeWordHover(size, bounds, { left: 480, right: 520, top: 500, bottom: 520 })).toEqual({ left: 200, top: 292 });
    expect(placeWordHover(size, bounds, { left: 480, right: 520, top: 20, bottom: 40 })).toEqual({ left: 200, top: 48 });
  });
});
