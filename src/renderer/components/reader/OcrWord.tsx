/**
 * OCR Word Component
 * Individual word in an OCR overlay box with configurable hover trigger behavior.
 * Supports three hover modes: immediate hover, long hover (delay), and key+hover.
 */

import { Component, createSignal, onCleanup } from 'solid-js';
import type { Token } from '../../../shared/types';
import { useSettings } from '../../context';
import './OcrOverlay.css';

export interface OcrWordProps {
  token: Token;
  onWordEnter?: (token: Token, e: MouseEvent) => void;
  onWordLeave?: () => void;
}

/** Delay in ms for long-hover mode before triggering */
const LONG_HOVER_DELAY = 500;

export const OcrWord: Component<OcrWordProps> = (props) => {
  const { settings } = useSettings();
  
  // For long-hover mode: track timeout
  let longHoverTimeout: ReturnType<typeof setTimeout> | null = null;
  // For key-hover mode: track if key is held and mouse is over word
  const [isMouseOver, setIsMouseOver] = createSignal(false);
  const [isKeyHeld, setIsKeyHeld] = createSignal(false);
  // Track the event for key-hover mode
  let lastMouseEvent: MouseEvent | null = null;
  
  const clearLongHoverTimeout = () => {
    if (longHoverTimeout) {
      clearTimeout(longHoverTimeout);
      longHoverTimeout = null;
    }
  };
  
  const triggerHover = (e: MouseEvent) => {
    props.onWordEnter?.(props.token, e);
  };
  
  const handleMouseEnter = (e: MouseEvent) => {
    lastMouseEvent = e;
    setIsMouseOver(true);
    
    const triggerMode = settings.readerWordHoverTrigger ?? 'hover';
    
    switch (triggerMode) {
      case 'hover':
        // Immediate hover - trigger right away
        triggerHover(e);
        break;
        
      case 'long-hover':
        // Long hover - trigger after delay
        clearLongHoverTimeout();
        longHoverTimeout = setTimeout(() => {
          if (isMouseOver()) {
            triggerHover(e);
          }
        }, LONG_HOVER_DELAY);
        break;
        
      case 'key-hover':
        // Key hover - only trigger if key is already held
        if (isKeyHeld()) {
          triggerHover(e);
        }
        break;
    }
  };
  
  const handleMouseMove = (e: MouseEvent) => {
    lastMouseEvent = e;
    
    // In key-hover mode with key held, behave like normal hover
    const triggerMode = settings.readerWordHoverTrigger ?? 'hover';
    if (triggerMode === 'key-hover' && isKeyHeld() && isMouseOver()) {
      triggerHover(e);
    }
  };
  
  const handleMouseLeave = () => {
    setIsMouseOver(false);
    lastMouseEvent = null;
    clearLongHoverTimeout();
    props.onWordLeave?.();
  };
  
  // Key event handlers for key-hover mode
  const handleKeyDown = (e: KeyboardEvent) => {
    const triggerMode = settings.readerWordHoverTrigger ?? 'hover';
    if (triggerMode !== 'key-hover') return;
    
    const targetKey = settings.readerWordHoverKey ?? 'Shift';
    if (e.key === targetKey && !isKeyHeld()) {
      setIsKeyHeld(true);
      // If mouse is already over this word, trigger hover
      if (isMouseOver() && lastMouseEvent) {
        triggerHover(lastMouseEvent);
      }
    }
  };
  
  const handleKeyUp = (e: KeyboardEvent) => {
    const triggerMode = settings.readerWordHoverTrigger ?? 'hover';
    if (triggerMode !== 'key-hover') return;
    
    const targetKey = settings.readerWordHoverKey ?? 'Shift';
    if (e.key === targetKey) {
      setIsKeyHeld(false);
      // Hide hover when key is released (if mouse is not hovering in normal mode)
      if (isMouseOver()) {
        props.onWordLeave?.();
      }
    }
  };
  
  // Set up global key listeners for key-hover mode
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      clearLongHoverTimeout();
    });
  }
  
  return (
    <span
      class="ocr-word"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {props.token.surface ?? props.token.word}
    </span>
  );
};

export default OcrWord;
