/**
 * OCR Utilities
 * Context phrase building, box filtering, and other OCR-related utilities
 * Ported from intelligent-subtitles/pages/modules/reader/ocr/read.js
 */

import type { OcrBox } from '../components/reader/OcrOverlay';
import { containsKanji } from '../../shared/utils/textUtils';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FURIGANA_RATIO = 1.5;
const DEFAULT_NEIGHBOR_WINDOW_MULT = 2.4;
const DEFAULT_NEIGHBOR_LOOKAHEAD = 3;

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
    orientation: (box.is_vertical ?? (height > width * 1.25)) ? 'vertical' as const : 'horizontal' as const,
  };
}

// ============================================================================
// Geometry Helpers
// ============================================================================

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
// Zone Detection (Spatial Clustering)
// ============================================================================

/**
 * Cluster boxes into spatially connected zones based on proximity and orientation.
 * Boxes in the same zone are likely part of the same speech bubble or text block.
 * This enables zone-local processing (e.g., furigana detection) that doesn't get
 * confused by boxes in other parts of the page with very different sizes.
 * 
 * @param metrics Array of box metrics
 * @param supportsVerticalText When true, use orientation-agnostic proximity so
 *   boxes from vertical-text columns aren't incorrectly split by the per-box
 *   aspect-ratio heuristic (individual characters may be roughly square).
 * @returns Array of zones, where each zone is an array of metrics indices
 */
function clusterBoxesIntoZones(metrics: BoxMetrics[], supportsVerticalText = false): number[][] {
  if (metrics.length === 0) return [];
  
  // Build adjacency graph based on spatial proximity and orientation
  const neighbors = new Map<number, number[]>();
  
  for (let i = 0; i < metrics.length; i++) {
    const info = metrics[i];
    const adj: number[] = [];
    
    for (let j = 0; j < metrics.length; j++) {
      if (i === j) continue;
      const other = metrics[j];

      if (supportsVerticalText) {
        // When the language can be written vertically, individual character
        // boxes may be roughly square and mis-classified as horizontal.
        // Use orientation-agnostic proximity: two boxes are adjacent if they
        // satisfy EITHER the vertical-text OR horizontal-text adjacency rule.
        const yOverlapRatio = overlapAmount(info.minY, info.maxY, other.minY, other.maxY)
          / Math.max(1, Math.min(info.height, other.height));
        const hGapRatio = horizontalGap(info, other)
          / Math.max(1, (info.width + other.width) / 2);
        const xOverlapRatio = overlapAmount(info.minX, info.maxX, other.minX, other.maxX)
          / Math.max(1, Math.min(info.width, other.width));
        const vGapRatio = verticalGap(info, other)
          / Math.max(1, (info.height + other.height) / 2);

        const isVerticalAdj = yOverlapRatio >= 0.3 && hGapRatio <= 1.8;
        const isHorizontalAdj = xOverlapRatio >= 0.25 && vGapRatio <= 1.5;

        if (isVerticalAdj || isHorizontalAdj) {
          adj.push(j);
        }
      } else {
        // Languages without vertical text: strict orientation filtering
        if (info.orientation !== other.orientation) continue;

        if (info.orientation === 'vertical') {
          const overlapRatio = overlapAmount(info.minY, info.maxY, other.minY, other.maxY)
            / Math.max(1, Math.min(info.height, other.height));
          const gapRatio = horizontalGap(info, other)
            / Math.max(1, (info.width + other.width) / 2);

          if (overlapRatio >= 0.3 && gapRatio <= 1.8) {
            adj.push(j);
          }
        } else {
          const overlapRatio = overlapAmount(info.minX, info.maxX, other.minX, other.maxX)
            / Math.max(1, Math.min(info.width, other.width));
          const gapRatio = verticalGap(info, other)
            / Math.max(1, (info.height + other.height) / 2);

          if (overlapRatio >= 0.25 && gapRatio <= 1.5) {
            adj.push(j);
          }
        }
      }
    }
    
    neighbors.set(i, adj);
  }
  
  // Find connected components using DFS
  const visited = new Set<number>();
  const zones: number[][] = [];
  
  for (let i = 0; i < metrics.length; i++) {
    if (visited.has(i)) continue;
    
    const zone: number[] = [];
    const stack = [i];
    
    while (stack.length) {
      const idx = stack.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);
      zone.push(idx);
      
      const adj = neighbors.get(idx) || [];
      for (const neigh of adj) {
        if (!visited.has(neigh)) stack.push(neigh);
      }
    }
    
    if (zone.length > 0) {
      zones.push(zone);
    }
  }
  
  return zones;
}

// ============================================================================
// Filter Furigana-sized Boxes
// ============================================================================

export interface FilterNarrowBoxesOptions {
  ratio?: number;
  neighborWindowMultiplier?: number;
  neighborLookahead?: number;
  /** Pass true when the current language supports vertical writing */
  supportsVerticalText?: boolean;
}

/**
 * Filter out narrow boxes that are likely furigana annotations within each text zone.
 * 
 * This works by first clustering boxes into spatially connected zones (e.g., speech bubbles),
 * then applying furigana detection locally within each zone. This prevents the algorithm
 * from being confused by boxes in other parts of the page with very different sizes
 * (e.g., large screaming text vs. regular dialogue).
 * 
 * Within each zone, narrow boxes positioned beside larger kanji boxes are identified as furigana.
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

  // Compute metrics for all boxes
  const metrics = boxes.map((box, idx) => computeBoxMetrics(box, idx));
  
  // Cluster boxes into zones (spatially connected groups)
  const zones = clusterBoxesIntoZones(metrics, options.supportsVerticalText);
  
  const indicesToRemove = new Set<number>();

  /**
   * Process a single zone to detect furigana within it.
   * This compares boxes only within the same zone, not globally.
   */
  const processZone = (zoneIndices: number[]) => {
    if (zoneIndices.length < 2) return;
    
    const zoneMetrics = zoneIndices.map(idx => metrics[idx]);
    
    const considerOrientation = (orientation: 'vertical' | 'horizontal') => {
      const filtered = zoneMetrics.filter(m => m.orientation === orientation);
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

        // Check if this narrow box has a larger kanji neighbor within the same zone
        const windowSize = mainDim * windowMultiplier;
        let hasLargerNeighborWithKanji = false;

        // Check subsequent boxes in sorted order
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

        // Also check previous boxes in sorted order
        for (let j = 1; j <= lookahead && i - j >= 0; j++) {
          if (hasLargerNeighborWithKanji) break;
          
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
  };

  // Process each zone independently
  for (const zone of zones) {
    processZone(zone);
  }

  if (indicesToRemove.size === 0) return boxes;

  return boxes.filter((_, idx) => !indicesToRemove.has(idx));
}

// ============================================================================
// Zone Orientation Detection
// ============================================================================

/**
 * Determine the reading orientation for a zone of OCR boxes.
 *
 * Strategy:
 *  1. If the backend explicitly flagged boxes as vertical/horizontal via
 *     `is_vertical`, use majority vote among the flagged boxes.
 *  2. Otherwise, when `supportsVerticalText` is true, fall back to the
 *     bounding-box aspect ratio of the entire zone — if the zone is taller
 *     than it is wide the text is most likely arranged in vertical columns.
 *  3. As a last resort, use the first box's individual orientation.
 */
function determineZoneOrientation(
  cluster: number[],
  infos: BoxMetrics[],
  boxes: OcrBox[],
  supportsVerticalText?: boolean,
): 'vertical' | 'horizontal' {
  // 1. Majority vote from backend-provided is_vertical flags
  let vertCount = 0;
  let horizCount = 0;
  for (const i of cluster) {
    const flag = boxes[i]?.is_vertical;
    if (flag === true) vertCount++;
    else if (flag === false) horizCount++;
  }
  if (vertCount > 0 || horizCount > 0) {
    return vertCount >= horizCount ? 'vertical' : 'horizontal';
  }

  // 2. Zone bounding-box shape (only when vertical text is possible)
  if (supportsVerticalText && cluster.length > 1) {
    let zMinX = Infinity, zMaxX = -Infinity;
    let zMinY = Infinity, zMaxY = -Infinity;
    for (const i of cluster) {
      const m = infos[i];
      if (m.minX < zMinX) zMinX = m.minX;
      if (m.maxX > zMaxX) zMaxX = m.maxX;
      if (m.minY < zMinY) zMinY = m.minY;
      if (m.maxY > zMaxY) zMaxY = m.maxY;
    }
    const zoneW = zMaxX - zMinX;
    const zoneH = zMaxY - zMinY;
    if (zoneH > zoneW) return 'vertical';
  }

  // 3. Fallback: first box
  return infos[cluster[0]].orientation;
}

// ============================================================================
// Build OCR Context Map
// ============================================================================

/**
 * Build a context map that associates each OCR box with its neighboring text
 * This is used to provide context phrases for LLM explanations and flashcard examples
 * 
 * Uses the same zone detection algorithm as furigana filtering to ensure consistent
 * grouping of boxes into speech bubbles / text blocks.
 * 
 * @param boxes Array of OCR boxes
 * @param options Optional settings for vertical text support
 * @returns Map from box index to context phrase string
 */
export function buildOcrContextMap(
  boxes: OcrBox[],
  options: { supportsVerticalText?: boolean } = {},
): Map<number, string> {
  const contextMap = new Map<number, string>();
  
  try {
    if (!Array.isArray(boxes) || boxes.length === 0) return contextMap;
    
    const infos = boxes.map((box, idx) => computeBoxMetrics(box, idx));
    
    // Use the shared zone clustering algorithm
    const zones = clusterBoxesIntoZones(infos, options.supportsVerticalText);
    
    for (const cluster of zones) {
      if (cluster.length === 0) continue;
      
      const orient = determineZoneOrientation(cluster, infos, boxes, options.supportsVerticalText);
      
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
