/**
 * OCR Word Component
 * Individual word in an OCR overlay box with configurable hover trigger behavior.
 * Supports three hover modes: immediate hover, long hover (delay), and key+hover.
 */

import { Component, createSignal, onCleanup } from 'solid-js';
import { DEFAULT_SETTINGS, type Token } from '../../../shared/types';
import { useSettings, useFlashcards, useLanguage } from '../../context';
import { matchesKeybind } from '../common/Input/KeybindInput';
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
  const flashcardCtx = useFlashcards();
  const { getCanonicalForm } = useLanguage();
  
  // Reference to the word span element - used to get stable getBoundingClientRect
  // This is necessary because event.currentTarget becomes null after event handlers return,
  // but we need the rect for delayed triggers (long-hover timeout, key-hover on keydown)
  let wordRef: HTMLSpanElement | undefined;
  
  // For long-hover mode: track timeout
  let longHoverTimeout: ReturnType<typeof setTimeout> | null = null;
  // For key-hover mode: track if key is held and mouse is over word
  const [isMouseOver, setIsMouseOver] = createSignal(false);
  const [isKeyHeld, setIsKeyHeld] = createSignal(false);
  
  const clearLongHoverTimeout = () => {
    if (longHoverTimeout) {
      clearTimeout(longHoverTimeout);
      longHoverTimeout = null;
    }
  };
  
  // Trigger hover using the stable element reference
  // Creates a synthetic event-like object with the element as currentTarget
  const triggerHoverFromElement = () => {
    if (!wordRef) return;
    // Create a minimal event-like object with currentTarget set to our stable reference
    // We only need currentTarget for getBoundingClientRect() in the handler
    const syntheticEvent = {
      currentTarget: wordRef,
    } as unknown as MouseEvent;
    props.onWordEnter?.(props.token, syntheticEvent);
  };
  
  const handleMouseEnter = (e: MouseEvent) => {
    setIsMouseOver(true);
    
    // Track word hover for passive knowledge
    const lookupWord = props.token.actual_word ?? props.token.surface ?? props.token.word;
    flashcardCtx.trackWordHovered(getCanonicalForm(lookupWord), props.token.reading);

    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    
    switch (triggerMode) {
      case 'hover':
        // Immediate hover - trigger right away using the live event
        props.onWordEnter?.(props.token, e);
        break;
        
      case 'long-hover':
        // Long hover - trigger after delay using element reference
        clearLongHoverTimeout();
        longHoverTimeout = setTimeout(() => {
          if (isMouseOver()) {
            triggerHoverFromElement();
          }
        }, LONG_HOVER_DELAY);
        break;
        
      case 'key-hover':
        // Key hover - only trigger if key is already held
        if (isKeyHeld()) {
          props.onWordEnter?.(props.token, e);
        }
        break;
    }
  };
  
  const handleMouseMove = (e: MouseEvent) => {
    // In key-hover mode with key held, behave like normal hover
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    if (triggerMode === 'key-hover' && isKeyHeld() && isMouseOver()) {
      props.onWordEnter?.(props.token, e);
    }
  };
  
  const handleMouseLeave = () => {
    setIsMouseOver(false);
    clearLongHoverTimeout();
    
    // Cancel hover timer for passive knowledge
    const lookupWord = props.token.actual_word ?? props.token.surface ?? props.token.word;
    flashcardCtx.cancelWordHover(getCanonicalForm(lookupWord));

    props.onWordLeave?.();
  };
  
  // Key event handlers for key-hover mode
  const handleKeyDown = (e: KeyboardEvent) => {
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    if (triggerMode !== 'key-hover') return;
    
    const keybind = settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!;
    if (matchesKeybind(e, keybind) && !isKeyHeld()) {
      setIsKeyHeld(true);
      if (isMouseOver()) {
        triggerHoverFromElement();
      }
    }
  };
  
  const handleKeyUp = (e: KeyboardEvent) => {
    const triggerMode = settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger;
    if (triggerMode !== 'key-hover') return;
    
    const keybind = settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!;
    if (matchesKeybind(e, keybind)) {
      setIsKeyHeld(false);
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
      ref={wordRef}
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
