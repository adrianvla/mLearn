/**
 * Conversation Agent Window App Component
 * AI-powered language tutor with tokenized chat, tool calling, and speech I/O
 */

import { Component, Show, Index, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { WindowWrapper, useSettings, useLanguage, useLocalization, useLowPowerGate } from '../../context';
import { useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { CloudLLMAdapter } from '../../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../../shared/backends';
import { getFrequencyLevelLabel, shouldTokenizeTextForLanguage, sortFrequencyLevelsForDisplay } from '../../../shared/languageFeatures';
import { getTokenLookupWord } from '../../utils/wordForms';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import {
  CloudSessionCancelledError,
  CloudUnreachableError,
  ensureCloudAccessToken,
  handleCloudSessionError,
} from '../../services/cloudSessionManager';
import {
  loadAgents,
  addAgent,
  updateAgent,
  deleteAgent,
  loadActiveAgentId,
  saveActiveAgentId,
  migrateIfNeeded,
  loadAllMemories,
  filterMemories,
  addAgentMemory,
  removeAgentMemory,
  clearAgentMemories,
  generateAgentId,
} from '../../services/agentConfigService';
import {
  Btn,
  IconBtn,
  Modal,
  TabContainer,
  TabPanel,
  EmptyState,
  ConnectionStatus,
  StatusBar,
  Textarea,
  Select,
  ToggleSwitch,
  formatKeybindDisplay, Tag,
  ChatIcon,
  TrashIcon,
  BatteryLowIcon,
} from '../../components/common';
import type { TabItem, SelectOption } from '../../components/common';
import { WordHover } from '../../components/subtitle';
import { ExplainerPopup } from '../../components/subtitle/ExplainerPopup';
import { useWordHover, useTranslation, useDictionary, getCachedTranslation } from '../../hooks';
import { ChatBubble } from './ChatBubble';
import { SessionContextTab } from './SessionContextTab';
import { VoiceTab } from './VoiceTab';
import { VoiceAftermath } from './VoiceAftermath';
import { AgentSetupModal } from './AgentSetupModal';
import { AgeVerificationModal } from './AgeVerificationModal';
import { AgentListPanel } from './AgentListPanel';
import { CommandPalette } from './CommandPalette';
import type { SlashCommand } from './CommandPalette';
import { ToolMenu } from './ToolMenu';
import type { ToolMenuItem } from './ToolMenu';
import { getConversationDisplayLanguageName, getConversationPromptLanguageName } from './languageNames';
import { ConversationHistoryPanel } from './ConversationHistoryPanel';
import {
  loadSessions,
  updateSession,
  deleteSession,
  deleteAllSessions,
  generateSessionId,
} from '../../services/conversationHistoryService';
import type { ConversationSession } from '../../../shared/types';
import { HistoryIcon } from '../../components/common/Misc/Icons';

import { createConversationAgent, type ConversationCompactionResult } from '../../services/conversationAgent';
import { createCheckerAgent } from '../../services/checkerAgent';
import type { StreamCallbacks } from '../../services/conversationAgent';
import type { ConversationMessage, ConversationAgentContext, Token, ChatWidget, MistakeWidgetData, ConversationSafetyFlag, DictionaryEntry, TranslationResponse, VoiceMistake, VoiceSessionAftermath, TutorSessionConfig, AgentConfig, AgentMemoryEntry } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import { getConversationErrorMessage } from './errorUtils';
import { canRegenerateAssistantMessage, getLatestAssistantMessageIndex, isStreamingAssistantBubble, shouldHideAssistantBubble } from './messageState';
import './ConversationAgent.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.conversationAgent.app");
const AUTO_COMPACTION_MIN_HISTORY_MESSAGES = 16;

/**
 * Known tool names used by the conversation agent.
 * Used to detect and hide partial tool call text during streaming.
 */
const TOOL_NAMES = ['correct_mistake', 'create_quiz', 'fetch_url', 'get_media_stats', 'note_mistake', 'recall_backstory', 'save_memory', 'search_wikipedia', 'search_fandom'];

function isSameCorrection(a: MistakeWidgetData, b: MistakeWidgetData): boolean {
  return (
    a.errorSpan === b.errorSpan
    && a.correction === b.correction
    && a.errorType === b.errorType
    && a.contextBefore === b.contextBefore
    && a.contextAfter === b.contextAfter
    && a.affectedPattern === b.affectedPattern
    && a.source === b.source
  );
}

function appendUniqueCorrection(
  existing: MistakeWidgetData[] | undefined,
  incoming: MistakeWidgetData,
): MistakeWidgetData[] {
  const corrections = existing || [];
  if (corrections.some((c) => isSameCorrection(c, incoming))) {
    return corrections;
  }
  return [...corrections, incoming];
}

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
  const { settings, updateSettings, openCloudReLoginModal } = useSettings();
  const {
    currentLangData,
    isTokenTranslatable,
    getLanguageFeatures,
    getFrequency,
    getFreqLevelNames,
    getLevelName,
    getCanonicalForm,
    getWordVariants,
    getReadingVariants,
  } = useLanguage();
  const { t } = useLocalization();
  const flashcardCtx = useFlashcards();
  const { isActive: isLowPowerActive, requestAccess: requestLlmAccess } = useLowPowerGate();
  const speakAssistantText = (text: string) => {
    const ttsRuntime = currentLangData()?.runtime?.tts;
    getBridge().speech.ttsSpeak(text, settings.language, {
      speechSynthesisLang: ttsRuntime?.webSpeechLang,
      speechSynthesisVoice: ttsRuntime?.webSpeechVoice,
    });
  };
  const isCloudSessionCancelled = (error: unknown): boolean => error instanceof CloudSessionCancelledError
    || (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'cloud_session_cancelled');
  const isCloudUnreachable = (error: unknown): boolean => error instanceof CloudUnreachableError
    || (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'cloud_unreachable');
  const isValidVoiceMistake = (mistake: VoiceMistake): boolean => {
    const word = mistake.word.trim();
    const context = mistake.context.trim();
    const correction = mistake.correction.trim();
    return Boolean(word && context && correction && context.includes(word));
  };

  const [activeTab, setActiveTab] = createSignal<string>('chat');
  const [mediaContext, setMediaContext] = createSignal<ConversationAgentContext | null>(null);
  const [tutorConfig, setTutorConfig] = createSignal<TutorSessionConfig | null>(null);
  const [messages, setMessages] = createSignal<ConversationMessage[]>([]);
  const [inputText, setInputText] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [isCompactingContext, setIsCompactingContext] = createSignal(false);
  const [streamingMessageIndex, setStreamingMessageIndex] = createSignal<number | null>(null);
  let queuedVoiceMessagesDuringCompaction: Array<{ text: string; userMsgIndex: number }> = [];

  // Command palette state
  const [showCommandPalette, setShowCommandPalette] = createSignal(false);
  const [commandSelectedIndex, setCommandSelectedIndex] = createSignal(0);
  const [isWaiting, setIsWaiting] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [isCheckingConnection, setIsCheckingConnection] = createSignal(true);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isSpeaking, setIsSpeaking] = createSignal(false);
  const [sceneContext, setSceneContext] = createSignal('');

  const [showSplash, setShowSplash] = createSignal(true);
  const [showDisclaimer, setShowDisclaimer] = createSignal(true);
  const canOpenCloudSignIn = () => (
    settings.llmProvider === 'cloud'
    && !isCheckingConnection()
    && !isConnected()
  );

  // Knowledge info toggle — controls whether failed words/grammar are included in the LLM context
  const [includeKnowledgeInfo, setIncludeKnowledgeInfo] = createSignal(true);

  // Disabled tools — user-toggled tool restrictions
  const [disabledTools, setDisabledTools] = createSignal<Set<string>>(new Set());

  // Voice mode state
  const [isVoiceCallActive, setIsVoiceCallActive] = createSignal(false);
  const [voiceMistakes, setVoiceMistakes] = createSignal<VoiceMistake[]>([]);
  const [voiceSessionStart, setVoiceSessionStart] = createSignal<number>(0);
  const [voiceAftermath, setVoiceAftermath] = createSignal<VoiceSessionAftermath | null>(null);

  // Level adaptation state
  const [targetLevel, setTargetLevel] = createSignal<number | null>(null);

  // Agent setup & memory state
  const [agents, setAgents] = createSignal<AgentConfig[]>([]);
  const [activeAgentId, setActiveAgentId] = createSignal<string | null>(null);
  const [allMemories, setAllMemories] = createSignal<AgentMemoryEntry[]>([]);
  const [showSetupModal, setShowSetupModal] = createSignal(false);
  const [editingAgent, setEditingAgent] = createSignal<AgentConfig | null>(null);

  const activeAgent = (): AgentConfig | null => {
    const id = activeAgentId();
    if (!id) return null;
    return agents().find((a) => a.id === id) || null;
  };

  const visibleMemories = (): AgentMemoryEntry[] => {
    const id = activeAgentId();
    if (!id) return [];
    return filterMemories(allMemories(), id, settings.agentMemoryShared);
  };

  // Word hover state
  const { hoverData, isVisible, showHover, hideHover, cancelHide } = useWordHover();
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));
  const wordLookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };
  const { translateWord } = useTranslation({
    immediate: true,
    language: settings.language,
    ...wordLookupOptions,
  });
  const { lookup } = useDictionary({ language: settings.language, ...wordLookupOptions });
  const [translationData, setTranslationData] = createSignal<TranslationResponse | null>(null);
  const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [isLoadingDict, setIsLoadingDict] = createSignal(false);
  let hoverRequestId = 0;

  const [sessions, setSessions] = createSignal<ConversationSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = createSignal<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  const [explainerOpen, setExplainerOpen] = createSignal(false);
  const [explainerWord, setExplainerWord] = createSignal('');
  const [explainerContext, setExplainerContext] = createSignal('');
  const [explainerPosition, setExplainerPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });

  let messagesRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  const langName = () => {
    return getConversationDisplayLanguageName(settings.language, currentLangData(), t, settings.uiLanguage);
  };
  const promptLangName = () => getConversationPromptLanguageName(settings.language, currentLangData());

  const providerLabel = () => {
    switch (settings.llmProvider) {
      case 'cloud': return t('mlearn.AI.Settings.Provider.Cloud');
      case 'ollama': return t('mlearn.AI.Settings.Provider.Ollama');
      default: return t('mlearn.AI.Settings.Provider.Builtin');
    }
  };

  const topTabs = (): TabItem[] => [
    { id: 'chat', label: t('mlearn.ConversationAgent.Tab.Chat') },
    { id: 'voice', label: t('mlearn.ConversationAgent.Tab.Voice') },
    { id: 'agents', label: t('mlearn.ConversationAgent.Tab.Agents') },
    { id: 'stats', label: tutorConfig() ? t('mlearn.ConversationAgent.Tab.Context') : t('mlearn.ConversationAgent.Tab.Stats') },
  ];

  // Initialize agent
  const agent = createConversationAgent({
    getSettings: () => settings,
    getLanguage: () => settings.language,
    getLanguageName: () => promptLangName(),
    getLanguageFeatures: () => getLanguageFeatures(),
    getMediaContext: () => mediaContext(),
    getSceneContext: () => sceneContext(),
    getTutorConfig: () => tutorConfig(),
    flashcardCtx,
    getFrequency,
    getTargetLevel: () => targetLevel(),
    getLanguageData: () => currentLangData(),
    getLevelName,
    isVoiceMode: () => activeTab() === 'voice' && isVoiceCallActive(),
    onVoiceMistake: (mistake: VoiceMistake) => {
      if (!isValidVoiceMistake(mistake)) return;
      setVoiceMistakes((prev) => [...prev, mistake]);
      // Lower ease of the word in flashcard context
      flashcardCtx.trackGrammarFailed(mistake.word);
    },
    getAgentConfig: () => activeAgent(),
    getAgentMemories: () => visibleMemories(),
    onMemorySaved: (content: string) => {
      const agentId = activeAgentId();
      if (!agentId) return;
      addAgentMemory(content, agentId, settings.language).then((entry) => {
        setAllMemories((prev) => [...prev, entry]);
      });
    },
    getIncludeKnowledgeInfo: () => includeKnowledgeInfo(),
    getDisabledTools: () => disabledTools(),
  });

  const [isSafetyLockedState, setIsSafetyLockedState] = createSignal(agent.isSafetyLocked());

  // Checker agent for split-checker mode
  const checkerAgent = createCheckerAgent();
  let checkerTaskQueue: Promise<void> = Promise.resolve();
  let checkerTaskCount = 0;

  const enqueueCheckerTask = (task: () => Promise<void>) => {
    checkerTaskCount += 1;
    checkerTaskQueue = checkerTaskQueue
      .catch((error) => {
        log.error("error", error);
      })
      .then(task)
      .catch((error) => {
        log.error("error", error);
      })
      .finally(() => {
        checkerTaskCount = Math.max(0, checkerTaskCount - 1);
        if (checkerTaskCount === 0) {
          maybeCompactConversationContext();
        }
      });

    return checkerTaskQueue;
  };

  const startAssistantStream = (assistantMessageIndex: number) => {
    setStreamingMessageIndex(assistantMessageIndex);
    setIsStreaming(true);
    setIsWaiting(true);
  };

  const clearAssistantStreamState = () => {
    setStreamingMessageIndex(null);
    setIsStreaming(false);
    setIsWaiting(false);
  };

  const runAssistantSafetyScan = (
    assistantText: string,
    assistantMsgIndex: number,
  ) => {
    if (!assistantText.trim()) {
      return;
    }

    void enqueueCheckerTask(async () => {
      try {
        const result = await checkerAgent.checkMessage(assistantText, promptLangName(), undefined, {
          speakerRole: 'assistant',
          includeCorrections: false,
          languageFeatures: getLanguageFeatures(),
        });

        if (result.error === 'quota') {
          agent.lockSafety();
          setIsSafetyLockedState(true);
          setMessages((prev) => {
            const updated = [...prev];
            if (!updated[assistantMsgIndex] || updated[assistantMsgIndex].role !== 'assistant') {
              return updated;
            }

            updated[assistantMsgIndex] = {
              ...updated[assistantMsgIndex],
              content: t('mlearn.ConversationAgent.Safety.ScreeningQuotaExceeded'),
              tokens: undefined,
              widget: undefined,
              widgets: undefined,
            };
            return updated;
          });
          return;
        }

        if (result.safety) {
          agent.lockSafety();
          setIsSafetyLockedState(true);
          setMessages((prev) => {
            const updated = [...prev];
            if (!updated[assistantMsgIndex] || updated[assistantMsgIndex].role !== 'assistant') {
              return updated;
            }

            updated[assistantMsgIndex] = {
              ...updated[assistantMsgIndex],
              content: t('mlearn.ConversationAgent.Safety.AssistantReplacement'),
              tokens: undefined,
              widget: undefined,
              widgets: undefined,
              safety: result.safety ?? undefined,
            };
            return updated;
          });
          return;
        }

        const currentMessage = messages()[assistantMsgIndex];
        if (
          settings.autoSpeak
          && settings.speechEnabled
          && currentMessage
          && currentMessage.role === 'assistant'
          && currentMessage.content === assistantText
        ) {
          speakAssistantText(assistantText);
        }
      } catch (error) {
        log.error("error", error);
        const currentMessage = messages()[assistantMsgIndex];
        if (
          settings.autoSpeak
          && settings.speechEnabled
          && currentMessage
          && currentMessage.role === 'assistant'
          && currentMessage.content === assistantText
        ) {
          speakAssistantText(assistantText);
        }
      }
    });
  };

  const getUserSafetyResponse = (severity: 'concern' | 'urgent') => (
    severity === 'urgent'
      ? t('mlearn.ConversationAgent.Safety.UserUrgentResponse')
      : t('mlearn.ConversationAgent.Safety.UserConcernResponse')
  );

  const applyUserSafetyResponse = (
    userMsgIndex: number,
    assistantMsgIndex: number,
    safety: ConversationSafetyFlag,
  ) => {
    agent.lockSafety();
    setIsSafetyLockedState(true);
    setMessages((prev) => {
      const updated = [...prev];
      if (updated[userMsgIndex]?.role === 'user') {
        updated[userMsgIndex] = {
          ...updated[userMsgIndex],
          safety,
        };
      }

      if (updated[assistantMsgIndex]?.role === 'assistant') {
        updated[assistantMsgIndex] = {
          ...updated[assistantMsgIndex],
          content: getUserSafetyResponse(safety.severity),
          tokens: undefined,
          widget: undefined,
          widgets: undefined,
          streamStats: undefined,
        };
      }

      return updated;
    });
  };

  const applyQuotaSafetyResponse = (userMsgIndex: number, assistantMsgIndex: number) => {
    agent.lockSafety();
    setIsSafetyLockedState(true);
    setMessages((prev) => {
      const updated = [...prev];
      if (updated[userMsgIndex]?.role === 'user') {
        updated[userMsgIndex] = {
          ...updated[userMsgIndex],
          safety: undefined,
        };
      }

      if (updated[assistantMsgIndex]?.role === 'assistant') {
        updated[assistantMsgIndex] = {
          ...updated[assistantMsgIndex],
          content: t('mlearn.ConversationAgent.Safety.ScreeningQuotaExceeded'),
          tokens: undefined,
          widget: undefined,
          widgets: undefined,
          streamStats: undefined,
        };
      }

      return updated;
    });
  };

  /**
   * Run the checker agent on user text and apply corrections / safety flags.
   * Called when at least one checker feature (mistake or safety) is enabled.
   */
  const runCheckerOnMessage = (userText: string, userMsgIndex: number, assistantMsgIndex: number) => {
    const customInstructions = tutorConfig()?.customInstructions || undefined;
    void enqueueCheckerTask(async () => {
      const result = await checkerAgent.checkMessage(userText, promptLangName(), customInstructions, {
        speakerRole: 'user',
        includeCorrections: settings.agentMistakeChecker,
        includeSafety: settings.agentSafetyChecker,
        languageFeatures: getLanguageFeatures(),
      });
      if (result.error === 'quota' && settings.agentSafetyChecker) {
        applyQuotaSafetyResponse(userMsgIndex, assistantMsgIndex);
        return;
      }
      if (result.corrections.length === 0 && !result.safety) {
        return;
      }

      if (result.safety) {
        applyUserSafetyResponse(userMsgIndex, assistantMsgIndex, result.safety);
      }

      setMessages((prev) => {
        const updated = [...prev];
        if (!updated[userMsgIndex] || updated[userMsgIndex].role !== 'user') {
          return updated;
        }

        let corrections = updated[userMsgIndex].corrections || [];
        for (const incoming of result.corrections) {
          if (!corrections.some((c) => isSameCorrection(c, incoming))) {
            corrections = [...corrections, incoming];
          }
        }

        updated[userMsgIndex] = {
          ...updated[userMsgIndex],
          corrections,
          safety: result.safety ?? updated[userMsgIndex].safety,
        };
        return updated;
      });
    });
  };

  // Load agents and memories on mount (with migration from old format)
  onMount(async () => {
    const language = settings.language;
    await migrateIfNeeded(language);
    const loadedAgents = await loadAgents();
    setAgents(loadedAgents);

    const storedActiveId = await loadActiveAgentId();
    if (storedActiveId && loadedAgents.some((a) => a.id === storedActiveId)) {
      setActiveAgentId(storedActiveId);
    } else if (loadedAgents.length > 0) {
      setActiveAgentId(loadedAgents[0].id);
      await saveActiveAgentId(loadedAgents[0].id);
    } else {
      // No agents — show setup modal
      setShowSetupModal(true);
    }

    const mems = await loadAllMemories(language);
    setAllMemories(mems);

    const loadedSessions = await loadSessions(language);
    setSessions(loadedSessions);
  });

  const handleSetupComplete = async (config: AgentConfig) => {
    let updatedAgents: AgentConfig[];
    if (config.id) {
      // Edit existing agent
      updatedAgents = await updateAgent(config);
      setAgents(updatedAgents);
    } else {
      // Create new agent
      const newConfig = { ...config, id: generateAgentId() };
      updatedAgents = await addAgent(newConfig);
      setAgents(updatedAgents);
      setActiveAgentId(newConfig.id);
      await saveActiveAgentId(newConfig.id);
    }
    setShowSetupModal(false);
    setEditingAgent(null);

    // Only run greeting + topic generation for newly created agents
    if (!config.id && isConnected() && messages().length === 0) {
      const assistantMessageIndex = messages().length;
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', timestamp: Date.now() },
      ]);
      startAssistantStream(assistantMessageIndex);

      const greetingContext = `[The learner just opened the chat. Greet them warmly and start a natural conversation in ${promptLangName()}. Keep it short — 1 to 2 sentences.]`;
      agent.continueWithContext(greetingContext, buildStreamCallbacks(assistantMessageIndex));
    }
  };

  const handleDeleteAllAgents = async () => {
    // Delete all agents one by one
    const allAgents = agents();
    for (const a of allAgents) {
      await deleteAgent(a.id, settings.language);
    }
    await clearAgentMemories(undefined, settings.language);
    setAgents([]);
    setAllMemories([]);
    setMessages([]);
    clearAssistantStreamState();
    agent.clearHistory();
    setActiveAgentId(null);
    setShowSetupModal(true);
  };

  const handleDeleteMemory = (id: string) => {
    removeAgentMemory(id, settings.language).then(setAllMemories);
  };

  const handleSelectAgent = async (id: string) => {
    setActiveAgentId(id);
    await saveActiveAgentId(id);
    // Clear conversation when switching agents
    setMessages([]);
    agent.clearHistory();
    agent.unlockSafety();
    setIsSafetyLockedState(false);
  };

  const handleCreateAgent = () => {
    setEditingAgent(null);
    setShowSetupModal(true);
  };

  const handleEditAgent = (agentCfg: AgentConfig) => {
    setEditingAgent(agentCfg);
    setShowSetupModal(true);
  };

  const handleDeleteAgent = async (id: string) => {
    const updatedAgents = await deleteAgent(id, settings.language);
    setAgents(updatedAgents);
    setAllMemories((prev) => prev.filter((m) => m.agentId !== id));

    if (activeAgentId() === id) {
      if (updatedAgents.length > 0) {
        setActiveAgentId(updatedAgents[0].id);
        await saveActiveAgentId(updatedAgents[0].id);
      } else {
        setActiveAgentId(null);
      }
      setMessages([]);
      agent.clearHistory();
      agent.unlockSafety();
      setIsSafetyLockedState(false);
    }
  };

  const handleNewSession = () => {
    agent.abortStream();
    clearAssistantStreamState();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    agent.clearHistory();
    agent.unlockSafety();
    setIsSafetyLockedState(false);
    setMessages([]);
    const newId = generateSessionId();
    setCurrentSessionId(newId);
    setSidebarVisible(false);
  };

  const handleLoadSession = async (id: string) => {
    const session = sessions().find((s) => s.id === id);
    if (!session) return;

    agent.abortStream();
    clearAssistantStreamState();
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    agent.loadHistory(session.llmHistory);
    agent.unlockSafety();
    setIsSafetyLockedState(false);
    setMessages(session.messages);
    setCurrentSessionId(id);
    setSidebarVisible(false);
  };

  const handleDeleteSession = async (id: string) => {
    const updated = await deleteSession(id, settings.language);
    setSessions(updated);
    if (currentSessionId() === id) {
      setCurrentSessionId(null);
    }
  };

  const handleDeleteAllSessions = async () => {
    await deleteAllSessions(settings.language);
    setSessions([]);
    setCurrentSessionId(null);
  };

  const saveCurrentSession = () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      const msgs = messages();
      if (msgs.length === 0) return;

      const sessionId = currentSessionId() || generateSessionId();
      if (!currentSessionId()) {
        setCurrentSessionId(sessionId);
      }

      const firstUserMsg = msgs.find((m) => m.role === 'user');
      const title = firstUserMsg?.content.slice(0, 50) || `Session ${new Date().toLocaleDateString()}`;

      const session: ConversationSession = {
        id: sessionId,
        title,
        agentId: activeAgentId(),
        messages: msgs,
        llmHistory: agent.getHistory(),
        createdAt: sessions().find((s) => s.id === sessionId)?.createdAt || Date.now(),
        updatedAt: Date.now(),
        messageCount: msgs.length,
      };

      const updated = await updateSession(session, settings.language);
      setSessions(updated);
    }, 500);
  };

  // Check LLM availability reactively when provider/config changes
  createEffect(() => {
    // Track reactive dependencies so the effect re-runs on change
    const provider = settings.llmProvider;
    void settings.ollamaUrl;
    void settings.ollamaModel;
    void settings.llmConfigured;
    void settings.cloudAuthAccessToken;
    void settings.cloudAuthToken;
    void settings.cloudAuthStatus;
    void settings.cloudApiUrl;
    void settings.overrideCloudEndpointUrl;

    setIsCheckingConnection(true);

    (async () => {
      try {
        if (provider === 'cloud') {
          const accessToken = await ensureCloudAccessToken({ openModalOnExpiry: false });
          if (!accessToken) {
            setIsConnected(false);
            return;
          }

          const cloudApiUrl = resolveCloudApiUrl(settings);
          const adapter = new CloudLLMAdapter(
            cloudApiUrl,
            accessToken,
          );
          const reachable = await adapter.checkAvailability();
          setIsConnected(reachable);
        } else if (provider === 'ollama') {
          const connected = await getBridge().llm.ollamaCheck();
          setIsConnected(connected ?? false);
        } else {
          const status = await getBridge().llm.llmCheckModel();
          setIsConnected(status?.downloaded ?? false);
        }
      } catch (e) {
        log.error("error", e);
        handleCloudSessionError(e, false);
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
      if (settings.llmProvider === 'builtin') {
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

  // Clean up checker agent on unmount
  onCleanup(() => {
    checkerAgent.abort();
  });

  // Slash commands
  const slashCommands = (): SlashCommand[] => [
    { id: 'newtopic', label: t('mlearn.ConversationAgent.Commands.NewTopic'), description: t('mlearn.ConversationAgent.Commands.NewTopicDesc') },
    { id: 'compact', label: t('mlearn.ConversationAgent.Commands.Compact'), description: t('mlearn.ConversationAgent.Commands.CompactDesc') },
  ];

  const filteredCommands = (): SlashCommand[] => {
    const text = inputText().trim();
    if (!text.startsWith('/')) return [];
    const query = text.slice(1).toLowerCase();
    return slashCommands().filter((cmd) => cmd.id.startsWith(query));
  };

  const findExactSlashCommand = (text: string): SlashCommand | undefined => {
    if (!text.startsWith('/')) return undefined;
    const id = text.slice(1).trim().toLowerCase();
    return slashCommands().find((command) => command.id === id);
  };

  const ensureLlmAllowed = async (): Promise<boolean> => {
    if (settings.llmProvider === 'cloud') return true;
    return requestLlmAccess('llm');
  };

  const getCompactionMessage = (result: ConversationCompactionResult): string => {
    if (result.status === 'compacted') {
      return t('mlearn.ConversationAgent.Commands.CompactDone', { count: String(result.compactedMessages) });
    }
    if (result.reason === 'busy') {
      return t('mlearn.ConversationAgent.Commands.CompactBusy');
    }
    if (result.reason === 'empty-summary') {
      return t('mlearn.ConversationAgent.Commands.CompactFailed');
    }
    return t('mlearn.ConversationAgent.Commands.CompactSkipped');
  };

  const executeCommand = async (command: SlashCommand) => {
    if (command.id === 'newtopic') {
      if (isStreaming() || isCompactingContext() || !isConnected() || isSafetyLockedState()) return;
      const allowed = await ensureLlmAllowed();
      if (!allowed) return;

      setInputText('');
      setShowCommandPalette(false);
      setCommandSelectedIndex(0);
      if (textareaRef) textareaRef.style.height = 'auto';

      const assistantMessageIndex = messages().length;
      setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
      startAssistantStream(assistantMessageIndex);

      const hasMessages = messages().length > 1;
      const context = hasMessages
        ? `[The learner wants to change the topic. Smoothly transition to a new, interesting, and creative topic. Pick something engaging and different from what was discussed before. Start naturally with a question or interesting statement in ${promptLangName()}. Keep it concise — 1 to 3 sentences.]`
        : `[The learner wants you to pick a topic. Start a natural conversation about something interesting and creative in ${promptLangName()}. Keep it concise — 1 to 3 sentences.]`;
      agent.continueWithContext(context, buildStreamCallbacks(assistantMessageIndex));
      return;
    }

    if (command.id === 'compact') {
      if (isStreaming() || isCompactingContext() || isSafetyLockedState()) return;
      const allowed = await ensureLlmAllowed();
      if (!allowed) return;

      setIsCompactingContext(true);
      setInputText('');
      setShowCommandPalette(false);
      setCommandSelectedIndex(0);
      if (textareaRef) textareaRef.style.height = 'auto';

      const systemMessageIndex = messages().length;
      setMessages((prev) => [...prev, {
        role: 'system',
        content: t('mlearn.ConversationAgent.Commands.Compacting'),
        timestamp: Date.now(),
      }]);

      try {
        const result = await agent.summarizeHistory();
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[systemMessageIndex]?.role === 'system') {
            updated[systemMessageIndex] = {
              ...updated[systemMessageIndex],
              content: getCompactionMessage(result),
            };
          }
          return updated;
        });
        saveCurrentSession();
      } catch (error) {
        log.error("error", error);
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[systemMessageIndex]?.role === 'system') {
            updated[systemMessageIndex] = {
              ...updated[systemMessageIndex],
              content: t('mlearn.ConversationAgent.Commands.CompactFailed'),
            };
          }
          return updated;
        });
      } finally {
        setIsCompactingContext(false);
        flushQueuedVoiceMessages();
      }
    }
  };

  // Tool menu items — tools the user can toggle
  const toolMenuItems = (): ToolMenuItem[] => {
    const items: ToolMenuItem[] = [
      { id: 'correct_mistake', label: t('mlearn.ConversationAgent.Tools.CorrectMistake') },
      { id: 'create_quiz', label: t('mlearn.ConversationAgent.Tools.CreateQuiz') },
      { id: 'fetch_url', label: t('mlearn.ConversationAgent.Tools.FetchUrl') },
      { id: 'get_media_stats', label: t('mlearn.ConversationAgent.Tools.GetMediaStats') },
      { id: 'search_wikipedia', label: t('mlearn.ConversationAgent.Tools.SearchWikipedia') },
      { id: 'save_memory', label: t('mlearn.ConversationAgent.Tools.SaveMemory') },
    ];
    const agentCfg = activeAgent();
    if (agentCfg?.roleplayFandomUrl) {
      items.push({ id: 'search_fandom', label: t('mlearn.ConversationAgent.Tools.SearchFandom') });
    }
    if (agentCfg?.personality === 'roleplay' && agentCfg.roleplayContext) {
      items.push({ id: 'recall_backstory', label: t('mlearn.ConversationAgent.Tools.RecallBackstory') });
    }
    return items;
  };

  const handleToolToggle = (toolId: string, enabled: boolean) => {
    setDisabledTools((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  // Auto-resize textarea + command palette detection
  const handleTextareaInput = (e: InputEvent) => {
    const target = e.currentTarget as HTMLTextAreaElement;
    setInputText(target.value);
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';

    const text = target.value.trim();
    if (text.startsWith('/')) {
      setShowCommandPalette(true);
      setCommandSelectedIndex(0);
    } else {
      setShowCommandPalette(false);
    }
  };

  // Word hover handler for chat tokens
  const handleTokenHover = async (token: Token, rect: DOMRect, el: HTMLElement) => {
    if (!isTokenTranslatable(token)) return;

    const lookupWord = getTokenLookupWord(token, getLanguageFeatures().tokenizerCapabilities);
    const requestId = ++hoverRequestId;

    // Show immediately with cached data if available
    const cached = getCachedTranslation(lookupWord, settings.language, wordLookupOptions);
    setTranslationData(cached ? { data: cached.data } : null);
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
          setTranslationData({ data: result.data });
        }
      } catch (e) {
        log.error("error", e);
        // Ignore translation errors
      }
    }

    // Fetch dictionary entries
    try {
      const entries = await lookup(lookupWord, token.reading);
      if (requestId !== hoverRequestId) return;
      setDictionaryEntries(entries);
    } catch (e) {
      log.error("error", e);
      // Ignore dictionary errors
    }
    if (requestId === hoverRequestId) {
      setIsLoadingDict(false);
    }
  };

  const handleTokenLeave = () => {
    hideHover();
  };

  const handleOpenExplainer = (word: string, context: string, position: { x: number; y: number }) => {
    setExplainerWord(word);
    setExplainerContext(context);
    setExplainerPosition(position);
    setExplainerOpen(true);
  };

  const handleCloseExplainer = () => {
    setExplainerOpen(false);
  };

  /**
   * Build reusable streaming callbacks for agent responses.
   * Handles chunk accumulation, tool calls, completion, and errors.
   */
  const buildStreamCallbacks = (targetAssistantIndex?: number): StreamCallbacks => {
    let streamTokenizeId = 0;
    let streamTokenizeTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveTargetAssistantIndex = (items: ConversationMessage[]): number => {
      if (
        targetAssistantIndex !== undefined
        && items[targetAssistantIndex]
        && items[targetAssistantIndex].role === 'assistant'
      ) {
        return targetAssistantIndex;
      }

      return getLatestAssistantMessageIndex(items);
    };

    return {
      onChunk: (accumulated) => {
        setIsWaiting(false);
        const visibleContent = stripPartialToolCall(accumulated);

        setMessages((prev) => {
          const updated = [...prev];
          const assistantIndex = resolveTargetAssistantIndex(updated);
          if (assistantIndex < 0) return updated;
          updated[assistantIndex] = { ...updated[assistantIndex], content: visibleContent };
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
                  const assistantIndex = resolveTargetAssistantIndex(updated);
                  if (assistantIndex >= 0 && updated[assistantIndex]?.role === 'assistant') {
                    updated[assistantIndex] = { ...updated[assistantIndex], tokens };
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
          const assistantIndex = resolveTargetAssistantIndex(updated);
          if (assistantIndex < 0) {
            return updated;
          }
          const existingWidgets = updated[assistantIndex].widgets || (updated[assistantIndex].widget ? [updated[assistantIndex].widget] : []);
          updated[assistantIndex] = {
            ...updated[assistantIndex],
            widgets: [...existingWidgets, widget],
            widget,
          };
          return updated;
        });
      },
      onDone: (finalContent, tokens, widgets, streamStats) => {
        const finalWidgets = widgets && widgets.length > 0 ? widgets : undefined;
        const assistantMessageIndex = resolveTargetAssistantIndex(messages());

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
            const targetIndex = resolveTargetAssistantIndex(updated);
            if (targetIndex < 0) return updated;
            updated[targetIndex] = {
              ...updated[targetIndex],
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
            const targetIndex = resolveTargetAssistantIndex(updated);
            if (targetIndex < 0) return updated;
            updated[targetIndex] = {
              ...updated[targetIndex],
              content: finalContent,
              tokens,
              widgets: finalWidgets || updated[targetIndex].widgets,
              widget: finalWidgets ? finalWidgets[finalWidgets.length - 1] : updated[targetIndex].widget,
              streamStats,
            };
            return updated;
          });
        }
        clearAssistantStreamState();
        saveCurrentSession();

        if (assistantMessageIndex >= 0 && settings.agentSafetyChecker && finalContent) {
          runAssistantSafetyScan(finalContent, assistantMessageIndex);
        } else if (settings.autoSpeak && settings.speechEnabled && finalContent) {
          speakAssistantText(finalContent);
        }

        if (!settings.agentMistakeChecker && !settings.agentSafetyChecker) {
          maybeCompactConversationContext();
        }
      },
      onError: (error) => {
        clearAssistantStreamState();

        const updateLastMessage = (content: string) => {
          setMessages((prev) => {
            const updated = [...prev];
            const targetIndex = resolveTargetAssistantIndex(updated);
            if (targetIndex < 0) {
              return updated;
            }
            updated[targetIndex] = {
              ...updated[targetIndex],
              content,
              tokens: undefined,
              widgets: undefined,
              widget: undefined,
              streamStats: undefined,
              isError: true,
            };
            return updated;
          });
        };

        if (isCloudSessionCancelled(error)) {
          updateLastMessage(t('mlearn.CloudReLogin.SignInCanceled'));
          return;
        }

        if (handleCloudSessionError(error, true)) {
          setIsConnected(false);
          updateLastMessage(t('mlearn.CloudReLogin.SessionExpired'));
          return;
        }

        if (isCloudUnreachable(error)) {
          updateLastMessage(t('mlearn.AI.CloudUnreachable'));
          return;
        }

        const errorMessage = getConversationErrorMessage(error);
        updateLastMessage(errorMessage);
      },
    };
  };

  const appendUserMessage = (text: string): number => {
    const userMsg: ConversationMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const userMsgIndex = messages().length;
    setMessages((prev) => [...prev, userMsg]);

    const shouldTokenizeUser = shouldTokenizeTextForLanguage(text, settings.language, currentLangData());
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

    return userMsgIndex;
  };

  const startResponseForUserText = (text: string, userMsgIndex: number) => {
    // Add placeholder assistant message for streaming
    const assistantMessageIndex = userMsgIndex + 1;
    setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
    startAssistantStream(assistantMessageIndex);

    const baseCallbacks = buildStreamCallbacks(assistantMessageIndex);

    agent.processMessage(text, messages(), {
      ...baseCallbacks,
      onDone: (...args) => {
        baseCallbacks.onDone(...args);
        if (settings.agentMistakeChecker || settings.agentSafetyChecker) {
          runCheckerOnMessage(text, userMsgIndex, assistantMessageIndex);
        }
      },
    });
  };

  const flushQueuedVoiceMessages = () => {
    if (queuedVoiceMessagesDuringCompaction.length === 0 || isStreaming() || isCompactingContext() || isSafetyLockedState()) return;

    const queuedMessages = queuedVoiceMessagesDuringCompaction;
    queuedVoiceMessagesDuringCompaction = [];
    const combinedText = queuedMessages.map((msg) => msg.text).join('\n');
    const lastUserMsgIndex = queuedMessages[queuedMessages.length - 1]?.userMsgIndex;
    if (lastUserMsgIndex === undefined) return;

    startResponseForUserText(combinedText, lastUserMsgIndex);
  };

  const maybeCompactConversationContext = () => {
    if (isStreaming() || isCompactingContext() || isSafetyLockedState()) return;
    if (checkerTaskCount > 0) return;
    if (agent.getHistory().length < AUTO_COMPACTION_MIN_HISTORY_MESSAGES) return;

    setIsCompactingContext(true);
    agent.summarizeHistory()
      .then((result) => {
        if (result.status === 'compacted') {
          saveCurrentSession();
        }
      })
      .catch((error) => {
        log.error("error", error);
      })
      .finally(() => {
        setIsCompactingContext(false);
        flushQueuedVoiceMessages();
      });
  };

  const sendTextMessage = (text: string) => {
    if (!text || isStreaming() || isSafetyLockedState()) return;

    if (isCompactingContext()) {
      if (activeTab() === 'voice' && isVoiceCallActive()) {
        const userMsgIndex = appendUserMessage(text);
        queuedVoiceMessagesDuringCompaction.push({ text, userMsgIndex });
      }
      return;
    }

    const userMsgIndex = appendUserMessage(text);
    startResponseForUserText(text, userMsgIndex);
  };

  const handleRequestGreeting = () => {
    if (isStreaming() || messages().length > 0) return;

    // Add placeholder assistant message for the greeting
    const assistantMessageIndex = messages().length;
    setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
    startAssistantStream(assistantMessageIndex);

    const context = `[Voice call started. The learner is waiting for you to speak. Greet them warmly and start a natural conversation in ${promptLangName()}. Keep it short — 1 to 2 sentences.]`;
    agent.continueWithContext(context, buildStreamCallbacks(assistantMessageIndex));
  };

  const handleStartConversation = () => {
    if (isStreaming() || messages().length > 0 || !isConnected()) return;

    // Add placeholder assistant message for the AI-initiated conversation
    const assistantMessageIndex = messages().length;
    setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: Date.now() }]);
    startAssistantStream(assistantMessageIndex);

    const context = `[The learner opened the chat. Greet them warmly and start a natural conversation in ${promptLangName()}. Keep it short — 1 to 2 sentences.]`;
    agent.continueWithContext(context, buildStreamCallbacks(assistantMessageIndex));
  };

  const handleConnectionStatusClick = () => {
    if (!canOpenCloudSignIn()) return;
    openCloudReLoginModal();
  };

  const handleSend = async () => {
    const text = inputText().trim();
    if (!text || isStreaming() || isCompactingContext()) return;

    const command = findExactSlashCommand(text);
    if (command) {
      await executeCommand(command);
      return;
    }

    // Low power gate: prompt before local LLM call
    const allowed = await ensureLlmAllowed();
    if (!allowed) return;

    setInputText('');
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }

    sendTextMessage(text);
  };

  const handleAbort = () => {
    agent.abortStream();
    clearAssistantStreamState();

    // If the only message is an empty/partial first assistant greeting with no
    // user messages yet, clear everything so the welcome screen returns.
    const msgs = messages();
    const hasUserMessage = msgs.some((m) => m.role === 'user');
    if (!hasUserMessage) {
      handleClear();
    }
  };

  const handleRegenerate = (messageIndex: number) => {
    if (isStreaming()) return;

    const msgs = messages();
    const targetMsg = msgs[messageIndex];
    if (!targetMsg || !canRegenerateAssistantMessage(msgs, messageIndex, false)) return;

    // Find the user message that preceded this assistant message
    let userMsgIndex = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        userMsgIndex = i;
        break;
      }
    }

    // Reuse the existing bubble so an error bubble cannot disappear during regeneration.
    setMessages((prev) => {
      const updated = [...prev];
      if (!updated[messageIndex] || updated[messageIndex].role !== 'assistant') {
        return updated;
      }
      updated[messageIndex] = {
        ...updated[messageIndex],
        content: '',
        tokens: undefined,
        widget: undefined,
        widgets: undefined,
        streamStats: undefined,
        interrupted: false,
        safety: undefined,
        timestamp: Date.now(),
      };
      return updated;
    });
    startAssistantStream(messageIndex);

    if (userMsgIndex === -1) {
      // AI-initiated message with no preceding user message — remove context + assistant from history,
      // then re-request with a fresh context so the LLM produces a different greeting
      agent.popHistory(2);
      const context = `[The learner is waiting. Greet them and start a natural conversation in ${promptLangName()}. Keep it short — 1 to 2 sentences.]`;
      agent.continueWithContext(context, buildStreamCallbacks(messageIndex));
    } else {
      agent.restartStream(buildStreamCallbacks(messageIndex));
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showCommandPalette() && filteredCommands().length > 0) {
      const cmds = filteredCommands();
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandSelectedIndex((i) => (i > 0 ? i - 1 : cmds.length - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandSelectedIndex((i) => (i < cmds.length - 1 ? i + 1 : 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        executeCommand(cmds[commandSelectedIndex()]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommandPalette(false);
        setInputText('');
        if (textareaRef) textareaRef.style.height = 'auto';
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const normalizeQuizAnswer = (answer: string): string => answer.trim().toLocaleLowerCase();

  const handleQuizAnswer = (messageIndex: number, widgetIndex: number, answer: string) => {
    if (isSafetyLockedState()) return;
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

      const assistantMessageIndex = messages().length;
      setMessages((prev) => [...prev, { role: 'assistant' as const, content: '', timestamp: Date.now() }]);
      startAssistantStream(assistantMessageIndex);

      agent.continueWithContext(context, buildStreamCallbacks(assistantMessageIndex));
    }
  };

  const toggleRecording = () => {
    if (isRecording()) {
      getBridge().speech.sttStop();
      setIsRecording(false);
    } else {
      const lang = settings.sttLanguage || settings.language;
      getBridge().speech.sttStart(lang);
      setIsRecording(true);
    }
  };

  const handleClear = () => {
    setMessages([]);
    clearAssistantStreamState();
    agent.clearHistory();
  };

  // Hover trigger mode controls (same as ReaderStatusBar)
  const currentTriggerMode = () => settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger!;
  const currentKey = () => settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!;

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
    const levels = sortFrequencyLevelsForDisplay(
      Object.keys(names).map(Number).filter((n) => !isNaN(n)),
      currentLangData(),
    );
    for (const level of levels) {
      options.push({ value: String(level), label: getFrequencyLevelLabel(level, names, currentLangData()) });
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
    return shouldHideAssistantBubble(messages(), index, isStreaming(), streamingMessageIndex());
  };

  const canRegenerateMessageAt = (index: number): boolean => {
    if (!canRegenerateAssistantMessage(messages(), index, isStreaming())) {
      return false;
    }

    return !messages()[index - 1]?.safety;
  };

  return (
    <div class="conversation-agent">
      <Show when={showSplash() && settings.llmProvider === 'cloud'}>
        <AgeVerificationModal onAccept={() => setShowSplash(false)} />
      </Show>
      <Modal
        isOpen={showDisclaimer() && settings.llmProvider !== 'cloud'}
        onClose={() => setShowDisclaimer(false)}
        title={t('mlearn.ConversationAgent.Title')}
        closeOnOverlay={false}
        closeOnEscape={false}
        showCloseButton={false}
        size="md"
        footer={
          <Btn variant="primary" size="lg" onClick={() => setShowDisclaimer(false)}>
            {t('mlearn.ConversationAgent.AgeVerification.ContinueButton')}
          </Btn>
        }
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--spacing-4)' }}>
          <p style={{ margin: '0', 'font-size': '0.9375rem', 'line-height': '1.6', color: 'var(--text-warning)', 'font-weight': 500 }}>
            {t('mlearn.ConversationAgent.Banner.AIWarning')}
          </p>
          <p style={{ margin: '0', 'font-size': '0.9375rem', 'line-height': '1.6', color: 'var(--text-secondary)' }}>
            {t('mlearn.ConversationAgent.Banner.SafetyNotice', { status: settings.agentSafetyChecker ? 'ON' : 'OFF' })}
            {' '}
            <button
              type="button"
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--text-link)', 'text-decoration': 'underline', cursor: 'pointer' }}
              onClick={() => getBridge().window.openWindow({ type: 'settings' })}
            >
              [{t('mlearn.ConversationAgent.Banner.SettingsLink')}]
            </button>
            {' '}
            {t('mlearn.ConversationAgent.Banner.TerminationNotice')}
          </p>
        </div>
      </Modal>
      {/* Header with integrated tabs */}
      <div class="ca-header">
        <div class="ca-header-left">
          <span class="ca-header-title">{t('mlearn.ConversationAgent.Title')}</span>
          <button
            type="button"
            class={`ca-connection-info ${canOpenCloudSignIn() ? 'is-actionable' : ''}`}
            onClick={handleConnectionStatusClick}
            aria-disabled={!canOpenCloudSignIn()}
            aria-label={canOpenCloudSignIn() ? t('mlearn.Connection.SignIn') : undefined}
          >
            <Tag class="ca-provider-label" headless size="sm">
              {providerLabel()}
            </Tag>
            <ConnectionStatus
                status={isCheckingConnection() ? 'loading' : isConnected() ? 'connected' : 'disconnected'}
                showLabel={!isConnected()}
                size="sm"
            />
          </button>
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
            onClick={() => setSidebarVisible((v) => !v)}
            icon={<HistoryIcon size={14} />}
            aria-label={t('mlearn.ConversationAgent.History.ToggleSidebar')}
          />
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
          <Show when={sidebarVisible()}>
            <div class="ca-history-sidebar">
              <ConversationHistoryPanel
                sessions={sessions()}
                activeSessionId={currentSessionId()}
                onSelect={handleLoadSession}
                onDelete={handleDeleteSession}
                onDeleteAll={handleDeleteAllSessions}
                onNewSession={handleNewSession}
              />
            </div>
          </Show>
          <div class={`ca-chat-content ${sidebarVisible() ? 'ca-chat-content--with-sidebar' : ''}`}>
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
                        isStreaming={isStreamingAssistantBubble(msg(), index, isStreaming(), streamingMessageIndex())}
                        isWaiting={isWaiting() && isStreamingAssistantBubble(msg(), index, isStreaming(), streamingMessageIndex())}
                        onTokenHover={handleTokenHover}
                        onTokenLeave={handleTokenLeave}
                        triggerMode={currentTriggerMode()}
                        triggerKey={currentKey()}
                        onQuizAnswer={(widgetIndex, answer) => handleQuizAnswer(index, widgetIndex, answer)}
                        onRegenerate={canRegenerateMessageAt(index) ? () => handleRegenerate(index) : undefined}
                        avatarSrc={activeAgent()?.profilePhoto}
                      />
                    </Show>
                  )}
                </Index>
              </Show>
            </div>

            {/* Word Hover Popup */}
            <Show when={hoverData()} keyed>
              {(data) => data.token ? (
                <WordHover
                  token={data.token}
                  word={data.word}
                  position={data.position}
                  anchorRect={data.anchorRect}
                  dictionaryEntries={dictionaryEntries()}
                  translationData={translationData() || undefined}
                  isLoading={isLoadingDict()}
                  visible={isVisible()}
                  contextPhrase={data.word}
                  onMouseEnter={cancelHide}
                  onMouseLeave={hideHover}
                  onClose={hideHover}
                  onOpenExplainer={handleOpenExplainer}
                />
              ) : null}
            </Show>

            <ExplainerPopup
              isOpen={explainerOpen()}
              onClose={handleCloseExplainer}
              word={explainerWord()}
              contextPhrase={explainerContext()}
              initialPosition={explainerPosition()}
            />

            <Show when={isSafetyLockedState()} fallback={<div class="ca-disclaimer">{t('mlearn.ConversationAgent.Disclaimer')}</div>}>
              <div class="ca-safety-lockout">
                {t('mlearn.ConversationAgent.Safety.LockoutMessage')}
              </div>
            </Show>
            {/* Input */}
            <div class="ca-input-area">
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
                  <Show when={showCommandPalette()}>
                    <CommandPalette
                      commands={filteredCommands()}
                      selectedIndex={commandSelectedIndex()}
                      onSelect={executeCommand}
                    />
                  </Show>

                  <Textarea
                    ref={textareaRef}
                    class="ca-chat-textarea"
                    placeholder={isSafetyLockedState()
                      ? t('mlearn.ConversationAgent.Safety.LockoutMessage')
                      : t('mlearn.ConversationAgent.InputPlaceholder', { language: langName() })}
                    value={inputText()}
                    onInput={handleTextareaInput}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    resize="none"
                    disabled={isStreaming() || isCompactingContext() || !isConnected() || isSafetyLockedState()}
                    ghost
                  />

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
                      variant="default"
                      onClick={handleSend}
                      disabled={!inputText().trim() || !isConnected() || isCompactingContext() || isSafetyLockedState()}
                      aria-label={t('mlearn.ConversationAgent.Send')}
                    />
                  </Show>
                </div>
              </div>
            </div>
            {/* Status bar with hover trigger selector, knowledge toggle, and level adaptation */}
            <StatusBar>
              <Show when={isLowPowerActive()}>
                <button type="button" class="statusbar-toggle active" tabIndex={-1} title={t('mlearn.LowPowerGate.StatusBarTooltip')}>
                  <BatteryLowIcon size={14} />
                </button>
              </Show>
              <div class="hover-trigger-section">
                <label class="hover-trigger-label">{t('mlearn.ConversationAgent.ShowTooltipOn')}</label>
                <Select
                    class="hover-trigger-select"
                    options={triggerOptions()}
                    value={currentTriggerMode()}
                    onChange={handleTriggerModeChange}
                />
              </div>
              <div class="hover-trigger-section">
                <ToggleSwitch
                  checked={includeKnowledgeInfo()}
                  onChange={setIncludeKnowledgeInfo}
                  label={t('mlearn.ConversationAgent.IncludeKnowledge')}
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
              <ToolMenu
                tools={toolMenuItems()}
                disabledTools={disabledTools()}
                onToggle={handleToolToggle}
              />
            </StatusBar>
          </div>
        </div>
      </TabPanel>

      {/* Voice panel */}
      <TabPanel tabId="voice" activeTab={activeTab()} class="ca-voice-panel">
        <Show when={voiceAftermath()} fallback={
          <>
            <VoiceTab
              messages={messages()}
              isStreaming={isStreaming()}
              onSendMessage={sendTextMessage}
              onRequestGreeting={handleRequestGreeting}
              onAbort={handleAbort}
              defaultVoiceSampleId={activeAgent()?.voiceSampleId}
              agentName={activeAgent()?.agentName}
              profilePhoto={activeAgent()?.profilePhoto}
              onCallStateChange={(active, reason) => {
                setIsVoiceCallActive(active);
                if (active) {
                  setVoiceMistakes([]);
                  setVoiceSessionStart(Date.now());
                  setVoiceAftermath(null);
                } else {
                  if (reason !== 'completed') {
                    setVoiceSessionStart(0);
                    return;
                  }

                  // Build aftermath when call ends
                  const mistakes = voiceMistakes().filter(isValidVoiceMistake);
                  if (mistakes.length > 0 || voiceSessionStart() > 0) {
                    setVoiceAftermath({
                      mistakes,
                      duration: Date.now() - voiceSessionStart(),
                      messageCount: messages().filter(m => m.role !== 'system').length,
                    });
                  }
                }
              }}
              onInterrupted={(spokenText, interruptedAt) => {
                // Update LLM conversation history to reflect what was actually heard
                agent.markInterrupted(spokenText, interruptedAt);

                // Mark the last assistant message as interrupted with only the spoken text
                setMessages((prev) => {
                  const updated = [...prev];
                  for (let i = updated.length - 1; i >= 0; i--) {
                    if (updated[i].role === 'assistant') {
                      updated[i] = {
                        ...updated[i],
                        interrupted: true,
                        interruptedAt,
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
              language={settings.language}
            />

            <Show when={hoverData()} keyed>
              {(data) => data.token ? (
                <WordHover
                  token={data.token}
                  word={data.word}
                  position={data.position}
                  anchorRect={data.anchorRect}
                  dictionaryEntries={dictionaryEntries()}
                  translationData={translationData() || undefined}
                  isLoading={isLoadingDict()}
                  visible={isVisible()}
                  contextPhrase={data.word}
                  onMouseEnter={cancelHide}
                  onMouseLeave={hideHover}
                  onClose={hideHover}
                  onOpenExplainer={handleOpenExplainer}
                />
              ) : null}
            </Show>

            <ExplainerPopup
              isOpen={explainerOpen()}
              onClose={handleCloseExplainer}
              word={explainerWord()}
              contextPhrase={explainerContext()}
              initialPosition={explainerPosition()}
            />
          </>
        }>
          {(aftermath) => (
            <VoiceAftermath
              aftermath={aftermath()}
              onDismiss={() => setVoiceAftermath(null)}
            />
          )}
        </Show>
      </TabPanel>

      {/* Agents panel */}
      <TabPanel tabId="agents" activeTab={activeTab()} class="ca-agents-panel">
        <AgentListPanel
          agents={agents()}
          activeAgentId={activeAgentId()}
          memories={allMemories()}
          onSelect={handleSelectAgent}
          onCreate={handleCreateAgent}
          onEdit={handleEditAgent}
          onDelete={handleDeleteAgent}
          onDeleteMemory={handleDeleteMemory}
          onClearAgentMemories={(agentId) => clearAgentMemories(agentId, settings.language).then(setAllMemories)}
          onDeleteAll={handleDeleteAllAgents}
        />
      </TabPanel>

      {/* Stats / Context panel */}
      <TabPanel tabId="stats" activeTab={activeTab()} class="ca-stats-panel">
        <SessionContextTab
          context={mediaContext()}
          tutorConfig={tutorConfig()}
          onTutorConfigChange={setTutorConfig}
        />
      </TabPanel>

      {/* Agent setup modal */}
      <AgentSetupModal
        isOpen={showSetupModal()}
        onComplete={handleSetupComplete}
        onClose={() => { setShowSetupModal(false); setEditingAgent(null); }}
        initialConfig={editingAgent()}
      />

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
