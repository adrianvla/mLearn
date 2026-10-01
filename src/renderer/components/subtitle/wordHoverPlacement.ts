export interface WordHoverBounds { minX: number; maxX: number; minY: number; maxY: number }
export interface WordHoverSize { width: number; height: number }
export interface WordHoverAnchor { left: number; right: number; top: number; bottom: number }

/** Sizing and placement share the same content area, including reader chrome. */
export function wordHoverAvailableSize(bounds: WordHoverBounds): WordHoverSize {
  return { width: Math.max(0, bounds.maxX - bounds.minX), height: Math.max(0, bounds.maxY - bounds.minY) };
}

export function placeWordHover(size: WordHoverSize, bounds: WordHoverBounds, anchor: WordHoverAnchor): { left: number; top: number } {
  const margin = 8;
  const above = anchor.top - bounds.minY - margin;
  const below = bounds.maxY - anchor.bottom - margin;
  const top = above >= size.height || above > below
    ? anchor.top - size.height - margin : anchor.bottom + margin;
  return {
    left: Math.round(Math.max(bounds.minX, Math.min(bounds.maxX - size.width, (anchor.left + anchor.right - size.width) / 2))),
    top: Math.round(Math.max(bounds.minY, Math.min(bounds.maxY - size.height, top))),
  };
}
