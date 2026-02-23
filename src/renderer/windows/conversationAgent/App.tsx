/**
 * Conversation Agent Window App Component
 * AI-powered language tutor with tokenized chat, tool calling, and speech I/O
 */

import { Component, Show, Index, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { WindowWrapper, useSettings, useLanguage, useLocalization } from '../../context';
import { useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
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
  formatKeybindDisplay, Tag,
  ChatIcon,
  EditIcon,
  TrashIcon,
} from '../../components/common';
import type { TabItem, SelectOption } from '../../components/common';
import { WordHover } from '../../components/subtitle';
import { useWordHover, useTranslation, useDictionary, getCachedTranslation } from '../../hooks';
import { ChatBubble } from './ChatBubble';
import { SessionContextTab } from './SessionContextTab';
import { VoiceTab } from './VoiceTab';
import { VoiceAftermath } from './VoiceAftermath';

import { createConversationAgent } from '../../services/conversationAgent';
import type { StreamCallbacks } from '../../services/conversationAgent';
import type { ConversationMessage, ConversationAgentContext, Token, ChatWidget, MistakeWidgetData, DictionaryEntry, TranslationEntry, PitchData, VoiceMistake, VoiceSessionAftermath, TutorSessionConfig } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import { isLatinOnly } from '../../../shared/utils/textUtils';
import './ConversationAgent.css';

/**
 * Known tool names used by the conversation agent.
 * Used to detect and hide partial tool call text during streaming.
 */
const TOOL_NAMES = ['correct_mistake', 'create_quiz', 'fetch_url', 'get_media_stats', 'note_mistake'];

/**
 * Strip any trailing partial tool call text from streamed content.
 * During streaming the LLM may output e.g. `correct_mistake({` before
 * the full tool call is complete — we hide it to avoid a jarring UX.
 * Also strips inline markers like `interruptedbyuser`.
 */
function stripPartialToolCall(text: string): string {
  // Strip interruptedbyuser markers
  let cleaned = text.replace(/\s*interruptedbyuser\s*/g, ' ');

  // Check if any tool name appears near the end of the text (last 200 chars)
  const tail = cleaned.slice(-200);
  for (const name of TOOL_NAMES) {
    const idx = tail.lastIndexOf(name);
    if (idx !== -1) {
      // Found a tool name in the tail — strip from that point onward
      const absoluteIdx = cleaned.length - 200 + idx;
      return cleaned.slice(0, absoluteIdx < 0 ? 0 : absoluteIdx).trimEnd();
    }
  }
  return cleaned;
}

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

export const ConversationContent: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { currentLangData, isTranslatable, getLanguageFeatures, getFrequency, getFreqLevelNames, getLevelName } = useLanguage();
  const { t } = useLocalization();
  const flashcardCtx = useFlashcards();

  const [activeTab, setActiveTab] = createSignal<string>('chat');
  const [mediaContext, setMediaContext] = createSignal<ConversationAgentContext | null>(null);
  const [tutorConfig, setTutorConfig] = createSignal<TutorSessionConfig | null>(null);
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
  const [isProcessingToolCall, setIsProcessingToolCall] = createSignal(false);

  // Voice mode state
  const [isVoiceCallActive, setIsVoiceCallActive] = createSignal(false);
  const [voiceMistakes, setVoiceMistakes] = createSignal<VoiceMistake[]>([]);
  const [voiceSessionStart, setVoiceSessionStart] = createSignal<number>(0);
  const [voiceAftermath, setVoiceAftermath] = createSignal<VoiceSessionAftermath | null>(null);

  // Level adaptation state
  const [targetLevel, setTargetLevel] = createSignal<number | null>(null);

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
    { id: 'voice', label: t('mlearn.ConversationAgent.Tab.Voice') },
    { id: 'stats', label: tutorConfig() ? t('mlearn.ConversationAgent.Tab.Context') : t('mlearn.ConversationAgent.Tab.Stats') },
  ];

  // Initialize agent
  const agent = createConversationAgent({
    getSettings: () => settings,
    getLanguage: () => settings.language || 'ja',
    getLanguageName: () => langName(),
    getMediaContext: () => mediaContext(),
    getSceneContext: () => sceneContext(),
    getTutorConfig: () => tutorConfig(),
    flashcardCtx,
    getFrequency,
    getTargetLevel: () => targetLevel(),
    getLevelName,
    isVoiceMode: () => activeTab() === 'voice' && isVoiceCallActive(),
    onVoiceMistake: (mistake: VoiceMistake) => {
      setVoiceMistakes((prev) => [...prev, mistake]);
      // Lower ease of the word in flashcard context
      flashcardCtx.trackGrammarFailed(mistake.word);
    },
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
          const connected = await getBridge().llm.ollamaCheck();
          setIsConnected(connected ?? false);
        } else {
          const status = await getBridge().llm.llmCheckModel();
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
    const bridge = getBridge();

    const cleanupStatus = bridge.llm.onLLMModelStatus((status: { downloaded: boolean }) => {
      if (settings.llmProvider !== 'ollama') {
        setIsConnected(status.downloaded);
      }
    });

    onCleanup(cleanupStatus);
  });

  // Retrieve media context passed from the parent window
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext((ctx) => {
      if (ctx) {
        const rawCtx = ctx as Record<string, unknown>;
        if (rawCtx.initialTab === 'stats') {
          setActiveTab('stats');
        }
        if (rawCtx.mediaHash) {
          setMediaContext(ctx as unknown as ConversationAgentContext);
        }
        if (rawCtx.tutorConfig) {
          const config = rawCtx.tutorConfig as TutorSessionConfig;
          setTutorConfig(config);
          if (config.customInstructions) {
            setSceneContext(config.customInstructions);
          }
        }
      }
    });
    bridge.window.getWindowContext('conversation-agent');
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
    const cleanup = getBridge().speech.onSttResult((result: { transcript: string; isFinal: boolean }) => {
      if (result.isFinal) {
        setInputText((prev) => prev + result.transcript);
        setIsRecording(false);
      }
    });
    onCleanup(cleanup);
  });

  // TTS status listener
  onMount(() => {
    const cleanup = getBridge().speech.onTtsStatus((status: { speaking: boolean; progress: number }) => {
      setIsSpeaking(status.speaking);
    });
    onCleanup(cleanup);
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

  /**
   * Build reusable streaming callbacks for agent responses.
   * Handles chunk accumulation, tool calls, completion, and errors.
   */
  const buildStreamCallbacks = (): StreamCallbacks => {
    let streamTokenizeId = 0;
    let streamTokenizeTimer: ReturnType<typeof setTimeout> | null = null;

    return {
      onChunk: (accumulated) => {
        setIsWaiting(false);
        setIsProcessingToolCall(false);
        const visibleContent = stripPartialToolCall(accumulated);

        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          updated[lastIdx] = { ...updated[lastIdx], content: visibleContent };
          return updated;
        });

        if (visibleContent.trim()) {
          // Debounce tokenization during streaming to avoid flooding the backend
          if (streamTokenizeTimer) clearTimeout(streamTokenizeTimer);
          streamTokenizeTimer = setTimeout(() => {
            const tokenizeId = ++streamTokenizeId;
            agent.tokenize(visibleContent).then((tokens) => {
              if (tokenizeId !== streamTokenizeId) return;
              if (tokens.length > 0) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (updated[lastIdx]?.role === 'assistant') {
                    updated[lastIdx] = { ...updated[lastIdx], tokens };
                  }
                  return updated;
                });
              }
            });
          }, 300);
        }
      },
      onToolCall: (widget: ChatWidget) => {
        setIsWaiting(false);
        setIsProcessingToolCall(true);
        if (widget.type === 'mistake') {
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
            return updated;
          });
          return;
        }
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          const existingWidgets = updated[lastIdx].widgets || (updated[lastIdx].widget ? [updated[lastIdx].widget] : []);
          updated[lastIdx] = {
            ...updated[lastIdx],
            widgets: [...existingWidgets, widget],
            widget,
          };
          return updated;
        });
      },
      onDone: (finalContent, tokens, widgets, streamStats) => {
        setIsProcessingToolCall(false);
        const finalWidgets = widgets && widgets.length > 0 ? widgets : undefined;

        if (finalWidgets && finalWidgets.some((widget) => widget.type === 'mistake')) {
          const mistakeWidgets = finalWidgets.filter((widget) => widget.type === 'mistake');
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'user') {
                let corrections = updated[i].corrections;
                for (const mistakeWidget of mistakeWidgets) {
                  const mistakeData = mistakeWidget.data as unknown as MistakeWidgetData;
                  corrections = appendUniqueCorrection(corrections, mistakeData);
                }
                updated[i] = { ...updated[i], corrections };
                break;
              }
            }
            const lastIdx = updated.length - 1;
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: finalContent,
              tokens,
              widgets: finalWidgets,
              widget: finalWidgets[finalWidgets.length - 1],
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
              widgets: finalWidgets || updated[lastIdx].widgets,
              widget: finalWidgets ? finalWidgets[finalWidgets.length - 1] : updated[lastIdx].widget,
              streamStats,
            };
            return updated;
          });
        }
        setIsStreaming(false);
        setIsWaiting(false);

        if (settings.autoSpeak && settings.speechEnabled && finalContent) {
          const langCode = settings.language || 'ja';
          getBridge().speech.ttsSpeak(finalContent, langCode);
        }
      },
      onError: (error) => {
        setIsProcessingToolCall(false);
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
    };
  };

  const sendTextMessage = (text: string) => {
    if (!text || isStreaming()) return;

    // Add user message
    const userMsg: ConversationMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const userMsgIndex = messages().length;
    setMessages((prev) => [...prev, userMsg]);

    // Skip tokenization when a non-Latin language receives Latin-only input
    const shouldTokenizeUser = getLanguageFeatures().usesLatinScript || !isLatinOnly(text);
    if (shouldTokenizeUser) {
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
    }

    // Add placeholder assistant message for streaming
    setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
    setIsStreaming(true);
    setIsWaiting(true);
    setIsProcessingToolCall(false);

    agent.processMessage(text, messages(), buildStreamCallbacks());
  };

  const handleRequestGreeting = () => {
    if (isStreaming() || messages().length > 0) return;

    // Add placeholder assistant message for the greeting
    setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
    setIsStreaming(true);
    setIsWaiting(true);
    setIsProcessingToolCall(false);

    const context = `[Voice call started. The learner is waiting for you to speak. Greet them warmly and start a natural conversation in ${langName()}. Keep it short — 1 to 2 sentences.]`;
    agent.continueWithContext(context, buildStreamCallbacks());
  };

  const handleStartConversation = () => {
    if (isStreaming() || messages().length > 0 || !isConnected()) return;

    // Add placeholder assistant message for the AI-initiated conversation
    setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
    setIsStreaming(true);
    setIsWaiting(true);
    setIsProcessingToolCall(false);

    const context = `[The learner opened the chat. Greet them warmly and start a natural conversation in ${langName()}. Keep it short — 1 to 2 sentences.]`;
    agent.continueWithContext(context, buildStreamCallbacks());
  };

  const handleSend = () => {
    const text = inputText().trim();
    if (!text || isStreaming()) return;

    setInputText('');
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    sendTextMessage(text);
  };

  const handleAbort = () => {
    agent.abortStream();
    setIsStreaming(false);
    setIsWaiting(false);
    setIsProcessingToolCall(false);
  };

  const handleRegenerate = (messageIndex: number) => {
    if (isStreaming()) return;

    const msgs = messages();
    const targetMsg = msgs[messageIndex];
    if (!targetMsg || targetMsg.role !== 'assistant') return;

    // Find the user message that preceded this assistant message
    let userMsgIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        userMsgIndex = i;
        break;
      }
    }
    if (userMsgIndex === -1) return;

    const userText = msgs[userMsgIndex].content;

    // Remove the assistant message to regenerate
    setMessages((prev) => {
      const updated = [...prev];
      updated.splice(messageIndex, 1);
      return updated;
    });

    // Remove the last assistant entry from conversation history so the agent re-generates
    agent.clearHistory();

    // Add placeholder assistant message for streaming
    setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
    setIsStreaming(true);
    setIsWaiting(true);
    setIsProcessingToolCall(false);

    agent.processMessage(userText, messages(), buildStreamCallbacks());
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const normalizeQuizAnswer = (answer: string): string => answer.trim().toLocaleLowerCase();

  const handleQuizAnswer = (messageIndex: number, widgetIndex: number, answer: string) => {
    // Extract quiz data before updating state to determine follow-up action
    const msgs = messages();
    const targetMsg = msgs[messageIndex];
    const targetWidgets = targetMsg?.widgets || (targetMsg?.widget ? [targetMsg.widget] : []);
    const targetWidget = targetWidgets[widgetIndex];

    let quizCorrectAnswer = '';
    let quizIsCorrect = false;

    if (targetWidget && targetWidget.type === 'quiz') {
      const quizData = targetWidget.data as Record<string, unknown>;
      quizCorrectAnswer = String(quizData.correctAnswer ?? '');
      quizIsCorrect = normalizeQuizAnswer(quizCorrectAnswer) === normalizeQuizAnswer(answer);
    }

    setMessages((prev) => {
      const updated = [...prev];
      const msg = { ...updated[messageIndex] };
      const widgets = msg.widgets || (msg.widget ? [msg.widget] : []);
      const widget = widgets[widgetIndex];

      if (widget && widget.type === 'quiz') {
        const quizData = widget.data as Record<string, unknown>;

        const updatedWidget: ChatWidget = {
          ...widget,
          resolved: true,
          data: {
            ...quizData,
            userAnswer: answer,
            isCorrect: quizIsCorrect,
          },
        };

        const updatedWidgets = [...widgets];
        updatedWidgets[widgetIndex] = updatedWidget;

        msg.widgets = updatedWidgets;
        msg.widget = updatedWidgets[updatedWidgets.length - 1];

        if (!quizIsCorrect && quizData.affectedPattern) {
          flashcardCtx.trackGrammarFailed(quizData.affectedPattern as string);
        }
      }
      updated[messageIndex] = msg;
      return updated;
    });

    // Continue agent loop after quiz answer
    if (targetWidget && targetWidget.type === 'quiz' && !isStreaming()) {
      const context = quizIsCorrect
        ? `[The learner answered the quiz correctly: "${answer}"]`
        : `[The learner answered incorrectly: "${answer}". The correct answer was: "${quizCorrectAnswer}"]`;

      setMessages((prev) => [...prev, { role: 'assistant' as const, content: '', timestamp: Date.now() }]);
      setIsStreaming(true);
      setIsWaiting(true);
      setIsProcessingToolCall(false);

      agent.continueWithContext(context, buildStreamCallbacks());
    }
  };

  const toggleRecording = () => {
    if (isRecording()) {
      getBridge().speech.sttStop();
      setIsRecording(false);
    } else {
      const lang = settings.sttLanguage || settings.language || 'ja';
      getBridge().speech.sttStart(lang);
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

  // Level adaptation options — derived from language frequency level names
  const levelOptions = (): SelectOption[] => {
    const names = getFreqLevelNames();
    const options: SelectOption[] = [
      { value: '', label: t('mlearn.ConversationAgent.LevelAdapt.None') },
    ];
    // Levels go from highest number (easiest) to lowest (hardest)
    const levels = Object.keys(names)
      .map(Number)
      .filter((n) => !isNaN(n))
      .sort((a, b) => b - a);
    for (const level of levels) {
      options.push({ value: String(level), label: names[String(level)] });
    }
    return options;
  };

  const hasLevelData = () => getLanguageFeatures().supportsFrequencyLevels;

  const handleLevelChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    setTargetLevel(value ? Number(value) : null);
  };

  /**
   * Check if a message at the given index should be hidden.
   * Any empty assistant bubble that is not currently streaming is hidden.
   */
  const isEmptyToolOnlyBubble = (index: number): boolean => {
    const msgs = messages();
    const msg = msgs[index];
    if (!msg || msg.role !== 'assistant') return false;
    if (msg.content.trim()) return false;

    // Don't hide if this is the latest message and we're still streaming
    const isLatest = index === msgs.length - 1;
    if (isLatest && isStreaming()) return false;

    return true;
  };

  return (
    <div class="conversation-agent">
      {/* Header with integrated tabs */}
      <div class="ca-header">
        <div class="ca-header-left">
          <span class="ca-header-title">{t('mlearn.ConversationAgent.Title')}</span>
          <div class="ca-connection-info">
            <Tag class="ca-provider-label" headless size="sm">
              {providerLabel()}
            </Tag>
            <ConnectionStatus
                status={isCheckingConnection() ? 'loading' : isConnected() ? 'connected' : 'disconnected'}
                showLabel={!isConnected()}
                size="sm"
            />
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
          <IconBtn
            variant="ghost"
            onClick={handleClear}
            icon={<TrashIcon size={14} />}
            aria-label={t('mlearn.ConversationAgent.Clear')}
          />
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
                  icon={<ChatIcon size={24} />}
                  title={t('mlearn.ConversationAgent.Empty.Title')}
                  description={t('mlearn.ConversationAgent.Empty.Hint', { lang: langName() })}
                  action={{
                    label: t('mlearn.ConversationAgent.Empty.StartConversation'),
                    onClick: handleStartConversation,
                    variant: 'primary',
                  }}
                  class="ca-empty"
                />
              }
            >
              <Index each={messages()}>
                {(msg, index) => (
                  <Show when={!isEmptyToolOnlyBubble(index)}>
                    <ChatBubble
                      message={msg()}
                      isStreaming={isStreaming() && index === messages().length - 1 && msg().role === 'assistant'}
                      isWaiting={isWaiting() && index === messages().length - 1 && msg().role === 'assistant'}
                      isProcessingToolCall={isProcessingToolCall() && index === messages().length - 1 && msg().role === 'assistant'}
                      onTokenHover={handleTokenHover}
                      onTokenLeave={handleTokenLeave}
                      triggerMode={currentTriggerMode()}
                      triggerKey={currentKey()}
                      onQuizAnswer={(widgetIndex, answer) => handleQuizAnswer(index, widgetIndex, answer)}
                      onRegenerate={msg().role === 'assistant' ? () => handleRegenerate(index) : undefined}
                    />
                  </Show>
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
                <span class="ca-scene-context-icon"><EditIcon size={14} /></span>
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
                <IconBtn
                  icon={<MicIcon />}
                  variant={isRecording() ? 'danger' : 'ghost'}
                  class={`ca-mic-btn ${isRecording() ? 'recording' : ''}`}
                  onClick={toggleRecording}
                  aria-label={isRecording() ? t('mlearn.ConversationAgent.StopRecording') : t('mlearn.ConversationAgent.StartRecording')}
                />
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
                  <IconBtn
                    icon={<StopIcon />}
                    variant="danger"
                    onClick={handleAbort}
                    aria-label={t('mlearn.ConversationAgent.StopStreaming')}
                  />
                }
              >
                <IconBtn
                  icon={<SendIcon />}
                  variant="primary"
                  onClick={handleSend}
                  disabled={!inputText().trim() || !isConnected()}
                  aria-label={t('mlearn.ConversationAgent.Send')}
                />
              </Show>
            </div>
          </div>
          {/* Status bar with hover trigger selector and level adaptation */}
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
            <Show when={hasLevelData()}>
              <div class="hover-trigger-section">
                <label class="hover-trigger-label">{t('mlearn.ConversationAgent.LevelAdapt.Label')}</label>
                <Select
                    class="hover-trigger-select"
                    options={levelOptions()}
                    value={targetLevel() !== null ? String(targetLevel()) : ''}
                    onChange={handleLevelChange}
                />
              </div>
            </Show>
          </StatusBar>
        </div>

      </TabPanel>

      {/* Voice panel */}
      <TabPanel tabId="voice" activeTab={activeTab()} class="ca-voice-panel">
        <VoiceTab
          messages={messages()}
          isStreaming={isStreaming()}
          onSendMessage={sendTextMessage}
          onRequestGreeting={handleRequestGreeting}
          onAbort={handleAbort}
          onCallStateChange={(active) => {
            setIsVoiceCallActive(active);
            if (active) {
              setVoiceMistakes([]);
              setVoiceSessionStart(Date.now());
              setVoiceAftermath(null);
            } else {
              // Build aftermath when call ends
              const mistakes = voiceMistakes();
              if (mistakes.length > 0 || voiceSessionStart() > 0) {
                setVoiceAftermath({
                  mistakes,
                  duration: Date.now() - voiceSessionStart(),
                  messageCount: messages().filter(m => m.role !== 'system').length,
                });
              }
            }
          }}
          onInterrupted={(spokenText, _interruptedAt) => {
            // Update LLM conversation history to reflect what was actually heard
            agent.markInterrupted(spokenText);

            // Mark the last assistant message as interrupted with only the spoken text
            setMessages((prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === 'assistant') {
                  updated[i] = {
                    ...updated[i],
                    interrupted: true,
                    interruptedAt: spokenText,
                    content: spokenText,
                  };
                  break;
                }
              }
              return updated;
            });
          }}
          onTokenHover={handleTokenHover}
          onTokenLeave={handleTokenLeave}
          triggerMode={currentTriggerMode()}
          triggerKey={currentKey()}
          isConnected={isConnected()}
          language={settings.language || 'ja'}
        />

        {/* Voice session aftermath overlay — scoped inside voice panel */}
        <Show when={voiceAftermath()}>
          {(aftermath) => (
            <VoiceAftermath
              aftermath={aftermath()}
              onDismiss={() => setVoiceAftermath(null)}
            />
          )}
        </Show>
      </TabPanel>

      {/* Stats / Context panel */}
      <TabPanel tabId="stats" activeTab={activeTab()} class="ca-stats-panel">
        <SessionContextTab
          context={mediaContext()}
          tutorConfig={tutorConfig()}
          onTutorConfigChange={setTutorConfig}
        />
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
