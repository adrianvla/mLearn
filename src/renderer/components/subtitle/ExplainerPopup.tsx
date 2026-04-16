/**
 * ExplainerPopup Component
 * Draggable, resizable popup for displaying LLM word explanations.
 * Uses tool-call-based structured output via the unified LLM provider.
 */

import { Component, Show, createSignal, createEffect, createMemo, onCleanup } from 'solid-js';
import type { LLMToolCall } from '../../../shared/types';
import { DraggablePopup, IconBtn } from '../common';
import { RefreshIcon, BotIcon } from '../common/Misc/Icons';
import { useSettings, useLocalization, useLowPowerGate } from '../../context';
import { getLanguageDisplayName } from '../../../shared/utils/textUtils';
import { streamExplanation, getCachedExplanation, checkAvailability, requiresSetup, type ExplainerMode } from '../../services/llmProvider';
import type { ParsedExplainer, ExplainerSection, GrammarPoint } from './ExplainerCards';
import { ExplainerCards } from './ExplainerCards';
import { buildExplainerGeneratedByLabel } from './explainerProviderLabel';
import { hasExplainerGenerationOutput, normalizeExplainerErrorMessage } from './explainerPopupState';
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
  /** Whether this popup is for a word or a phrase explanation */
  mode?: ExplainerMode;
  /** Initial position (optional) */
  initialPosition?: { x: number; y: number };
}

/**
 * Convert accumulated tool calls into the ParsedExplainer shape
 * that ExplainerCards already understands.
 */
function toolCallsToParsedExplainer(toolCalls: LLMToolCall[], rawText: string): ParsedExplainer {
  const sections: ExplainerSection[] = [];
  const latestByName = new Map<string, LLMToolCall>();

  for (const toolCall of toolCalls) {
    latestByName.set(toolCall.name, toolCall);
  }

  const translationCall = latestByName.get('show_translation');
  if (translationCall) {
    const args = translationCall.arguments as Record<string, unknown>;
    sections.push({
      type: 'translation',
      content: (args.translation as string) ?? '',
    });
  }

  const explanationCall = latestByName.get('show_explanation');
  if (explanationCall) {
    const args = explanationCall.arguments as Record<string, unknown>;
    sections.push({
      type: 'explanation',
      word: args.word as string | undefined,
      content: (args.explanation as string) ?? '',
    });
  }

  const grammarCall = latestByName.get('show_grammar_points');
  if (grammarCall) {
    const args = grammarCall.arguments as Record<string, unknown>;
    sections.push({
      type: 'grammar',
      grammarPoints: (args.points as GrammarPoint[]) ?? [],
    });
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
  const explainerMode = createMemo<ExplainerMode>(() => props.mode ?? 'word');
  let activeStreamRequestId = 0;

  // State
  const [rawText, setRawText] = createSignal('');
  const [toolCalls, setToolCalls] = createSignal<LLMToolCall[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isComplete, setIsComplete] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [abortFn, setAbortFn] = createSignal<(() => void) | null>(null);

  // Build ParsedExplainer from accumulated tool calls
  const parsedContent = createMemo<ParsedExplainer>(() => {
    const calls = toolCalls();
    const text = rawText();
    if (calls.length === 0 && !text) return { sections: [] };
    return toolCallsToParsedExplainer(calls, text);
  });

  const hasContent = createMemo(() => {
    const parsed = parsedContent();
    return parsed.sections.length > 0 || !!parsed.rawText?.trim();
  });
  const generatedByLabel = createMemo(() => buildExplainerGeneratedByLabel(settings.llmProvider, t));
  const popupTitle = createMemo(() => {
    if (explainerMode() === 'phrase' || !props.word) {
      return t('mlearn.Explainer.Title');
    }

    return `${t('mlearn.Explainer.Title')} - ${props.word}`;
  });

  // Start streaming when popup opens with a new word
  createEffect(() => {
    if (props.isOpen && props.contextPhrase && (explainerMode() === 'phrase' || props.word)) {
      startStreaming();
    }
  });

  // Clean up on close
  createEffect(() => {
    if (!props.isOpen) {
      cancelActiveStream();
    }
  });

  onCleanup(() => {
    cancelActiveStream();
  });

  const cancelActiveStream = () => {
    activeStreamRequestId += 1;
    const abort = abortFn();
    if (abort) {
      abort();
      setAbortFn(null);
    }
  };

  const getExplainerFailureMessage = () => t('mlearn.Explainer.GenerationFailed');

  const startStreaming = async (options: { skipCache?: boolean } = {}) => {
    const requestId = activeStreamRequestId + 1;
    cancelActiveStream();
    activeStreamRequestId = requestId;

    // Reset state
    setRawText('');
    setToolCalls([]);
    setIsLoading(true);
    setIsComplete(false);
    setError(null);

    // Check cache first
    if (!options.skipCache) {
      const cached = getCachedExplanation(props.word, props.contextPhrase, explainerMode());
      if (cached && hasExplainerGenerationOutput(cached.rawText, cached.toolCalls)) {
        setToolCalls(cached.toolCalls);
        setRawText(cached.rawText);
        setIsLoading(false);
        setIsComplete(true);
        return;
      }
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
    if (requestId !== activeStreamRequestId) {
      return;
    }

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
      if (requestId !== activeStreamRequestId) {
        return;
      }

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
          if (requestId !== activeStreamRequestId) {
            return;
          }

          setRawText(accumulated);
        },
        onToolCall: (tc) => {
          if (requestId !== activeStreamRequestId) {
            return;
          }

          setToolCalls((prev) => [...prev, tc]);
        },
        onDone: (finalContent, allToolCalls, _stats) => {
          if (requestId !== activeStreamRequestId) {
            return;
          }

          if (!hasExplainerGenerationOutput(finalContent, allToolCalls)) {
            setError(getExplainerFailureMessage());
            setRawText('');
            setToolCalls([]);
            setIsLoading(false);
            setIsComplete(true);
            return;
          }

          setRawText(finalContent);
          setIsLoading(false);
          setIsComplete(true);
        },
        onError: (err) => {
          if (requestId !== activeStreamRequestId) {
            return;
          }

          setError(normalizeExplainerErrorMessage(err, getExplainerFailureMessage()));
          setIsLoading(false);
          setIsComplete(true);
        },
      },
      { mode: explainerMode() },
    );

    if (requestId !== activeStreamRequestId) {
      handle.abort();
      return;
    }

    setAbortFn(() => handle.abort);
  };

  const handleRegenerate = () => {
    void startStreaming({ skipCache: true });
  };

  const handleClose = () => {
    cancelActiveStream();
    props.onClose();
  };

  return (
    <DraggablePopup
      isOpen={props.isOpen}
      onClose={handleClose}
      title={popupTitle()}
      initialPosition={props.initialPosition}
      initialSize={{ width: 420, height: 380 }}
      minSize={{ width: 320, height: 250 }}
      maxSize={{ width: 700, height: 600 }}
      contentClass="explainer-popup__content"
      headerActions={
        <IconBtn
          variant="ghost"
          size="sm"
          title={t('mlearn.ConversationAgent.Regenerate')}
          onClick={handleRegenerate}
        >
          <RefreshIcon size={16} />
        </IconBtn>
      }
      footer={
        <div class="explainer-popup__footer">
          <Show when={isComplete() && !error() && hasContent()}>
            <span class="explainer-popup__status">
              <BotIcon size={14} />
              <span>{generatedByLabel()}</span>
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
          <ExplainerCards
            data={parsedContent()}
            targetWord={explainerMode() === 'word' ? props.word : undefined}
            contextPhrase={props.contextPhrase}
            loading={false}
          />

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
