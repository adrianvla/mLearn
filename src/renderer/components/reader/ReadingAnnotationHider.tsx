/**
 * Reading Annotation Hider Component
 * Renders white rectangles over detected reading annotation boxes that fade on hover.
 * This lets learners test the written form before revealing its reading.
 */

import { Component, For, Show, createMemo } from 'solid-js';
import type { OcrBox } from './OcrOverlay';
import './ReadingAnnotationHider.css';

export interface ReadingAnnotationHiderProps {
  /** The reading annotation boxes to hide (filtered out boxes from OCR) */
  readingAnnotationBoxes: OcrBox[];
  /** Scale factor to map OCR coordinates to displayed image */
  scaleFactor: number;
  /** Whether the hider is enabled */
  enabled: boolean;
  /** Width of the overlay container */
  width: number;
  /** Height of the overlay container */
  height: number;
  /** Horizontal offset from parent container (to align with image) */
  offsetLeft?: number;
  /** Vertical offset from parent container (to align with image) */
  offsetTop?: number;
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

export const ReadingAnnotationHider: Component<ReadingAnnotationHiderProps> = (props) => {
  const boxesWithRects = createMemo(() => {
    if (!props.enabled || !props.readingAnnotationBoxes || props.readingAnnotationBoxes.length === 0) {
      return [];
    }
    
    return props.readingAnnotationBoxes.map((box, idx) => ({
      box,
      rect: getBoundingRect(box.box),
      id: `reading-annotation-hider-${idx}`,
    }));
  });
  
  return (
    <Show when={props.enabled && boxesWithRects().length > 0}>
      <div 
        class="reading-annotation-hider-overlay"
        style={{
          left: `${props.offsetLeft ?? 0}px`,
          top: `${props.offsetTop ?? 0}px`,
          width: `${props.width}px`,
          height: `${props.height}px`,
        }}
      >
        <For each={boxesWithRects()}>
          {(item) => {
            const scale = props.scaleFactor;
            return (
              <div
                class="reading-annotation-hider-box"
                style={{
                  left: `${item.rect.x * scale}px`,
                  top: `${item.rect.y * scale}px`,
                  width: `${item.rect.width * scale}px`,
                  height: `${item.rect.height * scale}px`,
                }}
                title={item.box.text || ''}
              />
            );
          }}
        </For>
      </div>
    </Show>
  );
};

export default ReadingAnnotationHider;
