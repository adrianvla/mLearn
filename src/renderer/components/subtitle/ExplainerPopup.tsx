/**
 * ExplainerPopup Component
 * Draggable, resizable popup for displaying LLM word explanations.
 * Uses tool-call-based structured output via the unified LLM provider.
 */

import { Component, Show, createSignal, createEffect, createMemo, onCleanup } from 'solid-js';
import type { LLMToolCall } from '../../../shared/types';
import { DraggablePopup, IconBtn } from '../common';
import { EyeIcon, EyeOffIcon, BotIcon } from '../common/Misc/Icons';
import { useSettings, useLocalization, useLowPowerGate } from '../../context';
import { getLanguageDisplayName } from '../../../shared/utils/textUtils';
import { streamExplanation, getCachedExplanation, checkAvailability, requiresSetup } from '../../services/llmProvider';
import type { ParsedExplainer, ExplainerSection, GrammarPoint } from './ExplainerCards';
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
 * Convert accumulated tool calls into the ParsedExplainer shape
 * that ExplainerCards already understands.
 */
function toolCallsToParsedExplainer(toolCalls: LLMToolCall[], rawText: string): ParsedExplainer {
  const sections: ExplainerSection[] = [];

  for (const tc of toolCalls) {
    const args = tc.arguments as Record<string, unknown>;
    switch (tc.name) {
      case 'show_translation':
        sections.push({
          type: 'translation',
          content: (args.translation as string) ?? '',
        });
        break;
      case 'show_explanation':
        sections.push({
          type: 'explanation',
          word: args.word as string | undefined,
          content: (args.explanation as string) ?? '',
        });
        break;
      case 'show_grammar_points':
        sections.push({
          type: 'grammar',
          grammarPoints: (args.points as GrammarPoint[]) ?? [],
        });
        break;
    }
  }

  return { sections, rawText: rawText || undefined };
}

/**
 * ExplainerPopup - Streaming LLM explanation popup with raw mode toggle
 */
export const ExplainerPopup: Component<ExplainerPopupProps> = (props) => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const { requestAccess } = useLowPowerGate();

  // State
  const [rawText, setRawText] = createSignal('');
  const [toolCalls, setToolCalls] = createSignal<LLMToolCall[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showRawMode, setShowRawMode] = createSignal(false);
  const [abortFn, setAbortFn] = createSignal<(() => void) | null>(null);

  // Build ParsedExplainer from accumulated tool calls
  const parsedContent = createMemo<ParsedExplainer>(() => {
    const calls = toolCalls();
    const text = rawText();
    if (calls.length === 0 && !text) return { sections: [] };
    return toolCallsToParsedExplainer(calls, text);
  });

  const hasContent = createMemo(() => toolCalls().length > 0 || rawText().length > 0);

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

  onCleanup(() => {
    const abort = abortFn();
    if (abort) abort();
  });

  const startStreaming = async () => {
    // Reset state
    setRawText('');
    setToolCalls([]);
    setIsLoading(true);
    setIsComplete(false);
    setError(null);

    // Check cache first
    const cached = getCachedExplanation(props.word, props.contextPhrase);
    if (cached) {
      setToolCalls(cached.toolCalls);
      setRawText(cached.rawText);
      setIsLoading(false);
      setIsComplete(true);
      return;
    }

    // Check setup
    if (requiresSetup(settings)) {
      setError(t('mlearn.AI.SetupRequired'));
      setIsLoading(false);
      setIsComplete(true);
      return;
    }

    // Check availability
    const status = await checkAvailability(settings);
    if (!status.available) {
      setError(status.reason === 'ollama_unreachable'
        ? t('mlearn.AI.OllamaNotReachable')
        : status.reason === 'model_not_downloaded'
          ? t('mlearn.AI.DownloadModel')
          : (status.reason ?? 'LLM unavailable'));
      setIsLoading(false);
      setIsComplete(true);
      return;
    }

    // Stream via unified provider
    const language = getLanguageDisplayName(settings.language);

    // Low power gate: prompt before local LLM call
    if (settings.llmProvider !== 'cloud') {
      const allowed = await requestAccess('llm');
      if (!allowed) {
        setIsLoading(false);
        setIsComplete(true);
        return;
      }
    }

    const handle = streamExplanation(
      props.word,
      props.contextPhrase,
      language,
      {
        onChunk: (_chunk, accumulated) => {
          setRawText(accumulated);
        },
        onToolCall: (tc) => {
          setToolCalls((prev) => [...prev, tc]);
        },
        onDone: (finalContent, _allToolCalls, _stats) => {
          setRawText(finalContent);
          setIsLoading(false);
          setIsComplete(true);
        },
        onError: (err) => {
          setError(err);
          setIsLoading(false);
          setIsComplete(true);
        },
      },
    );
    setAbortFn(() => handle.abort);
  };

  const handleToggleRawMode = () => setShowRawMode(!showRawMode());

  const handleClose = () => {
    const abort = abortFn();
    if (abort) {
      abort();
      setAbortFn(null);
    }
    props.onClose();
  };

  const formattedRawText = createMemo(() => {
    const text = rawText();
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
        <Show when={isLoading() && !hasContent()}>
          <div class="explainer-popup__loading">
            <Spinner size={32} shape="square" strokeWidth={8} cornerRadius={0}/>
            <p>{t('mlearn.Explainer.Loading')}</p>
          </div>
        </Show>

        {/* Error state */}
        <Show when={error()}>
          <div class="explainer-popup__error">
            <p>{error()}</p>
          </div>
        </Show>

        {/* Content */}
        <Show when={hasContent() && !error()}>
          {/* Raw mode - shows the raw text the LLM emitted (for debugging) */}
          <Show when={showRawMode()}>
            <div class="explainer-popup__raw">
              <p innerHTML={formattedRawText()} />
            </div>
          </Show>

          {/* Parsed mode - structured tool-call cards */}
          <Show when={!showRawMode()}>
            <ExplainerCards
              data={parsedContent()}
              targetWord={props.word}
              contextPhrase={props.contextPhrase}
              loading={false}
            />
          </Show>

          {/* Streaming cursor indicator */}
          <Show when={isLoading() && hasContent()}>
            <span class="explainer-popup__cursor" />
          </Show>
        </Show>
      </div>
    </DraggablePopup>
  );
};

export default ExplainerPopup;
