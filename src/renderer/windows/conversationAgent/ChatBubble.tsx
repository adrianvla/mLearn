/**
 * ChatBubble Component
 * Renders a single message with tokenized text, widgets, and timestamps
 */

import { Component, Show, For, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import { useSettings, useLanguage, useLocalization } from '../../context';
import { Btn, Input, Spinner } from '../../components';
import type { ConversationMessage, Token, QuizWidgetData, MistakeWidgetData, StreamStats } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';

const LONG_HOVER_DELAY = 500;
const DEBUG_HOVER_DELAY = 600;

interface ChatBubbleProps {
  message: ConversationMessage;
  isStreaming?: boolean;
  /** True when waiting for the request to be sent / before streaming starts */
  isWaiting?: boolean;
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode?: WordHoverTriggerMode;
  triggerKey?: string;
  onQuizAnswer?: (answer: string) => void;
}

export const ChatBubble: Component<ChatBubbleProps> = (props) => {
  const { t } = useLocalization();
  const [showDebugStats, setShowDebugStats] = createSignal(false);
  let debugHoverTimeout: ReturnType<typeof setTimeout> | null = null;

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isAssistantEmpty = () =>
    props.message.role === 'assistant' && !props.message.content;

  const hasCorrections = () =>
    props.message.role === 'user' && props.message.corrections && props.message.corrections.length > 0;

  const hasTokens = () =>
    props.message.tokens && props.message.tokens.length > 0;

  const handleTimeMouseEnter = () => {
    if (!props.message.streamStats) return;
    debugHoverTimeout = setTimeout(() => setShowDebugStats(true), DEBUG_HOVER_DELAY);
  };

  const handleTimeMouseLeave = () => {
    if (debugHoverTimeout) {
      clearTimeout(debugHoverTimeout);
      debugHoverTimeout = null;
    }
    setShowDebugStats(false);
  };

  onCleanup(() => {
    if (debugHoverTimeout) clearTimeout(debugHoverTimeout);
  });

  const formatStats = (stats: StreamStats): string => {
    const parts: string[] = [];
    if (stats.tokensPerSecond > 0) {
      parts.push(t('mlearn.ConversationAgent.Debug.TokensPerSecond', { value: stats.tokensPerSecond.toFixed(1) }));
    }
    parts.push(t('mlearn.ConversationAgent.Debug.TimeToFirstToken', { value: String(stats.timeToFirstToken) }));
    parts.push(t('mlearn.ConversationAgent.Debug.TotalTime', { value: String(stats.totalTime) }));
    return parts.join(' · ');
  };

  return (
    <div class={`chat-bubble ${props.message.role}`}>
      <div class="chat-bubble-content">
        {/* State 1: Waiting for stream to begin (spinner) */}
        <Show when={isAssistantEmpty() && props.isStreaming && props.isWaiting}>
          <Spinner size={16} />
        </Show>
        {/* State 2: Stream started but no text yet (blinking cursor) */}
        <Show when={isAssistantEmpty() && props.isStreaming && !props.isWaiting}>
          <span class="chat-bubble-cursor" />
        </Show>
        {/* State 3: User message with inline corrections — tokenized with correction overlay */}
        <Show when={hasCorrections() && hasTokens()}>
          <CorrectedTokenizedText
            tokens={props.message.tokens!}
            corrections={props.message.corrections!}
            onTokenHover={props.onTokenHover}
            onTokenLeave={props.onTokenLeave}
            triggerMode={props.triggerMode || 'hover'}
            triggerKey={props.triggerKey || 'Shift'}
          />
        </Show>
        {/* State 3b: User message with corrections but no tokens yet */}
        <Show when={hasCorrections() && !hasTokens()}>
          <CorrectedUserText content={props.message.content} corrections={props.message.corrections!} />
        </Show>
        {/* State 4: Tokenized text (any role with tokens, no corrections) */}
        <Show when={!hasCorrections() && hasTokens()}>
          <TokenizedText
            tokens={props.message.tokens!}
            onTokenHover={props.onTokenHover}
            onTokenLeave={props.onTokenLeave}
            triggerMode={props.triggerMode || 'hover'}
            triggerKey={props.triggerKey || 'Shift'}
          />
        </Show>
        {/* State 5: Plain text (streaming content or no tokens) */}
        <Show when={!isAssistantEmpty() && !hasCorrections() && !hasTokens()}>
          <span>{props.message.content}</span>
        </Show>
      </div>

      <Show when={props.message.widget}>
        <div class="chat-widget">
          <Show when={props.message.widget!.type === 'quiz'}>
            <QuizWidget
              data={props.message.widget!.data as unknown as QuizWidgetData}
              resolved={props.message.widget!.resolved}
              onAnswer={props.onQuizAnswer}
            />
          </Show>
        </div>
      </Show>

      <Show when={props.message.role !== 'system'}>
        <div
          class="chat-bubble-time"
          onMouseEnter={handleTimeMouseEnter}
          onMouseLeave={handleTimeMouseLeave}
        >
          <span>{formatTime(props.message.timestamp)}</span>
          <Show when={showDebugStats() && props.message.streamStats}>
            <span class="chat-bubble-debug-stats">
              {formatStats(props.message.streamStats!)}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

// Inline correction renderer for user messages (fallback when tokens haven't loaded)
interface CorrectedUserTextProps {
  content: string;
  corrections: MistakeWidgetData[];
}

const CorrectedUserText: Component<CorrectedUserTextProps> = (props) => {
  /** Build segments of plain text and corrected spans */
  const segments = createMemo(() => {
    const text = props.content;
    const result: Array<{ type: 'text'; value: string } | { type: 'correction'; original: string; correction: string; errorType: string }> = [];

    // Sort corrections by their position in the text (find order)
    const sorted = [...props.corrections].sort((a, b) => {
      const idxA = text.indexOf(a.errorSpan);
      const idxB = text.indexOf(b.errorSpan);
      return idxA - idxB;
    });

    let lastIndex = 0;
    for (const corr of sorted) {
      const idx = text.indexOf(corr.errorSpan, lastIndex);
      if (idx === -1) continue;

      // Text before the correction
      if (idx > lastIndex) {
        result.push({ type: 'text', value: text.slice(lastIndex, idx) });
      }

      result.push({
        type: 'correction',
        original: corr.errorSpan,
        correction: corr.correction,
        errorType: corr.errorType,
      });

      lastIndex = idx + corr.errorSpan.length;
    }

    // Remainder
    if (lastIndex < text.length) {
      result.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return result;
  });

  return (
    <span>
      <For each={segments()}>
        {(seg) => (
          <Show when={seg.type === 'correction'} fallback={<span>{(seg as { value: string }).value}</span>}>
            <span class="chat-correction-group">
              <span class="chat-correction-original">
                {(seg as { original: string }).original}
              </span>
              <span class="chat-correction-replacement">
                {(seg as { correction: string }).correction}
              </span>
            </span>
          </Show>
        )}
      </For>
    </span>
  );
};

// Tokenized text with correction overlays for user messages
interface CorrectedTokenizedTextProps {
  tokens: Token[];
  corrections: MistakeWidgetData[];
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode: WordHoverTriggerMode;
  triggerKey: string;
}

/**
 * Builds a map from character position ranges in the original text to corrections.
 * For each token, checks if it falls within a corrected span.
 */
const CorrectedTokenizedText: Component<CorrectedTokenizedTextProps> = (props) => {
  /** Reconstruct full text from tokens and map each token to its char offset */
  const tokenRanges = createMemo(() => {
    let offset = 0;
    return props.tokens.map((token) => {
      const start = offset;
      const end = offset + token.word.length;
      offset = end;
      return { start, end, token };
    });
  });

  /** Build correction ranges from the reconstructed text */
  const correctionRanges = createMemo(() => {
    const fullText = props.tokens.map((t) => t.word).join('');
    const ranges: Array<{ start: number; end: number; correction: MistakeWidgetData }> = [];

    const sorted = [...props.corrections].sort((a, b) => {
      const idxA = fullText.indexOf(a.errorSpan);
      const idxB = fullText.indexOf(b.errorSpan);
      return idxA - idxB;
    });

    let lastIndex = 0;
    for (const corr of sorted) {
      const idx = fullText.indexOf(corr.errorSpan, lastIndex);
      if (idx === -1) continue;
      ranges.push({ start: idx, end: idx + corr.errorSpan.length, correction: corr });
      lastIndex = idx + corr.errorSpan.length;
    }
    return ranges;
  });

  /** For each token, determine if it's corrected and whether it's the last token of its correction group */
  const tokenAnnotations = createMemo(() => {
    const ranges = tokenRanges();
    const corrections = correctionRanges();

    return ranges.map(({ start, end, token }) => {
      for (const cr of corrections) {
        // Token overlaps with correction range
        if (start >= cr.start && end <= cr.end) {
          const isLastInGroup = end === cr.end;
          return { token, corrected: true, correction: cr.correction, isLastInGroup };
        }
      }
      return { token, corrected: false, correction: null as MistakeWidgetData | null, isLastInGroup: false };
    });
  });

  return (
    <span>
      <For each={tokenAnnotations()}>
        {(ann) => (
          <>
            <Show when={ann.corrected} fallback={
              <Show
                when={ann.token.word && ann.token.word.trim().length > 0 && ann.token.type !== '記号'}
                fallback={<span>{ann.token.word}</span>}
              >
                <ChatToken
                  token={ann.token}
                  onTokenHover={props.onTokenHover}
                  onTokenLeave={props.onTokenLeave}
                  triggerMode={props.triggerMode}
                  triggerKey={props.triggerKey}
                />
              </Show>
            }>
              <span class="chat-correction-original">{ann.token.word}</span>
              <Show when={ann.isLastInGroup && ann.correction}>
                <span class="chat-correction-replacement">
                  {ann.correction!.correction}
                </span>
              </Show>
            </Show>
          </>
        )}
      </For>
    </span>
  );
};

// Tokenized text renderer with hover trigger modes
interface TokenizedTextProps {
  tokens: Token[];
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode: WordHoverTriggerMode;
  triggerKey: string;
}

const TokenizedText: Component<TokenizedTextProps> = (props) => {
  return (
    <span>
      <For each={props.tokens}>
        {(token) => (
          <Show
            when={token.word && token.word.trim().length > 0 && token.type !== '記号'}
            fallback={<span>{token.word}</span>}
          >
            <ChatToken
              token={token}
              onTokenHover={props.onTokenHover}
              onTokenLeave={props.onTokenLeave}
              triggerMode={props.triggerMode}
              triggerKey={props.triggerKey}
            />
          </Show>
        )}
      </For>
    </span>
  );
};

// Individual token with hover trigger mode support (mirrors OcrWord pattern)
interface ChatTokenProps {
  token: Token;
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode: WordHoverTriggerMode;
  triggerKey: string;
}

const ChatToken: Component<ChatTokenProps> = (props) => {
  const { settings } = useSettings();
  const { currentLangData } = useLanguage();
  let wordRef: HTMLSpanElement | undefined;
  let longHoverTimeout: ReturnType<typeof setTimeout> | null = null;
  const [isMouseOver, setIsMouseOver] = createSignal(false);
  const [isKeyHeld, setIsKeyHeld] = createSignal(false);

  const clearLongHoverTimeout = () => {
    if (longHoverTimeout) {
      clearTimeout(longHoverTimeout);
      longHoverTimeout = null;
    }
  };

  const triggerHoverFromElement = () => {
    if (!wordRef) return;
    const rect = wordRef.getBoundingClientRect();
    props.onTokenHover?.(props.token, rect, wordRef);
  };

  const handleMouseEnter = () => {
    setIsMouseOver(true);
    const mode = settings.readerWordHoverTrigger ?? props.triggerMode;

    switch (mode) {
      case 'hover':
        triggerHoverFromElement();
        break;
      case 'long-hover':
        clearLongHoverTimeout();
        longHoverTimeout = setTimeout(() => {
          if (isMouseOver()) triggerHoverFromElement();
        }, LONG_HOVER_DELAY);
        break;
      case 'key-hover':
        if (isKeyHeld()) triggerHoverFromElement();
        break;
    }
  };

  const handleMouseLeave = () => {
    setIsMouseOver(false);
    clearLongHoverTimeout();
    props.onTokenLeave?.();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const mode = settings.readerWordHoverTrigger ?? props.triggerMode;
    if (mode !== 'key-hover') return;
    const targetKey = settings.readerWordHoverKey ?? props.triggerKey;
    if (e.key === targetKey && !isKeyHeld()) {
      setIsKeyHeld(true);
      if (isMouseOver()) triggerHoverFromElement();
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    const mode = settings.readerWordHoverTrigger ?? props.triggerMode;
    if (mode !== 'key-hover') return;
    const targetKey = settings.readerWordHoverKey ?? props.triggerKey;
    if (e.key === targetKey) {
      setIsKeyHeld(false);
    }
  };

  /** Get POS color from language colour_codes (same logic as SubtitleWord) */
  const getTokenColor = createMemo((): string | undefined => {
    if (!settings.do_colour_codes) return undefined;
    const pos = props.token.partOfSpeech ?? props.token.type ?? '';
    if (!pos) return undefined;

    if (settings.colour_codes?.[pos]) return settings.colour_codes[pos];

    const langData = currentLangData();
    if (langData?.colour_codes?.[pos]) return langData.colour_codes[pos];

    return undefined;
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    clearLongHoverTimeout();
  });

  return (
    <span
      ref={wordRef}
      class={`chat-token ${props.token.isKnown === false ? 'unknown' : 'known'}`}
      style={getTokenColor() ? { color: getTokenColor() } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={props.token.actual_word || props.token.word}
    >
      {props.token.word}
    </span>
  );
};

// Quiz widget
interface QuizWidgetProps {
  data: QuizWidgetData;
  resolved?: boolean;
  onAnswer?: (answer: string) => void;
}

const QuizWidget: Component<QuizWidgetProps> = (props) => {
  const { t } = useLocalization();
  const [fillAnswer, setFillAnswer] = createSignal('');

  const handleMCQ = (option: string) => {
    if (props.resolved) return;
    props.onAnswer?.(option);
  };

  const handleFillSubmit = (e: Event) => {
    e.preventDefault();
    if (props.resolved || !fillAnswer().trim()) return;
    props.onAnswer?.(fillAnswer().trim());
  };

  return (
    <div class="quiz-widget">
      <div class="quiz-question">{props.data.question}</div>

      <Show when={props.data.type === 'mcq' && props.data.options}>
        <div class="quiz-options">
          <For each={props.data.options}>
            {(option) => {
              const isCorrectAnswer = () => option === props.data.correctAnswer;
              const isUserAnswer = () => option === props.data.userAnswer;
              const variant = () => {
                if (!props.resolved) return 'default' as const;
                if (isCorrectAnswer()) return 'success' as const;
                if (isUserAnswer() && !props.data.isCorrect) return 'danger' as const;
                return 'default' as const;
              };
              return (
                <Btn
                  class="quiz-option"
                  variant={variant()}
                  size="sm"
                  disabled={props.resolved}
                  onClick={() => handleMCQ(option)}
                >
                  {option}
                </Btn>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={props.data.type === 'fill-in'}>
        <form onSubmit={handleFillSubmit}>
          <Input
            type="text"
            size="sm"
            fullWidth
            placeholder={t('mlearn.ConversationAgent.Quiz.FillInPlaceholder')}
            value={props.resolved ? (props.data.userAnswer || '') : fillAnswer()}
            onInput={(e) => setFillAnswer(e.currentTarget.value)}
            disabled={props.resolved}
          />
        </form>
        <Show when={props.resolved}>
          <div class={`quiz-result ${props.data.isCorrect ? 'quiz-result-correct' : 'quiz-result-incorrect'}`}>
            {props.data.isCorrect ? `✓ ${t('mlearn.ConversationAgent.Quiz.Correct')}` : `✗ ${t('mlearn.ConversationAgent.Quiz.IncorrectAnswer', { answer: props.data.correctAnswer })}`}
          </div>
        </Show>
      </Show>
    </div>
  );
};
