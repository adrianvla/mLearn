/**
 * Conversation Agent Window App Component
 * AI-powered language tutor with tokenized chat, tool calling, and speech I/O
 */

import { Component, Show, Index, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { WindowWrapper, useSettings, useLanguage, useLocalization } from '../../context';
import { useFlashcards } from '../../context';
import {
  IconBtn,
  TabContainer,
  TabPanel,
  AlertBanner,
  EmptyState,
  ConnectionStatus,
  StatusBar,
  Textarea,
  Select,
  Label,
  formatKeybindDisplay,
} from '../../components/common';
import type { TabItem, SelectOption } from '../../components/common';
import { WordHover } from '../../components/subtitle';
import { useWordHover, useTranslation, useDictionary, getCachedTranslation } from '../../hooks';
import { ChatBubble } from './ChatBubble';
import { MediaStatsTab } from './MediaStatsTab';

import { createConversationAgent } from '../../services/conversationAgent';
import type { ConversationMessage, ConversationAgentContext, Token, ChatWidget, MistakeWidgetData, DictionaryEntry, TranslationEntry, PitchData } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import './ConversationAgent.css';

// Send icon SVG
const SendIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

// Stop icon SVG (for aborting stream)
const StopIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

// Mic icon SVG
const MicIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path d="M19 10v2a7 7 0 01-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const ConversationContent: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { currentLangData, isTranslatable } = useLanguage();
  const { t } = useLocalization();
  const flashcardCtx = useFlashcards();

  const [activeTab, setActiveTab] = createSignal<string>('chat');
  const [mediaContext, setMediaContext] = createSignal<ConversationAgentContext | null>(null);
  const [messages, setMessages] = createSignal<ConversationMessage[]>([]);
  const [inputText, setInputText] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [isWaiting, setIsWaiting] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [isCheckingConnection, setIsCheckingConnection] = createSignal(true);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isSpeaking, setIsSpeaking] = createSignal(false);
  const [sceneContext, setSceneContext] = createSignal('');
  const [showSceneContext, setShowSceneContext] = createSignal(false);
  const [showBanner, setShowBanner] = createSignal(true);

  // Word hover state
  const { hoverData, isVisible, showHover, hideHover, cancelHide } = useWordHover();
  const { translateWord } = useTranslation({ immediate: true });
  const { lookup } = useDictionary();
  const [translationData, setTranslationData] = createSignal<{ data?: (TranslationEntry | PitchData | null | undefined)[] } | null>(null);
  const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [isLoadingDict, setIsLoadingDict] = createSignal(false);
  let hoverRequestId = 0;

  let messagesRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  const langName = () => {
    const languageCode = settings.language || currentLangData()?.name || '';
    const localizedKey = `mlearn.Languages.${languageCode}`;
    const localized = t(localizedKey);

    if (localized !== localizedKey) {
      return localized;
    }

    return currentLangData()?.name_translated || currentLangData()?.name || languageCode;
  };

  const providerLabel = () => (
    settings.llmProvider === 'ollama'
      ? t('mlearn.AI.Settings.Provider.Ollama')
      : t('mlearn.AI.Settings.Provider.Builtin')
  );

  const topTabs = (): TabItem[] => [
    { id: 'chat', label: t('mlearn.ConversationAgent.Tab.Chat') },
    { id: 'stats', label: t('mlearn.ConversationAgent.Tab.Stats') },
  ];

  // Initialize agent
  const agent = createConversationAgent({
    getSettings: () => settings,
    getLanguage: () => settings.language || 'ja',
    getLanguageName: () => langName(),
    getMediaContext: () => mediaContext(),
    getSceneContext: () => sceneContext(),
    flashcardCtx,
  });

  // Check LLM availability reactively when provider/config changes
  createEffect(() => {
    // Track reactive dependencies so the effect re-runs on change
    const provider = settings.llmProvider;
    void settings.ollamaUrl;
    void settings.ollamaModel;
    void settings.llmConfigured;

    setIsCheckingConnection(true);

    (async () => {
      try {
        if (provider === 'ollama') {
          const connected = await window.mLearnIPC?.ollamaCheck();
          setIsConnected(connected ?? false);
        } else {
          const status = await window.mLearnIPC?.llmCheckModel();
          setIsConnected(status?.downloaded ?? false);
        }
      } catch {
        setIsConnected(false);
      } finally {
        setIsCheckingConnection(false);
      }
    })();
  });

  // Listen for model status changes (e.g., download completes)
  onMount(() => {
    const ipc = window.mLearnIPC;
    if (!ipc) return;

    const cleanupStatus = ipc.onLLMModelStatus?.((status: { downloaded: boolean }) => {
      if (settings.llmProvider !== 'ollama') {
        setIsConnected(status.downloaded);
      }
    });

    if (cleanupStatus) onCleanup(cleanupStatus);
  });

  // Retrieve media context passed from the parent window
  onMount(() => {
    const cleanup = window.mLearnIPC?.onWindowContext((ctx) => {
      if (ctx) {
        const rawCtx = ctx as Record<string, unknown>;
        if (rawCtx.initialTab === 'stats') {
          setActiveTab('stats');
        }
        if (rawCtx.mediaHash) {
          setMediaContext(ctx as unknown as ConversationAgentContext);
        }
      }
    });
    window.mLearnIPC?.getWindowContext('conversation-agent');
    if (cleanup) onCleanup(cleanup);
  });

  // Auto-scroll when messages change
  createEffect(() => {
    messages();
    requestAnimationFrame(() => {
      if (messagesRef) {
        messagesRef.scrollTop = messagesRef.scrollHeight;
      }
    });
  });

  // STT result listener
  onMount(() => {
    const cleanup = window.mLearnIPC?.onSttResult((result: { transcript: string; isFinal: boolean }) => {
      if (result.isFinal) {
        setInputText((prev) => prev + result.transcript);
        setIsRecording(false);
      }
    });
    if (cleanup) onCleanup(cleanup);
  });

  // TTS status listener
  onMount(() => {
    const cleanup = window.mLearnIPC?.onTtsStatus((status: { speaking: boolean; progress: number }) => {
      setIsSpeaking(status.speaking);
    });
    if (cleanup) onCleanup(cleanup);
  });

  // Auto-resize textarea
  const handleTextareaInput = (e: InputEvent) => {
    const target = e.currentTarget as HTMLTextAreaElement;
    setInputText(target.value);
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  // Word hover handler for chat tokens
  const handleTokenHover = async (token: Token, rect: DOMRect, el: HTMLElement) => {
    const pos = token.type || '';
    if (!isTranslatable(pos)) return;

    const lookupWord = token.actual_word || token.word;
    const requestId = ++hoverRequestId;

    // Show immediately with cached data if available
    const cached = getCachedTranslation(lookupWord);
    setTranslationData(cached ? { data: cached.data as (TranslationEntry | PitchData | null | undefined)[] } : null);
    setDictionaryEntries([]);
    setIsLoadingDict(true);

    showHover({
      word: lookupWord,
      token,
      translation: null,
      position: { x: rect.left + rect.width / 2, y: rect.top },
      anchorRect: rect,
      element: el,
    });

    // Fetch translation
    if (!cached) {
      try {
        const result = await translateWord(lookupWord);
        if (requestId !== hoverRequestId) return;
        if (result) {
          setTranslationData({ data: result.data as (TranslationEntry | PitchData | null | undefined)[] });
        }
      } catch {
        // Ignore translation errors
      }
    }

    // Fetch dictionary entries
    try {
      const entries = await lookup(lookupWord, token.reading);
      if (requestId !== hoverRequestId) return;
      setDictionaryEntries(entries);
    } catch {
      // Ignore dictionary errors
    }
    if (requestId === hoverRequestId) {
      setIsLoadingDict(false);
    }
  };

  const handleTokenLeave = () => {
    hideHover();
  };

  const isSameCorrection = (a: MistakeWidgetData, b: MistakeWidgetData): boolean => (
    a.errorSpan === b.errorSpan
    && a.correction === b.correction
    && a.errorType === b.errorType
    && a.contextBefore === b.contextBefore
    && a.contextAfter === b.contextAfter
    && a.affectedPattern === b.affectedPattern
  );

  const appendUniqueCorrection = (
    existing: MistakeWidgetData[] | undefined,
    incoming: MistakeWidgetData,
  ): MistakeWidgetData[] => {
    const corrections = existing || [];
    if (corrections.some((c) => isSameCorrection(c, incoming))) {
      return corrections;
    }
    return [...corrections, incoming];
  };

  const handleSend = () => {
    const text = inputText().trim();
    if (!text || isStreaming()) return;

    setInputText('');
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    // Add user message
    const userMsg: ConversationMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const userMsgIndex = messages().length;
    setMessages((prev) => [...prev, userMsg]);

    // Tokenize user message asynchronously
    agent.tokenize(text).then((tokens) => {
      if (tokens.length > 0) {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[userMsgIndex] && updated[userMsgIndex].role === 'user') {
            updated[userMsgIndex] = { ...updated[userMsgIndex], tokens };
          }
          return updated;
        });
      }
    });

    // Add placeholder assistant message for streaming
    const streamingMsg: ConversationMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, streamingMsg]);
    setIsStreaming(true);
    setIsWaiting(true);

    agent.processMessage(text, messages(), {
      onChunk: (accumulated) => {
        setIsWaiting(false);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = { ...updated[lastIdx], content: accumulated };
          return updated;
        });
      },
      onToolCall: (widget: ChatWidget) => {
        setIsWaiting(false);
        // For mistake corrections, apply inline on the user's last message
        if (widget.type === 'mistake') {
          const mistakeData = widget.data as unknown as MistakeWidgetData;
          setMessages((prev) => {
            const updated = [...prev];
            // Find the latest user message
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'user') {
                const corrections = appendUniqueCorrection(updated[i].corrections, mistakeData);
                updated[i] = { ...updated[i], corrections };
                break;
              }
            }
            return updated;
          });
          return;
        }
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = { ...updated[lastIdx], widget };
          return updated;
        });
      },
      onDone: (finalContent, tokens, widget, streamStats) => {
        // Handle mistake widgets in onDone as well
        if (widget && widget.type === 'mistake') {
          const mistakeData = widget.data as unknown as MistakeWidgetData;
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'user') {
                const corrections = appendUniqueCorrection(updated[i].corrections, mistakeData);
                updated[i] = { ...updated[i], corrections };
                break;
              }
            }
            const lastIdx = updated.length - 1;
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: finalContent,
              tokens,
              streamStats,
            };
            return updated;
          });
        } else {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: finalContent,
              tokens,
              widget: widget || updated[lastIdx].widget,
              streamStats,
            };
            return updated;
          });
        }
        setIsStreaming(false);
        setIsWaiting(false);

        // Auto-speak response if enabled
        if (settings.autoSpeak && settings.speechEnabled && finalContent) {
          const langCode = settings.language || 'ja';
          window.mLearnIPC?.ttsSpeak(finalContent, langCode);
        }
      },
      onError: (error) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: `Error: ${error}`,
          };
          return updated;
        });
        setIsStreaming(false);
        setIsWaiting(false);
      },
    });
  };

  const handleAbort = () => {
    agent.abortStream();
    setIsStreaming(false);
    setIsWaiting(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuizAnswer = (messageIndex: number, answer: string) => {
    setMessages((prev) => {
      const updated = [...prev];
      const msg = { ...updated[messageIndex] };
      if (msg.widget && msg.widget.type === 'quiz') {
        const quizData = msg.widget.data as Record<string, unknown>;
        const isCorrect = answer === quizData.correctAnswer;
        msg.widget = {
          ...msg.widget,
          resolved: true,
          data: {
            ...quizData,
            userAnswer: answer,
            isCorrect,
          },
        };

        if (!isCorrect && quizData.affectedPattern) {
          flashcardCtx.trackGrammarFailed(quizData.affectedPattern as string);
        }
      }
      updated[messageIndex] = msg;
      return updated;
    });
  };

  const toggleRecording = () => {
    if (isRecording()) {
      window.mLearnIPC?.sttStop();
      setIsRecording(false);
    } else {
      const lang = settings.sttLanguage || settings.language || 'ja';
      window.mLearnIPC?.sttStart(lang);
      setIsRecording(true);
    }
  };

  const handleClear = () => {
    setMessages([]);
    agent.clearHistory();
  };

  // Hover trigger mode controls (same as ReaderStatusBar)
  const currentTriggerMode = () => settings.readerWordHoverTrigger ?? 'hover';
  const currentKey = () => settings.readerWordHoverKey ?? 'Shift';

  const getHoverTriggerLabel = (mode: WordHoverTriggerMode): string => {
    switch (mode) {
      case 'hover': return t('mlearn.ConversationAgent.TriggerHover');
      case 'long-hover': return t('mlearn.ConversationAgent.TriggerLongHover');
      case 'key-hover': return t('mlearn.ConversationAgent.TriggerKeyHover', { key: formatKeybindDisplay(currentKey(), t) });
      default: return mode;
    }
  };

  const triggerOptions = (): SelectOption[] => [
    { value: 'hover', label: getHoverTriggerLabel('hover') },
    { value: 'long-hover', label: getHoverTriggerLabel('long-hover') },
    { value: 'key-hover', label: getHoverTriggerLabel('key-hover') },
  ];

  const handleTriggerModeChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value as WordHoverTriggerMode;
    updateSettings({ readerWordHoverTrigger: value });
  };

  return (
    <div class="conversation-agent">
      {/* Header with integrated tabs */}
      <div class="ca-header">
        <div class="ca-header-left">
          <span class="ca-header-title">{t('mlearn.ConversationAgent.Title')}</span>
          <div class="ca-connection-info">
            <ConnectionStatus
              status={isCheckingConnection() ? 'loading' : isConnected() ? 'connected' : 'disconnected'}
              showLabel={!isConnected()}
              size="sm"
            />
            <Label type="tag" size="xs" variant="default" class="ca-provider-label">
              {providerLabel()}
            </Label>
          </div>
        </div>
        <TabContainer
          tabs={topTabs()}
          activeTab={activeTab()}
          onTabChange={setActiveTab}
          variant="underline"
          size="sm"
          class="ca-header-tabs"
        />
        <div class="ca-header-actions">
          <IconBtn variant="ghost" onClick={handleClear} icon="trash" aria-label={t('mlearn.ConversationAgent.ClearConversation')} />
        </div>
      </div>

      {/* Chat panel */}
      <TabPanel tabId="chat" activeTab={activeTab()}>
        <div class="ca-chat-panel">
          {/* Experimental banner */}
          <Show when={showBanner()}>
            <AlertBanner
              variant="warning"
              message={t('mlearn.ConversationAgent.ExperimentalBanner')}
              size="sm"
              closable
              onClose={() => setShowBanner(false)}
            />
          </Show>

          {/* TTS indicator */}
          <Show when={isSpeaking()}>
            <div class="ca-tts-indicator">
              <div class="ca-tts-bars">
                <div class="ca-tts-bar" />
                <div class="ca-tts-bar" />
                <div class="ca-tts-bar" />
                <div class="ca-tts-bar" />
              </div>
              {t('mlearn.ConversationAgent.Speaking')}
            </div>
          </Show>

          {/* Messages */}
          <div class="ca-messages" ref={messagesRef}>
            <Show
              when={messages().length > 0}
              fallback={
                <EmptyState
                  icon="💬"
                  title={t('mlearn.ConversationAgent.Empty.Title')}
                  description={t('mlearn.ConversationAgent.Empty.Hint', { lang: langName() })}
                  class="ca-empty"
                />
              }
            >
              <Index each={messages()}>
                {(msg, index) => (
                  <ChatBubble
                    message={msg()}
                    isStreaming={isStreaming() && index === messages().length - 1 && msg().role === 'assistant'}
                    isWaiting={isWaiting() && index === messages().length - 1 && msg().role === 'assistant'}
                    onTokenHover={handleTokenHover}
                    onTokenLeave={handleTokenLeave}
                    triggerMode={currentTriggerMode()}
                    triggerKey={currentKey()}
                    onQuizAnswer={(answer) => handleQuizAnswer(index, answer)}
                  />
                )}
              </Index>
            </Show>
          </div>

          {/* Word Hover Popup */}
          <Show when={hoverData() && hoverData()!.token}>
            <WordHover
              token={hoverData()!.token!}
              word={hoverData()!.word}
              position={hoverData()!.position}
              anchorRect={hoverData()!.anchorRect}
              dictionaryEntries={dictionaryEntries()}
              translationData={translationData() || undefined}
              isLoading={isLoadingDict()}
              visible={isVisible()}
              onMouseEnter={cancelHide}
              onMouseLeave={hideHover}
              onClose={hideHover}
            />
          </Show>

          {/* Input */}
          <div class="ca-input-area">
            {/* Scene context toggle + textarea */}
            <div class="ca-scene-context-section">
              <button
                class={`ca-scene-context-toggle ${showSceneContext() ? 'active' : ''}`}
                onClick={() => setShowSceneContext(!showSceneContext())}
              >
                <span class="ca-scene-context-icon">📝</span>
                {t('mlearn.ConversationAgent.SceneContext')}
                <Show when={sceneContext().trim()}>
                  <span class="ca-scene-context-badge" />
                </Show>
              </button>
              <Show when={showSceneContext()}>
                <Textarea
                  class="ca-scene-context-textarea"
                  placeholder={t('mlearn.ConversationAgent.SceneContextPlaceholder')}
                  value={sceneContext()}
                  onInput={(e) => setSceneContext(e.currentTarget.value)}
                  rows={3}
                  resize="vertical"
                  ghost
                />
              </Show>
            </div>

            <div class="ca-input-row">
              <Show when={settings.speechEnabled}>
                <button
                  class={`ca-mic-btn ${isRecording() ? 'recording' : ''}`}
                  onClick={toggleRecording}
                  aria-label={isRecording() ? t('mlearn.ConversationAgent.StopRecording') : t('mlearn.ConversationAgent.StartRecording')}
                >
                  <MicIcon />
                </button>
              </Show>

              <div class="ca-input-wrapper">
                <Textarea
                  ref={textareaRef}
                  class="ca-chat-textarea"
                  placeholder={t('mlearn.ConversationAgent.InputPlaceholder', { language: langName() })}
                  value={inputText()}
                  onInput={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  resize="none"
                  disabled={isStreaming() || !isConnected()}
                  fullWidth
                  ghost
                />
              </div>

              <Show
                when={!isStreaming()}
                fallback={
                  <button
                    class="ca-send-btn ca-stop-btn"
                    onClick={handleAbort}
                    aria-label={t('mlearn.ConversationAgent.StopStreaming')}
                  >
                    <StopIcon />
                  </button>
                }
              >
                <button
                  class="ca-send-btn"
                  onClick={handleSend}
                  disabled={!inputText().trim() || !isConnected()}
                  aria-label={t('mlearn.ConversationAgent.Send')}
                >
                  <SendIcon />
                </button>
              </Show>
            </div>
          </div>

          {/* Status bar with hover trigger selector */}
          <StatusBar>
            <div class="hover-trigger-section">
              <label class="hover-trigger-label">{t('mlearn.ConversationAgent.ShowTooltipOn')}</label>
              <Select
                class="hover-trigger-select"
                options={triggerOptions()}
                value={currentTriggerMode()}
                onChange={handleTriggerModeChange}
              />
            </div>
          </StatusBar>
        </div>
      </TabPanel>

      {/* Stats panel */}
      <TabPanel tabId="stats" activeTab={activeTab()}>
        <MediaStatsTab context={mediaContext()} />
      </TabPanel>


    </div>
  );
};

export const ConversationAgentApp: Component = () => {
  return (
    <WindowWrapper showDragRegion={false}>
      <ConversationContent />
    </WindowWrapper>
  );
};
