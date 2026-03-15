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
const DEFAULT_ZONE_DELTA_THRESHOLD = 50;

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
 * Cluster boxes into spatially connected zones based on proximity.
 * All boxes are clustered together regardless of individual orientation;
 * zone-level orientation is determined afterwards via `determineZoneOrientation`.
 * Two boxes are adjacent when the gap on BOTH axes is within the threshold.
 *
 * @param metrics Array of box metrics
 * @returns Array of zones, where each zone is an array of metrics indices
 */
interface ClusterOptions {
  /** Max pixel distance between box edges on each axis (default 50) */
  zoneDeltaThreshold?: number;
}

/**
 * Cluster box indices by edge proximity on both axes simultaneously.
 * Two boxes are adjacent only when the gap on BOTH axes is within the threshold.
 */
function clusterByProximity(
  indices: number[],
  metrics: BoxMetrics[],
  deltaThreshold: number,
): number[][] {
  if (indices.length === 0) return [];

  // Build adjacency graph — require proximity on both axes
  const neighbors = new Map<number, number[]>();

  for (const i of indices) {
    const adj: number[] = [];
    for (const j of indices) {
      if (i === j) continue;
      const hGap = horizontalGap(metrics[i], metrics[j]);
      const vGap = verticalGap(metrics[i], metrics[j]);
      if (hGap <= deltaThreshold && vGap <= deltaThreshold) {
        adj.push(j);
      }
    }
    neighbors.set(i, adj);
  }

  // Find connected components using DFS
  const visited = new Set<number>();
  const zones: number[][] = [];

  for (const i of indices) {
    if (visited.has(i)) continue;

    const zone: number[] = [];
    const stack = [i];

    while (stack.length) {
      const idx = stack.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);
      zone.push(idx);

      for (const neigh of neighbors.get(idx) || []) {
        if (!visited.has(neigh)) stack.push(neigh);
      }
    }

    if (zone.length > 0) zones.push(zone);
  }

  return zones;
}

function clusterBoxesIntoZones(metrics: BoxMetrics[], opts: ClusterOptions = {}): number[][] {
  if (metrics.length === 0) return [];

  const delta = opts.zoneDeltaThreshold ?? DEFAULT_ZONE_DELTA_THRESHOLD;

  // Cluster ALL boxes by spatial proximity, regardless of per-box orientation.
  // Small furigana characters may have square bounding boxes that would be
  // misclassified as horizontal — keeping them in the same zone as their
  // parent text ensures the zone-level orientation drives furigana detection.
  const allIndices = Array.from({ length: metrics.length }, (_, i) => i);
  return clusterByProximity(allIndices, metrics, delta);
}

// ============================================================================
// Filter Furigana-sized Boxes
// ============================================================================

export interface FilterNarrowBoxesOptions {
  ratio?: number;
  neighborWindowMultiplier?: number;
  neighborLookahead?: number;
  /** Max pixel distance between box edges for zone clustering (default 50) */
  zoneDeltaThreshold?: number;
  /** When provided, receives zone debug data for visualization */
  debugOutput?: (zones: FilterDebugZone[]) => void;
}

/** Debug information for a single zone, used for visualization */
export interface FilterDebugZone {
  zoneIndex: number;
  /** Indices into the original boxes array */
  indices: number[];
  /** Bounding rectangle of the zone */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Per-orientation statistics */
  orientationStats: Array<{
    orientation: 'vertical' | 'horizontal';
    medianCross: number;
    threshold: number;
    /** Indices classified as furigana within this orientation group */
    furiganaIndices: number[];
  }>;
}

/**
 * Filter out narrow boxes that are likely furigana annotations within each text zone.
 *
 * **Algorithm** (zone-local statistical approach):
 *  1. Cluster boxes into spatially connected zones (speech bubbles / text blocks).
 *  2. Determine zone-level orientation via majority vote / bounding-box shape.
 *     This avoids misclassifying small square furigana chars as horizontal.
 *  3. Compute the dominant **cross-axis dimension** using area-weighted
 *     histogram mode (width for vertical zones, height for horizontal).
 *  4. Boxes with a cross dimension below `dominant / ratio` are furigana candidates.
 *  5. A candidate is confirmed only if it has a larger neighbor within a proximity
 *     window (prevents false positives from isolated small text).
 *
 * This approach is **language-agnostic** — it relies on zone-local size
 * distribution rather than script-specific checks (e.g. `containsKanji`).
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

  const metrics = boxes.map((box, idx) => computeBoxMetrics(box, idx));
  const zones = clusterBoxesIntoZones(metrics, {
    zoneDeltaThreshold: options.zoneDeltaThreshold,
  });

  const indicesToRemove = new Set<number>();
  const debugZones: FilterDebugZone[] = [];

  for (let zi = 0; zi < zones.length; zi++) {
    const zoneIndices = zones[zi];
    if (zoneIndices.length < 2) {
      if (options.debugOutput) {
        const m = zoneIndices.length === 1 ? metrics[zoneIndices[0]] : null;
        debugZones.push({
          zoneIndex: zi,
          indices: zoneIndices,
          bounds: m
            ? { minX: m.minX, minY: m.minY, maxX: m.maxX, maxY: m.maxY }
            : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          orientationStats: [],
        });
      }
      continue;
    }

    const zoneMetrics = zoneIndices.map(idx => metrics[idx]);

    // Compute zone bounding box
    let zMinX = Infinity, zMinY = Infinity, zMaxX = -Infinity, zMaxY = -Infinity;
    for (const m of zoneMetrics) {
      if (m.minX < zMinX) zMinX = m.minX;
      if (m.minY < zMinY) zMinY = m.minY;
      if (m.maxX > zMaxX) zMaxX = m.maxX;
      if (m.maxY > zMaxY) zMaxY = m.maxY;
    }

    const zoneBounds = { minX: zMinX, minY: zMinY, maxX: zMaxX, maxY: zMaxY };
    const orientationStats: FilterDebugZone['orientationStats'] = [];

    // Determine zone-level orientation rather than relying on per-box orientation.
    // Small furigana characters can have near-square bounding boxes that the
    // per-box heuristic misclassifies; using zone orientation keeps them in the
    // same comparison pool as their parent text.
    const orientation = determineZoneOrientation(zoneIndices, metrics, boxes);

    // Cross-axis dimension: the dimension furigana is narrow in
    // Vertical zone → furigana has narrow width
    // Horizontal zone → furigana has narrow height
    const crossDims = zoneMetrics.map(m =>
      orientation === 'vertical' ? m.width : m.height
    );

    // Compute the dominant cross-axis dimension using area-weighted
    // histogram mode (Bjerregaard et al., "Detection of Furigana Text
    // in Images", 2022).  A sliding bin finds the cross-axis range where
    // the most total box area is concentrated.  This is robust against
    // wrapped / multi-line text boxes whose inflated cross-axis dimension
    // would otherwise skew a simple median upward.
    const minDim = Math.min(...crossDims);
    const maxDim = Math.max(...crossDims);
    let dominantCross: number;

    if (maxDim - minDim < 1) {
      dominantCross = minDim;
    } else {
      const binSize = Math.max(3, Math.round((maxDim - minDim) * 0.15));
      let bestFontSize = minDim;
      let bestArea = 0;

      for (let start = Math.floor(minDim); start <= maxDim; start++) {
        let area = 0;
        let dimSum = 0;
        let count = 0;

        for (let k = 0; k < zoneMetrics.length; k++) {
          const dim = crossDims[k];
          if (dim >= start && dim <= start + binSize) {
            area += zoneMetrics[k].width * zoneMetrics[k].height;
            dimSum += dim;
            count++;
          }
        }

        if (area > bestArea && count > 0) {
          bestArea = area;
          bestFontSize = dimSum / count;
        }
      }

      dominantCross = bestFontSize;
    }

    const furiganaThreshold = dominantCross / effectiveRatio;
    const localFurigana: number[] = [];

    for (const curr of zoneMetrics) {
      if (indicesToRemove.has(curr.idx)) continue;

      const crossDim = orientation === 'vertical' ? curr.width : curr.height;
      if (crossDim >= furiganaThreshold) continue;

      // Candidate is narrow relative to zone peers — verify with neighbor check
      const windowSize = crossDim * windowMultiplier;
      let hasLargerNeighbor = false;

      for (const other of zoneMetrics) {
        if (other.idx === curr.idx || indicesToRemove.has(other.idx)) continue;

        const otherCross = orientation === 'vertical' ? other.width : other.height;
        if (otherCross <= crossDim * 1.2) continue;

        // Furigana runs alongside its parent text: require main-axis overlap
        const mainOverlap = orientation === 'vertical'
          ? overlapAmount(curr.minY, curr.maxY, other.minY, other.maxY)
          : overlapAmount(curr.minX, curr.maxX, other.minX, other.maxX);
        const mainDim = orientation === 'vertical' ? curr.height : curr.width;
        if (mainOverlap < mainDim * 0.2) continue;

        const gap = orientation === 'vertical'
          ? horizontalGap(curr, other)
          : verticalGap(curr, other);

        if (gap <= windowSize) {
          hasLargerNeighbor = true;
          break;
        }
      }

      if (hasLargerNeighbor) {
        indicesToRemove.add(curr.idx);
        localFurigana.push(curr.idx);
      }
    }

    orientationStats.push({
      orientation,
      medianCross: dominantCross,
      threshold: furiganaThreshold,
      furiganaIndices: localFurigana,
    });

    if (options.debugOutput) {
      debugZones.push({
        zoneIndex: zi,
        indices: zoneIndices,
        bounds: zoneBounds,
        orientationStats,
      });
    }
  }

  if (options.debugOutput) {
    options.debugOutput(debugZones);
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
 *  2. Otherwise fall back to the bounding-box aspect ratio of the entire
 *     zone — if the zone is taller than it is wide the text is most likely
 *     arranged in vertical columns.
 *  3. As a last resort, use the first box's individual orientation.
 */
function determineZoneOrientation(
  cluster: number[],
  infos: BoxMetrics[],
  boxes: OcrBox[],
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

  // 2. Zone bounding-box shape
  if (cluster.length > 1) {
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
 * @returns Map from box index to context phrase string
 */
export function buildOcrContextMap(
  boxes: OcrBox[],
): Map<number, string> {
  const contextMap = new Map<number, string>();
  
  try {
    if (!Array.isArray(boxes) || boxes.length === 0) return contextMap;
    
    const infos = boxes.map((box, idx) => computeBoxMetrics(box, idx));
    
    // Use the shared zone clustering algorithm
    const zones = clusterBoxesIntoZones(infos);
    
    for (const cluster of zones) {
      if (cluster.length === 0) continue;
      
      const orient = determineZoneOrientation(cluster, infos, boxes);
      
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
