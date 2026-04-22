/**
 * OCR Overlay Component
 * Displays detected text regions as interactive overlays on images
 */

import { Component, For, Show, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useTokenizer, warmTranslationCache } from '../../hooks';
import { useLanguage, useSettings } from '../../context';
import { processOcrBoxes, type FilterDebugZone } from '../../utils/ocrUtils';
import { OcrWord } from './OcrWord';
import { FuriganaHider } from './FuriganaHider';
import './OcrOverlay.css';

export interface OcrBox {
  box: number[][];  // [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
  text: string;
  score?: number;
  is_vertical?: boolean;  // Backend-computed orientation from box aspect ratio
  __originalIdx?: number; // Added to track original index after filtering
}

export interface OcrProcessingTimes {
  total_ms: number;
  detection_ms?: number;
  detection_engine?: string;
  recognition_ms?: number;
  recognition_engine?: string;
  per_box_ms?: number[];
}

export interface OcrResult {
  boxes: OcrBox[];
  client_scale?: number;
  downscale_factor?: number;
  original_size?: { width: number; height: number };
  sent_size?: { width: number; height: number };
  processing_times?: OcrProcessingTimes;
}

export interface OcrOverlayProps {
  result: OcrResult | null;
  imageElement?: HTMLImageElement | null;
  visible?: boolean;
  /** Show debug overlay coloring for text vs furigana boxes */
  debugOcr?: boolean;
  /** Live-tuneable zone delta threshold in pixels (dev mode) */
  zoneDeltaThreshold?: number;
  onBoxClick?: (box: OcrBox, rect: DOMRect) => void;
  /** Called when hovering over a word. Includes context phrase from neighboring boxes. */
  onWordHover?: (token: Token, rect: DOMRect, contextPhrase: string) => void;
  onWordLeave?: () => void;
  /** Called on right-click with context phrase for the clicked area */
  onContextMenu?: (contextPhrase: string, boxIndex: number, position: { x: number; y: number }) => void;
  /** Called whenever the overlay has OCR token/context data ready for the current page. */
  onTokenDataChange?: (entries: Array<{ boxIndex: number; box: OcrBox; tokens: Token[]; contextPhrase: string }>) => void;
  /** Set of original box indices to highlight (e.g. from sidebar hover) */
  highlightedOriginalIndices?: Set<number>;
}

/**
 * Calculate bounding box from 4 corner points
 */
function getBoundingRect(box: number[][]): { x: number; y: number; width: number; height: number } {
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

let fontMeasureCanvas: HTMLCanvasElement | null = null;

// Measure a reasonable font size to fit text in the OCR box
function estimateFontSize(text: string, width: number, height: number, vertical: boolean): number {
  if (!text || width <= 0 || height <= 0) return 12;
  const basePx = 100;
  fontMeasureCanvas ??= document.createElement('canvas');
  const canvas = fontMeasureCanvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 12;
  ctx.font = `400 ${basePx}px sans-serif`;

  const lineH = (() => {
    const m = ctx.measureText('Mg');
    const h = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
    return h > 0 ? h : basePx * 1.1;
  })();

  const str = text.trim();
  if (!str) return 12;

  let reqW = 0;
  let reqH = 0;
  if (vertical) {
    let maxW = 0;
    let count = 0;
    for (const ch of str) {
      maxW = Math.max(maxW, ctx.measureText(ch).width);
      count++;
    }
    reqW = maxW;
    reqH = count * lineH;
  } else {
    const m = ctx.measureText(str);
    reqW = m.width;
    reqH = lineH;
  }

  const scaleW = width / Math.max(1, reqW);
  const scaleH = height / Math.max(1, reqH);
  const target = Math.max(6, Math.min(96, Math.floor(basePx * Math.min(scaleW, scaleH))));
  return target;
}

export const OcrOverlay: Component<OcrOverlayProps> = (props) => {
  const [hoveredBox, setHoveredBox] = createSignal<OcrBox | null>(null);
  const { isTranslatable, getLanguageFeatures } = useLanguage();
  const { settings } = useSettings();
  const { tokenize } = useTokenizer({ language: settings.language });
  const [tokenMap, setTokenMap] = createSignal<Map<number, Token[]>>(new Map());
  const [observedWidth, setObservedWidth] = createSignal(0);
  const [observedHeight, setObservedHeight] = createSignal(0);
  const [imageOffsetLeft, setImageOffsetLeft] = createSignal(0);
  const [imageOffsetTop, setImageOffsetTop] = createSignal(0);
  const [debugZones, setDebugZones] = createSignal<FilterDebugZone[]>([]);

  // Check if vertical text is supported by the current language
  const langFeatures = createMemo(() => getLanguageFeatures());

  createEffect(() => {
    const el = props.imageElement;
    if (!el) return;
    
    // Helper to update dimensions and position only when they're valid
    const updateDimensionsAndPosition = () => {
      const width = el.clientWidth || el.naturalWidth || 0;
      const height = el.clientHeight || el.naturalHeight || 0;
      if (width > 0 && height > 0) {
        setObservedWidth(width);
        setObservedHeight(height);
        // Get the image's offset relative to its offset parent (the .page container)
        setImageOffsetLeft(el.offsetLeft);
        setImageOffsetTop(el.offsetTop);
      }
    };
    
    // Set initial dimensions and position
    updateDimensionsAndPosition();
    
    // Also listen for image load event in case dimensions aren't available yet
    const handleLoad = () => updateDimensionsAndPosition();
    el.addEventListener('load', handleLoad);
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (width > 0 && height > 0) {
          setObservedWidth(width);
          setObservedHeight(height);
          // Update position on resize as flexbox centering may change
          const target = entry.target as HTMLElement;
          setImageOffsetLeft(target.offsetLeft);
          setImageOffsetTop(target.offsetTop);
        }
      }
    });
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
      el.removeEventListener('load', handleLoad);
    });
  });

  // Calculate scale factor to map OCR coordinates to displayed image
  const scaleFactor = createMemo(() => {
    if (!props.imageElement || !props.result) return 1;
    // Depend on observedWidth to trigger re-calc on resize
    // Use observedWidth/Height which are guaranteed to be > 0 once set properly
    const displayedWidth = observedWidth();
    if (displayedWidth <= 0) return 1; // Not ready yet, use identity scale
    
    const sentWidth = props.result.sent_size?.width || (props.result.original_size?.width || 1) * (props.result.client_scale || 1);
    return sentWidth > 0 ? displayedWidth / sentWidth : 1;
  });

  // Single-pass zone processing: filter furigana + build context phrases together
  const processedZones = createMemo(() => {
    const result = props.result;
    if (!result || !Array.isArray(result.boxes) || result.boxes.length === 0) {
      return { filtered: [] as OcrBox[], contextMapByOriginal: new Map<number, string>() };
    }

    const boxesWithIdx: OcrBox[] = result.boxes.map((box, idx) => ({
      ...box,
      __originalIdx: idx,
    }));

    const { filtered, contextMap: ctxMap } = processOcrBoxes(boxesWithIdx, {
      ratio: settings.ocrFuriganaWidthRatio,
      neighborWindowMultiplier: settings.ocrFuriganaNeighborWindowMultiplier,
      zoneDeltaThreshold: props.zoneDeltaThreshold,
      debugOutput: props.debugOcr ? setDebugZones : undefined,
    });

    // When furigana detection is disabled, return all boxes unfiltered
    if (!(settings.ocrFuriganaDetection ?? true)) {
      return { filtered: boxesWithIdx, contextMapByOriginal: ctxMap };
    }

    return { filtered, contextMapByOriginal: ctxMap };
  });

  // The filteredBoxes list drives rendering
  const filteredBoxes = createMemo(() => processedZones().filtered);

  // Remap context from original indices to filtered-array indices for consumers
  const contextMap = createMemo(() => {
    const { contextMapByOriginal } = processedZones();
    const boxes = filteredBoxes();
    const mapped = new Map<number, string>();
    for (let i = 0; i < boxes.length; i++) {
      const origIdx = boxes[i].__originalIdx;
      if (origIdx != null) {
        const ctx = contextMapByOriginal.get(origIdx);
        if (ctx) mapped.set(i, ctx);
      }
    }
    return mapped;
  });
  
  // Compute the furigana boxes (boxes that were filtered out)
  // These are used by FuriganaHider to overlay white rectangles
  const furiganaBoxes = createMemo(() => {
    const result = props.result;
    if (!result || !Array.isArray(result.boxes)) return [];
    
    const filtered = filteredBoxes();
    const filteredIdxSet = new Set(filtered.map(b => b.__originalIdx));
    
    // Return boxes that were filtered out (furigana)
    return result.boxes.filter((_, idx) => !filteredIdxSet.has(idx));
  });

  const handleBoxClick = (box: OcrBox, event: MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    if (props.onBoxClick) {
      props.onBoxClick(box, target.getBoundingClientRect());
    }
  };

  // Persistent cache: box text → Token[] (survives across reactive recalculations)
  const ocrTokenCache = new Map<string, Token[]>();

  // Tokenize filtered boxes and build token map
  createEffect(() => {
    const boxes = filteredBoxes();
    if (!boxes || boxes.length === 0) {
      setTokenMap(new Map());
      return;
    }
    const next = new Map<number, Token[]>();
    const toFetch: { text: string; idx: number }[] = [];

    // Reuse cached tokens synchronously to avoid flash of untokenized text
    boxes.forEach((box, idx) => {
      if (!box?.text || !box.text.trim()) return;
      const cached = ocrTokenCache.get(box.text);
      if (cached) {
        next.set(idx, cached);
      } else {
        toFetch.push({ text: box.text, idx });
      }
    });

    // Set token map with all cached entries immediately (no async gap)
    setTokenMap(next);

    // Only tokenize texts we haven't seen before
    toFetch.forEach(({ text, idx }) => {
      tokenize(text)
        .then(async (tokens) => {
          ocrTokenCache.set(text, tokens as Token[]);
          setTokenMap((prev) => {
            const updated = new Map(prev);
            updated.set(idx, tokens as Token[]);
            return updated;
          });

          // Pre-warm translation cache for translatable words
          const translatableWords = (tokens as Token[])
            .filter((t) => t.actual_word && isTranslatable(t.type))
            .map((t) => t.actual_word);

          if (translatableWords.length > 0) {
            warmTranslationCache(translatableWords, undefined, undefined, settings.language);
          }
        })
        .catch(() => {
          /* ignore tokenization errors */
        });
    });
  });

  createEffect(() => {
    const callback = props.onTokenDataChange;
    if (!callback) return;

    const boxes = filteredBoxes();
    const tokensByBox = tokenMap();
    const contexts = contextMap();

    const entries = boxes
      .map((box, index) => ({
        boxIndex: index,
        box,
        tokens: tokensByBox.get(index) || [],
        contextPhrase: contexts.get(index) || '',
      }))
      .filter((entry) => entry.tokens.length > 0);

    callback(entries);
  });

  const handleBoxHover = (box: OcrBox) => {
    setHoveredBox(box);
  };

  const handleBoxLeave = () => {
    setHoveredBox(null);
    props.onWordLeave?.();
  };

  const handleWordEnter = (token: Token, boxIndex: number, e: MouseEvent) => {
    // Only show hover for translatable types (like old app's TRANSLATABLE.includes(pos))
    if (!isTranslatable(token.type)) return;
    
    const target = e.currentTarget as HTMLElement;
    // Get context phrase from context map (stitched from neighboring boxes)
    // boxIndex is the index in filteredBoxes array
    const context = contextMap().get(boxIndex) || '';
    props.onWordHover?.(token, target.getBoundingClientRect(), context);
  };

  // Handle right-click context menu on OCR boxes
  const handleBoxContextMenu = (boxIndex: number, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Get context phrase from context map
    const context = contextMap().get(boxIndex) || '';
    props.onContextMenu?.(context, boxIndex, { x: e.clientX + 16, y: e.clientY + 16 });
  };

  // Only render when we have valid dimensions to calculate positions correctly
  const isReady = () => observedWidth() > 0 && observedHeight() > 0;
  
  // Check if furigana hider is enabled
  const furiganaHiderEnabled = () => settings.readerFuriganaHider ?? false;

  return (
    <Show when={props.visible !== false && isReady()}>
      {/* Furigana Hider - white rectangles over furigana that fade on hover */}
      <FuriganaHider
        furiganaBoxes={furiganaBoxes()}
        scaleFactor={scaleFactor()}
        enabled={furiganaHiderEnabled()}
        width={observedWidth()}
        height={observedHeight()}
        offsetLeft={imageOffsetLeft()}
        offsetTop={imageOffsetTop()}
      />
      
      {/* Debug overlay for furigana boxes - shown with debug coloring */}
      <Show when={props.debugOcr && furiganaBoxes().length > 0}>
        <div
          class="ocr-overlay"
          style={{
            left: `${imageOffsetLeft()}px`,
            top: `${imageOffsetTop()}px`,
            width: `${observedWidth()}px`,
            height: `${observedHeight()}px`,
            opacity: 1,
          }}
        >
          <For each={furiganaBoxes()}>
            {(box) => {
              const rect = getBoundingRect(box.box);
              const getScale = () => scaleFactor();
              return (
                <div
                  class="ocr-box debug-furigana"
                  style={{
                    left: `${rect.x * getScale()}px`,
                    top: `${rect.y * getScale()}px`,
                    width: `${rect.width * getScale()}px`,
                    height: `${rect.height * getScale()}px`,
                  }}
                  title={`[Furigana] ${box.text}`}
                />
              );
            }}
          </For>
        </div>
      </Show>

      {/* Debug overlay for zone boundaries */}
      <Show when={props.debugOcr && debugZones().length > 0}>
        <div
          class="ocr-overlay"
          style={{
            left: `${imageOffsetLeft()}px`,
            top: `${imageOffsetTop()}px`,
            width: `${observedWidth()}px`,
            height: `${observedHeight()}px`,
            opacity: 1,
          }}
        >
          <For each={debugZones()}>
            {(zone) => {
              const getScale = () => scaleFactor();
              const hue = () => (zone.zoneIndex * 137) % 360;
              const b = zone.bounds;
              const statsText = () => zone.orientationStats
                .map(s => `${s.orientation}: median=${s.medianCross.toFixed(0)} thresh=${s.threshold.toFixed(0)} furigana=${s.furiganaIndices.length}`)
                .join(' | ');
              return (
                <div
                  class="ocr-debug-zone"
                  style={{
                    left: `${b.minX * getScale()}px`,
                    top: `${b.minY * getScale()}px`,
                    width: `${(b.maxX - b.minX) * getScale()}px`,
                    height: `${(b.maxY - b.minY) * getScale()}px`,
                    'border-color': `hsl(${hue()}, 70%, 55%)`,
                    'background-color': `hsla(${hue()}, 70%, 55%, 0.06)`,
                  }}
                  title={`Zone ${zone.zoneIndex} (${zone.indices.length} boxes) ${statsText()}`}
                >
                  <span
                    class="ocr-debug-zone-label"
                    style={{ 'background-color': `hsl(${hue()}, 70%, 55%)` }}
                  >
                    Z{zone.zoneIndex}
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      
      <Show when={filteredBoxes().length > 0}>
        <div 
          class="ocr-overlay"
          style={{
            left: `${imageOffsetLeft()}px`,
            top: `${imageOffsetTop()}px`,
            width: `${observedWidth()}px`,
            height: `${observedHeight()}px`,
            opacity: 1,
          }}
        >
          <For each={filteredBoxes()}>
            {(box, index) => {
              const rect = getBoundingRect(box.box);
              // Use getter function to ensure reactivity when scaleFactor changes on resize
              const getScale = () => scaleFactor();
              const isHovered = () => hoveredBox() === box;
              // Detect vertical text: prefer backend flag, fall back to aspect ratio
              const isVertical = box.is_vertical ?? (rect.height > rect.width * 1.2);
              // Only use vertical styling if language supports it
              const useVerticalLayout = () => isVertical && langFeatures().supportsVerticalText;
              const tokens = () => tokenMap().get(index()) || [];
              const fontSize = () => estimateFontSize(box.text || '', rect.width * getScale(), rect.height * getScale(), useVerticalLayout());
              
              return (
                <div
                  class="ocr-box"
                  classList={{
                    'hovered': isHovered(),
                    'sidebar-highlighted': box.__originalIdx != null && (props.highlightedOriginalIndices?.has(box.__originalIdx) ?? false),
                    'vertical-box': useVerticalLayout(),
                    'debug-text': props.debugOcr === true,
                  }}
                  style={{
                    left: `${rect.x * getScale()}px`,
                    top: `${rect.y * getScale()}px`,
                    width: `${rect.width * getScale()}px`,
                    height: `${rect.height * getScale()}px`,
                  }}
                  onClick={(e) => handleBoxClick(box, e)}
                  onContextMenu={(e) => handleBoxContextMenu(index(), e)}
                  onMouseEnter={() => handleBoxHover(box)}
                  onMouseLeave={handleBoxLeave}
                  title={box.text}
                >
                  <div
                    class="ocr-text"
                    classList={{ 'vertical': useVerticalLayout() }}
                    style={{
                      'writing-mode': useVerticalLayout() ? 'vertical-rl' : 'horizontal-tb',
                      'text-orientation': useVerticalLayout() ? 'mixed' : 'initial',
                      'font-size': `${fontSize()}px`,
                    }}
                  >
                    <Show when={tokens().length > 0} fallback={box.text}>
                      <For each={tokens()}>
                        {(token) => (
                          <OcrWord
                            token={token}
                            onWordEnter={(t, e) => handleWordEnter(t, index(), e)}
                            onWordLeave={props.onWordLeave}
                          />
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </Show>
  );
};

export default OcrOverlay;
