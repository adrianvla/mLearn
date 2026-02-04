/**
 * ExplainerPopup Component
 * Draggable, resizable popup for displaying LLM word explanations
 * Supports streaming responses and raw/parsed view toggle
 */

import { Component, Show, createSignal, createEffect, createMemo, onCleanup } from 'solid-js';
import { DraggablePopup, IconBtn } from '../common';
import { EyeIcon, EyeOffIcon, BotIcon } from '../common/Misc/Icons';
import { useSettings, useLocalization } from '../../context';
import { getWordExplanationStreaming, getCachedExplanation } from '../../services/llmService';
import { parseExplainerResponse, type ParsedExplainer } from '../../utils/explainerParser';
import { ExplainerCards } from './ExplainerCards';
import { Spinner } from '../common';
import './ExplainerPopup.css';

export interface ExplainerPopupProps {
  /** Whether the popup is open */
  isOpen: boolean;
  /** Callback when popup should close */
  onClose: () => void;
  /** The word to explain */
  word: string;
  /** Context phrase/sentence containing the word */
  contextPhrase: string;
  /** Initial position (optional) */
  initialPosition?: { x: number; y: number };
}

/**
 * ExplainerPopup - Streaming LLM explanation popup with raw mode toggle
 */
export const ExplainerPopup: Component<ExplainerPopupProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  
  // State
  const [streamingText, setStreamingText] = createSignal<string>('');
  const [isLoading, setIsLoading] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showRawMode, setShowRawMode] = createSignal(false);
  const [abortFn, setAbortFn] = createSignal<(() => void) | null>(null);

  // Parse the streaming text into structured sections
  const parsedContent = createMemo<ParsedExplainer>(() => {
    const text = streamingText();
    if (!text) {
      return { sections: [] };
    }
    return parseExplainerResponse(text, props.word);
  });

  // Start streaming when popup opens with a new word
  createEffect(() => {
    if (props.isOpen && props.word && props.contextPhrase) {
      startStreaming();
    }
  });

  // Clean up on close
  createEffect(() => {
    if (!props.isOpen) {
      const abort = abortFn();
      if (abort) {
        abort();
        setAbortFn(null);
      }
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    const abort = abortFn();
    if (abort) {
      abort();
    }
  });

  const startStreaming = async () => {
    // Reset state
    setStreamingText('');
    setIsLoading(true);
    setIsComplete(false);
    setError(null);

    // Check cache first (instant response)
    const cached = getCachedExplanation(props.word, props.contextPhrase);
    if (cached) {
      setStreamingText(cached);
      setIsLoading(false);
      setIsComplete(true);
      return;
    }

    // Start streaming
    try {
      const { abort } = await getWordExplanationStreaming(
        props.word,
        props.contextPhrase,
        settings,
        (_chunk, fullText, done) => {
          if (done) {
            setStreamingText(fullText);
            setIsLoading(false);
            setIsComplete(true);
            
            // Check for error
            if (fullText.startsWith('Error:') || fullText.startsWith('LLM')) {
              setError(fullText);
            }
          } else {
            setStreamingText(fullText);
          }
        }
      );
      setAbortFn(() => abort);
    } catch (e) {
      setError(String(e));
      setIsLoading(false);
      setIsComplete(true);
    }
  };

  const handleToggleRawMode = () => {
    setShowRawMode(!showRawMode());
  };

  const handleClose = () => {
    const abort = abortFn();
    if (abort) {
      abort();
      setAbortFn(null);
    }
    props.onClose();
  };

  // Format raw text for display
  const formattedRawText = createMemo(() => {
    const text = streamingText();
    if (!text) return '';
    return text.replace(/\n/g, '<br/>');
  });

  return (
    <DraggablePopup
      isOpen={props.isOpen}
      onClose={handleClose}
      title={`${t('mlearn.Explainer.Title')} - ${props.word}`}
      initialPosition={props.initialPosition}
      initialSize={{ width: 420, height: 380 }}
      minSize={{ width: 320, height: 250 }}
      maxSize={{ width: 700, height: 600 }}
      contentClass="explainer-popup__content"
      headerActions={
        <IconBtn
          variant="ghost"
          size="sm"
          title={showRawMode() ? t('mlearn.Explainer.ShowParsed') : t('mlearn.Explainer.ShowRaw')}
          onClick={handleToggleRawMode}
        >
          <Show when={showRawMode()} fallback={<EyeOffIcon size={16} />}>
            <EyeIcon size={16} />
          </Show>
        </IconBtn>
      }
      footer={
        <div class="explainer-popup__footer">
          <Show when={isComplete() && !error()}>
            <span class="explainer-popup__status">
              <BotIcon size={14} />
              <span>{t('mlearn.Explainer.GeneratedBy')}</span>
            </span>
          </Show>
          <Show when={isLoading()}>
            <span class="explainer-popup__status explainer-popup__status--loading">
              <Spinner size={14} />
              <span>{t('mlearn.Explainer.Generating')}</span>
            </span>
          </Show>
        </div>
      }
    >
      <div class="explainer-popup__body">
        {/* Loading state (initial) */}
        <Show when={isLoading() && !streamingText()}>
          <div class="explainer-popup__loading">
            <Spinner size={32} />
            <p>{t('mlearn.Explainer.Loading')}</p>
          </div>
        </Show>

        {/* Error state */}
        <Show when={error()}>
          <div class="explainer-popup__error">
            <p>{error()}</p>
          </div>
        </Show>

        {/* Content - show when we have text and no error */}
        <Show when={streamingText() && !error()}>
          {/* Raw mode */}
          <Show when={showRawMode()}>
            <div class="explainer-popup__raw">
              <p innerHTML={formattedRawText()} />
            </div>
          </Show>

          {/* Parsed mode */}
          <Show when={!showRawMode()}>
            <ExplainerCards
              data={parsedContent()}
              targetWord={props.word}
              contextPhrase={props.contextPhrase}
              loading={false}
            />
          </Show>

          {/* Streaming cursor indicator */}
          <Show when={isLoading() && streamingText()}>
            <span class="explainer-popup__cursor" />
          </Show>
        </Show>
      </div>
    </DraggablePopup>
  );
};

export default ExplainerPopup;
