/**
 * OCR Overlay Component
 * Displays detected text regions as interactive overlays on images
 */

import { Component, For, Show, createSignal, createMemo, createEffect, onCleanup } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useTokenizer, warmTranslationCache } from '../../hooks';
import { useLanguage, useSettings } from '../../context';
import { buildOcrContextMap, filterNarrowBoxes } from '../../utils/ocrUtils';
import { OcrWord } from './OcrWord';
import { FuriganaHider } from './FuriganaHider';
import './OcrOverlay.css';

export interface OcrBox {
  box: number[][];  // [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
  text: string;
  score?: number;
  __originalIdx?: number; // Added to track original index after filtering
}

export interface OcrResult {
  boxes: OcrBox[];
  client_scale?: number;
  downscale_factor?: number;
  original_size?: { width: number; height: number };
  sent_size?: { width: number; height: number };
}

export interface OcrOverlayProps {
  result: OcrResult | null;
  imageElement?: HTMLImageElement | null;
  visible?: boolean;
  onBoxClick?: (box: OcrBox, rect: DOMRect) => void;
  /** Called when hovering over a word. Includes context phrase from neighboring boxes. */
  onWordHover?: (token: Token, rect: DOMRect, contextPhrase: string) => void;
  onWordLeave?: () => void;
  /** Called on right-click with context phrase for the clicked area */
  onContextMenu?: (contextPhrase: string, boxIndex: number) => void;
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

// Measure a reasonable font size to fit text in the OCR box
function estimateFontSize(text: string, width: number, height: number, vertical: boolean): number {
  if (!text || width <= 0 || height <= 0) return 12;
  const basePx = 100;
  const canvas = (estimateFontSize as any).__canvas || ((estimateFontSize as any).__canvas = document.createElement('canvas'));
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
  const { tokenize } = useTokenizer();
  const { isTranslatable, getLanguageFeatures } = useLanguage();
  const { settings } = useSettings();
  const [tokenMap, setTokenMap] = createSignal<Map<number, Token[]>>(new Map());
  const [contextMap, setContextMap] = createSignal<Map<number, string>>(new Map());
  const [observedWidth, setObservedWidth] = createSignal(0);
  const [observedHeight, setObservedHeight] = createSignal(0);
  // Track the image's offset position within its parent container
  const [imageOffsetLeft, setImageOffsetLeft] = createSignal(0);
  const [imageOffsetTop, setImageOffsetTop] = createSignal(0);

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

  // Filter boxes to remove furigana - this is the main list to render
  // Add __originalIdx to track indices for context map lookup
  const filteredBoxes = createMemo(() => {
    const result = props.result;
    if (!result || !Array.isArray(result.boxes)) return [];
    
    // Add original index tracking before filtering
    const boxesWithIdx: OcrBox[] = result.boxes.map((box, idx) => ({
      ...box,
      __originalIdx: idx,
    }));
    
    // Filter out narrow furigana boxes (like old app does)
    // This prevents furigana from being hoverable
    const filtered = filterNarrowBoxes(boxesWithIdx, {
      ratio: settings.ocrFuriganaWidthRatio,
      neighborWindowMultiplier: settings.ocrFuriganaNeighborWindowMultiplier,
      neighborLookahead: settings.ocrFuriganaNeighborLookahead,
    });
    
    return filtered;
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

  // Build context map from filtered boxes
  createEffect(() => {
    const boxes = filteredBoxes();
    if (!boxes || boxes.length === 0) {
      setContextMap(new Map());
      return;
    }
    
    // Build context map for neighboring text boxes
    // The map is indexed by position in filteredBoxes array
    const ctx = buildOcrContextMap(boxes);
    setContextMap(ctx);
  });

  const handleBoxClick = (box: OcrBox, event: MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    if (props.onBoxClick) {
      props.onBoxClick(box, target.getBoundingClientRect());
    }
  };

  // Tokenize filtered boxes and build token map
  createEffect(() => {
    const boxes = filteredBoxes();
    if (!boxes || boxes.length === 0) {
      setTokenMap(new Map());
      return;
    }
    const next = new Map<number, Token[]>();
    setTokenMap(next);
    
    // Tokenize all boxes and pre-warm translation cache
    boxes.forEach((box, idx) => {
      if (!box?.text || !box.text.trim()) return;
      tokenize(box.text)
        .then(async (tokens) => {
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
            warmTranslationCache(translatableWords, settings.getTranslationUrl);
          }
        })
        .catch(() => {
          /* ignore tokenization errors */
        });
    });
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
    props.onContextMenu?.(context, boxIndex);
  };

  // Check if vertical text is supported by the current language
  const langFeatures = createMemo(() => getLanguageFeatures());
  
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
              // Detect vertical text based on aspect ratio
              const isVertical = rect.height > rect.width * 1.2;
              // Only use vertical styling if language supports it
              const useVerticalLayout = () => isVertical && langFeatures().supportsVerticalText;
              const tokens = () => tokenMap().get(index()) || [];
              const fontSize = () => estimateFontSize(box.text || '', rect.width * getScale(), rect.height * getScale(), useVerticalLayout());
              
              return (
                <div
                  class="ocr-box"
                  classList={{
                    'hovered': isHovered(),
                    'vertical-box': useVerticalLayout(),
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
                      // Prevent text wrapping for vertical text
                      'white-space': useVerticalLayout() ? 'nowrap' : 'normal',
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
