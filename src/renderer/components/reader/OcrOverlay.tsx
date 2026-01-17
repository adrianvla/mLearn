/**
 * OCR Overlay Component
 * Displays detected text regions as interactive overlays on images
 */

import { Component, For, Show, createSignal, createMemo, createEffect } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useTokenizer } from '../../hooks';
import './OcrOverlay.css';

export interface OcrBox {
  box: number[][];  // [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
  text: string;
  score?: number;
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
  imageElement: HTMLImageElement | null;
  containerElement: HTMLElement | null;
  onBoxClick?: (box: OcrBox, rect: DOMRect) => void;
  onWordHover?: (token: Token, rect: DOMRect) => void;
  onWordLeave?: () => void;
  visible?: boolean;
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
  const [tokenMap, setTokenMap] = createSignal<Map<number, Token[]>>(new Map());

  // Calculate scale factor to map OCR coordinates to displayed image
  const scaleFactor = createMemo(() => {
    if (!props.imageElement || !props.result) return 1;
    const displayedWidth = props.imageElement.clientWidth || props.imageElement.naturalWidth || 1;
    const sentWidth = props.result.sent_size?.width || (props.result.original_size?.width || 1) * (props.result.client_scale || 1);
    return sentWidth > 0 ? displayedWidth / sentWidth : 1;
  });

  // Calculate overlay position offset
  const overlayOffset = createMemo(() => {
    if (!props.imageElement || !props.containerElement) {
      return { left: 0, top: 0 };
    }

    const containerRect = props.containerElement.getBoundingClientRect();
    const imgRect = props.imageElement.getBoundingClientRect();

    return {
      left: imgRect.left - containerRect.left,
      top: imgRect.top - containerRect.top,
    };
  });

  const handleBoxClick = (box: OcrBox, event: MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    if (props.onBoxClick) {
      props.onBoxClick(box, target.getBoundingClientRect());
    }
  };

  createEffect(() => {
    const result = props.result;
    if (!result || !Array.isArray(result.boxes)) {
      setTokenMap(new Map());
      return;
    }
    const next = new Map<number, Token[]>();
    setTokenMap(next);
    result.boxes.forEach((box, idx) => {
      if (!box?.text || !box.text.trim()) return;
      tokenize(box.text)
        .then((tokens) => {
          setTokenMap((prev) => {
            const updated = new Map(prev);
            updated.set(idx, tokens as Token[]);
            return updated;
          });
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

  const handleWordEnter = (token: Token, e: MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    props.onWordHover?.(token, target.getBoundingClientRect());
  };

  return (
    <Show when={props.visible !== false && props.result && props.result.boxes.length > 0}>
      <div 
        class="ocr-overlay"
        style={{
          left: `${overlayOffset().left}px`,
          top: `${overlayOffset().top}px`,
          width: props.imageElement ? `${props.imageElement.clientWidth}px` : '100%',
          height: props.imageElement ? `${props.imageElement.clientHeight}px` : '100%',
        }}
      >
        <For each={props.result?.boxes || []}>
          {(box, index) => {
            const rect = getBoundingRect(box.box);
            const scale = scaleFactor();
            const isHovered = hoveredBox() === box;
            const isVertical = rect.height > rect.width * 1.2;
            const tokens = () => tokenMap().get(index()) || [];
            const fontSize = () => estimateFontSize(box.text || '', rect.width * scale, rect.height * scale, isVertical);
            
            return (
              <div
                class={`ocr-box ${isHovered ? 'hovered' : ''}`}
                style={{
                  left: `${rect.x * scale}px`,
                  top: `${rect.y * scale}px`,
                  width: `${rect.width * scale}px`,
                  height: `${rect.height * scale}px`,
                }}
                onClick={(e) => handleBoxClick(box, e)}
                onMouseEnter={() => handleBoxHover(box)}
                onMouseLeave={handleBoxLeave}
                title={box.text}
              >
                <div
                  class={`ocr-text ${isVertical ? 'vertical' : ''}`}
                  style={{
                    'writing-mode': isVertical ? 'vertical-rl' : 'horizontal-tb',
                    'text-orientation': isVertical ? 'mixed' : 'initial',
                    'font-size': `${fontSize()}px`,
                  }}
                >
                  <Show when={tokens().length > 0} fallback={box.text}>
                    <For each={tokens()}>
                      {(token) => (
                        <span
                          class="ocr-word"
                          onMouseEnter={(e) => handleWordEnter(token, e)}
                          onMouseLeave={props.onWordLeave}
                        >
                          {token.surface ?? token.word}
                        </span>
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
  );
};

export default OcrOverlay;
