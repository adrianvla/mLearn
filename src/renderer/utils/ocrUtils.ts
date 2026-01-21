/**
 * OCR Utilities
 * Context phrase building, box filtering, and other OCR-related utilities
 * Ported from intelligent-subtitles/pages/modules/reader/ocr/read.js
 */

import type { OcrBox } from '../components/reader/OcrOverlay';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FURIGANA_RATIO = 1.5;
const DEFAULT_NEIGHBOR_WINDOW_MULT = 2.4;
const DEFAULT_NEIGHBOR_LOOKAHEAD = 3;
const KANJI_REGEX = /[\u3400-\u9FFF\uF900-\uFAFF]/;

// ============================================================================
// Box Metrics
// ============================================================================

export interface BoxMetrics {
  idx: number;
  text: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  orientation: 'vertical' | 'horizontal';
}

/**
 * Compute metrics for an OCR box
 */
export function computeBoxMetrics(box: OcrBox, idx: number): BoxMetrics {
  const pts = Array.isArray(box?.box) ? box.box : [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  for (const pt of pts) {
    if (!pt || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (Number.isFinite(x)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (Number.isFinite(y)) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  
  if (!pts.length) {
    minX = maxX = minY = maxY = 0;
  } else {
    if (minX === Infinity) minX = 0;
    if (maxX === -Infinity) maxX = 0;
    if (minY === Infinity) minY = 0;
    if (maxY === -Infinity) maxY = 0;
  }
  
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  
  return {
    idx,
    text: typeof box?.text === 'string' ? box.text : '',
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
    orientation: height > width * 1.25 ? 'vertical' : 'horizontal',
  };
}

// ============================================================================
// Geometry Helpers
// ============================================================================

function containsKanji(str: string): boolean {
  if (typeof str !== 'string') return false;
  return KANJI_REGEX.test(str);
}

function overlapAmount(aMin: number, aMax: number, bMin: number, bMax: number): number {
  const top = Math.max(aMin, bMin);
  const bottom = Math.min(aMax, bMax);
  return Math.max(0, bottom - top);
}

function horizontalGap(infoA: BoxMetrics, infoB: BoxMetrics): number {
  if (infoA.centerX <= infoB.centerX) {
    return Math.max(0, infoB.minX - infoA.maxX);
  }
  return Math.max(0, infoA.minX - infoB.maxX);
}

function verticalGap(infoA: BoxMetrics, infoB: BoxMetrics): number {
  if (infoA.centerY <= infoB.centerY) {
    return Math.max(0, infoB.minY - infoA.maxY);
  }
  return Math.max(0, infoA.minY - infoB.maxY);
}

// ============================================================================
// Filter Furigana-sized Boxes
// ============================================================================

export interface FilterNarrowBoxesOptions {
  ratio?: number;
  neighborWindowMultiplier?: number;
  neighborLookahead?: number;
}

/**
 * Filter out narrow boxes that are likely furigana annotations
 * These are small boxes positioned above/beside larger kanji boxes
 */
export function filterNarrowBoxes(
  boxes: OcrBox[],
  options: FilterNarrowBoxesOptions = {}
): OcrBox[] {
  if (!Array.isArray(boxes) || boxes.length < 2) return boxes;

  const clampPositive = (val: number | undefined, fallback: number): number => {
    const n = val ?? fallback;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const effectiveRatio = clampPositive(options.ratio, DEFAULT_FURIGANA_RATIO);
  const windowMultiplier = clampPositive(options.neighborWindowMultiplier, DEFAULT_NEIGHBOR_WINDOW_MULT);
  const lookahead = Math.max(1, Math.floor(clampPositive(options.neighborLookahead, DEFAULT_NEIGHBOR_LOOKAHEAD)));

  const metrics = boxes.map((box, idx) => computeBoxMetrics(box, idx));
  const indicesToRemove = new Set<number>();

  const considerOrientation = (orientation: 'vertical' | 'horizontal') => {
    const filtered = metrics.filter(m => m.orientation === orientation);
    if (filtered.length < 2) return;

    // Sort by position for neighbor finding
    const sorted = [...filtered].sort((a, b) => {
      if (orientation === 'vertical') {
        // For vertical text, sort right-to-left then top-to-bottom
        const deltaX = Math.abs(a.centerX - b.centerX);
        if (deltaX < Math.min(a.width, b.width) * 0.5) {
          return a.centerY - b.centerY;
        }
        return b.centerX - a.centerX;
      }
      // For horizontal text, sort top-to-bottom then left-to-right
      const deltaY = Math.abs(a.centerY - b.centerY);
      if (deltaY < Math.min(a.height, b.height) * 0.5) {
        return a.centerX - b.centerX;
      }
      return a.centerY - b.centerY;
    });

    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      const mainDim = orientation === 'vertical' ? curr.width : curr.height;
      const crossDim = orientation === 'vertical' ? curr.height : curr.width;

      // Skip if already marked for removal or if it's not narrow
      if (indicesToRemove.has(curr.idx)) continue;
      if (mainDim >= crossDim / effectiveRatio) continue;

      // Check if this narrow box has a larger kanji neighbor
      const windowSize = mainDim * windowMultiplier;
      let hasLargerNeighborWithKanji = false;

      for (let j = 1; j <= lookahead && i + j < sorted.length; j++) {
        const neighbor = sorted[i + j];
        if (indicesToRemove.has(neighbor.idx)) continue;

        const neighborMain = orientation === 'vertical' ? neighbor.width : neighbor.height;
        if (neighborMain <= mainDim * 1.2) continue;

        // Check if neighbor is within window and contains kanji
        const gap = orientation === 'vertical' 
          ? horizontalGap(curr, neighbor) 
          : verticalGap(curr, neighbor);
        
        if (gap <= windowSize && containsKanji(neighbor.text)) {
          hasLargerNeighborWithKanji = true;
          break;
        }
      }

      // Also check previous boxes
      for (let j = 1; j <= lookahead && i - j >= 0; j++) {
        const neighbor = sorted[i - j];
        if (indicesToRemove.has(neighbor.idx)) continue;

        const neighborMain = orientation === 'vertical' ? neighbor.width : neighbor.height;
        if (neighborMain <= mainDim * 1.2) continue;

        const gap = orientation === 'vertical' 
          ? horizontalGap(curr, neighbor) 
          : verticalGap(curr, neighbor);
        
        if (gap <= windowSize && containsKanji(neighbor.text)) {
          hasLargerNeighborWithKanji = true;
          break;
        }
      }

      if (hasLargerNeighborWithKanji) {
        indicesToRemove.add(curr.idx);
      }
    }
  };

  considerOrientation('vertical');
  considerOrientation('horizontal');

  if (indicesToRemove.size === 0) return boxes;

  return boxes.filter((_, idx) => !indicesToRemove.has(idx));
}

// ============================================================================
// Build OCR Context Map
// ============================================================================

/**
 * Build a context map that associates each OCR box with its neighboring text
 * This is used to provide context phrases for LLM explanations and flashcard examples
 * 
 * @param boxes Array of OCR boxes
 * @returns Map from box index to context phrase string
 */
export function buildOcrContextMap(boxes: OcrBox[]): Map<number, string> {
  const contextMap = new Map<number, string>();
  
  try {
    if (!Array.isArray(boxes) || boxes.length === 0) return contextMap;
    
    const infos = boxes.map((box, idx) => computeBoxMetrics(box, idx));
    const neighbors = new Map<number, number[]>();
    
    // Build adjacency graph based on spatial proximity and orientation
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const adj: number[] = [];
      
      for (let j = 0; j < infos.length; j++) {
        if (i === j) continue;
        const other = infos[j];
        
        // Skip if different orientations
        if (info.orientation !== other.orientation) continue;
        
        if (info.orientation === 'vertical') {
          // For vertical text: check horizontal overlap and vertical gap
          const overlapRatio = overlapAmount(info.minY, info.maxY, other.minY, other.maxY) 
            / Math.max(1, Math.min(info.height, other.height));
          const gapRatio = horizontalGap(info, other) 
            / Math.max(1, (info.width + other.width) / 2);
          
          if (overlapRatio >= 0.3 && gapRatio <= 1.8) {
            adj.push(j);
          }
        } else {
          // For horizontal text: check vertical overlap and horizontal gap
          const overlapRatio = overlapAmount(info.minX, info.maxX, other.minX, other.maxX) 
            / Math.max(1, Math.min(info.width, other.width));
          const gapRatio = verticalGap(info, other) 
            / Math.max(1, (info.height + other.height) / 2);
          
          if (overlapRatio >= 0.25 && gapRatio <= 1.5) {
            adj.push(j);
          }
        }
      }
      
      neighbors.set(i, adj);
    }
    
    // Find connected components (clusters of related text boxes)
    const visited = new Set<number>();
    
    for (let i = 0; i < infos.length; i++) {
      if (visited.has(i)) continue;
      
      const cluster: number[] = [];
      const stack = [i];
      
      while (stack.length) {
        const idx = stack.pop()!;
        if (visited.has(idx)) continue;
        visited.add(idx);
        cluster.push(idx);
        
        const adj = neighbors.get(idx) || [];
        for (const neigh of adj) {
          if (!visited.has(neigh)) stack.push(neigh);
        }
      }
      
      if (cluster.length === 0) continue;
      
      const orient = infos[cluster[0]].orientation;
      
      // Sort cluster by reading order
      const sorted = cluster.slice().sort((aIdx, bIdx) => {
        const a = infos[aIdx];
        const b = infos[bIdx];
        
        if (orient === 'vertical') {
          // Vertical Japanese: right-to-left columns, top-to-bottom within columns
          const deltaX = Math.abs(a.centerX - b.centerX);
          const widthRef = Math.min(a.width, b.width);
          if (deltaX < widthRef * 0.3) {
            return a.minY - b.minY;
          }
          return b.centerX - a.centerX;
        }
        
        // Horizontal: top-to-bottom rows, left-to-right within rows
        const deltaY = Math.abs(a.centerY - b.centerY);
        const heightRef = Math.min(a.height, b.height);
        if (deltaY < heightRef * 0.3) {
          return a.centerX - b.centerX;
        }
        return a.centerY - b.centerY;
      });
      
      // Build context phrase from sorted boxes
      const pieces: string[] = [];
      for (const idx of sorted) {
        const raw = infos[idx].text;
        if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (trimmed) pieces.push(trimmed);
        }
      }
      
      // Join with appropriate separator based on orientation
      let context = pieces.join(orient === 'vertical' ? '' : ' ');
      
      // Fallback to first box text if join failed
      if (!context) {
        const fallback = infos[sorted[0]].text;
        context = typeof fallback === 'string' ? fallback : '';
      }
      
      // Limit context length
      const trimmed = typeof context === 'string' ? context.trim() : '';
      const limited = trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
      
      // Assign context to all boxes in cluster
      for (const idx of cluster) {
        contextMap.set(idx, limited);
      }
    }
  } catch (_e) {
    // Best effort grouping - return whatever we have
  }
  
  return contextMap;
}

// ============================================================================
// Get Bounding Rect from Box Points
// ============================================================================

/**
 * Calculate bounding rectangle from 4 corner points
 */
export function getBoundingRect(box: number[][]): { x: number; y: number; width: number; height: number } {
  if (!box || box.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  const xs = box.map(p => p[0]);
  const ys = box.map(p => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
