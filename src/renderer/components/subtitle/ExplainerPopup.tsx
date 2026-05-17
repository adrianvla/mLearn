/**
 * ExplainerPopup Component
 * Draggable, resizable popup for displaying LLM word explanations.
 * Uses tool-call-based structured output via the unified LLM provider.
 */

import { Component, Show, createSignal, createEffect, createMemo, onCleanup, untrack } from 'solid-js';
import type { LLMToolCall } from '../../../shared/types';
import { Button, DraggablePopup, IconBtn } from '../common';
import { RefreshIcon, BotIcon } from '../common/Misc/Icons';
import { useSettings, useLocalization, useLowPowerGate } from '../../context';
import { getLanguageDisplayName } from '../../../shared/utils/textUtils';
import { streamExplanation, getCachedExplanation, requiresSetup, type ExplainerMode } from '../../services/llmProvider';
import { CloudSessionCancelledError, CloudUnreachableError } from '../../services/cloudSessionManager';
import type { ParsedExplainer, ExplainerSection, GrammarPoint } from './ExplainerCards';
import { ExplainerCards } from './ExplainerCards';
import { buildExplainerGeneratedByLabel } from './explainerProviderLabel';
import { hasExplainerGenerationOutput, isQuotaError, normalizeExplainerErrorMessage } from './explainerPopupState';
import { Spinner } from '../common';
import './ExplainerPopup.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.components.explainerPopup");

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
  const [errorKind, setErrorKind] = createSignal<'generic' | 'cancelled' | 'unreachable' | 'quota' | null>(null);
  const [abortFn, setAbortFn] = createSignal<(() => void) | null>(null);

  const isCancelledCloudError = (value: unknown): boolean => value instanceof CloudSessionCancelledError
    || (typeof value === 'object' && value !== null && 'code' in value && (value as { code?: unknown }).code === 'cloud_session_cancelled')
    || (value instanceof Error && value.name === 'CloudSessionCancelledError');

  const isUnreachableCloudError = (value: unknown): boolean => value instanceof CloudUnreachableError
    || (typeof value === 'object' && value !== null && 'code' in value && (value as { code?: unknown }).code === 'cloud_unreachable')
    || (value instanceof Error && value.name === 'CloudUnreachableError');

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
  // Use untrack() inside to prevent settings reads in startStreaming from
  // becoming dependencies of this effect (which would cause re-triggers on
  // settings changes, restarting the stream and appearing to freeze).
  createEffect(() => {
    if (props.isOpen && props.contextPhrase && (explainerMode() === 'phrase' || props.word)) {
      untrack(() => { startStreaming(); });
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
    setErrorKind(null);

    // Snapshot reactive settings values so reads below don't leak into any
    // outer tracking context (the calling createEffect uses untrack, but
    // this is an extra safety measure for the synchronous path).
    const currentSettings = settings;
    const currentWord = props.word;
    const currentContextPhrase = props.contextPhrase;
    const currentMode = explainerMode();

    try {
      // Check cache first
      if (!options.skipCache) {
        const cached = getCachedExplanation(currentWord, currentContextPhrase, currentMode);
        if (cached && hasExplainerGenerationOutput(cached.rawText, cached.toolCalls)) {
          setToolCalls(cached.toolCalls);
          setRawText(cached.rawText);
          setIsLoading(false);
          setIsComplete(true);
          return;
        }
      }

      // Check setup
      if (requiresSetup(currentSettings)) {
        setError(t('mlearn.AI.SetupRequired'));
        setIsLoading(false);
        setIsComplete(true);
        return;
      }

      // Stream via unified provider
      const language = getLanguageDisplayName(currentSettings.language);

      // Low power gate: prompt before local LLM call
      if (currentSettings.llmProvider !== 'cloud') {
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
        currentWord,
        currentContextPhrase,
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

            if (isCancelledCloudError(err)) {
              setError(t('mlearn.CloudReLogin.SignInCanceled'));
              setErrorKind('cancelled');
            } else if (isUnreachableCloudError(err)) {
              setError(t('mlearn.AI.CloudUnreachable'));
              setErrorKind('unreachable');
            } else {
              const normalized = normalizeExplainerErrorMessage(typeof err === 'string' ? err : err instanceof Error ? err.message : null, getExplainerFailureMessage());
              if (isQuotaError(normalized)) {
                setError(t('mlearn.AI.QuotaExceeded'));
                setErrorKind('quota');
              } else {
                setError(normalized);
                setErrorKind('generic');
              }
            }
            setIsLoading(false);
            setIsComplete(true);
          },
        },
        { mode: currentMode },
      );

      if (requestId !== activeStreamRequestId) {
        handle.abort();
        return;
      }

      setAbortFn(() => handle.abort);
    } catch (err) {
      // Safety net: ensure isLoading is always reset even on unexpected errors
      log.error('[ExplainerPopup] startStreaming error:', err);
      if (requestId === activeStreamRequestId) {
        if (isCancelledCloudError(err)) {
          setError(t('mlearn.CloudReLogin.SignInCanceled'));
          setErrorKind('cancelled');
        } else if (isUnreachableCloudError(err)) {
          setError(t('mlearn.AI.CloudUnreachable'));
          setErrorKind('unreachable');
        } else {
          const normalized = normalizeExplainerErrorMessage(typeof err === 'string' ? err : err instanceof Error ? err.message : null, getExplainerFailureMessage());
          if (isQuotaError(normalized)) {
            setError(t('mlearn.AI.QuotaExceeded'));
            setErrorKind('quota');
          } else {
            setError(normalized);
            setErrorKind('generic');
          }
        }
        setIsLoading(false);
        setIsComplete(true);
      }
    }
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
            <Show when={errorKind() === 'cancelled'}>
              <div class="explainer-popup__error-action-row">
                <Button size="sm" variant="primary" onClick={handleRegenerate}>
                  {t('mlearn.CloudReLogin.RetryAction')}
                </Button>
              </div>
            </Show>
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
