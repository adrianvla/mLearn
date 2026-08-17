/**
 * Conversation Agent Window App Component
 * AI-powered language tutor with tokenized chat, tool calling, and speech I/O
 */

import { Component, Show, Index, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { WindowWrapper, useSettings, useLanguage, useLocalization, useLowPowerGate, useServer } from '../../context';
import { useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { CloudLLMAdapter } from '../../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../../shared/backends';
import { getFrequencyLevelLabel, sortFrequencyLevelsForDisplay } from '../../../shared/languageFeatures';
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
import { RoomSidebar } from './RoomSidebar';
import { ScenarioEntryModal } from './ScenarioEntryModal';
import { HistoryIcon } from '../../components/common/Misc/Icons';

import { createConversationAgent, type AgentInstance } from '../../services/conversationAgent';
import { createCheckerAgent } from '../../services/checkerAgent';
import type { StreamCallbacks } from '../../services/conversationAgent';
import type { ConversationMessage, ConversationAgentContext, Token, ChatWidget, DictionaryEntry, TranslationResponse, VoiceMistake, VoiceSessionAftermath, TutorSessionConfig, AgentConfig, AgentMemoryEntry } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import { getConversationErrorMessage } from './errorUtils';
import { shouldHideAssistantBubble } from './messageState';
import { createJournalThreadStore, eventsToDisplayMessages, buildLLMHistory } from './journalRuntime';
import { runRoomTurn } from '../../../shared/roomOrchestrator';
import { compileContext, type CompiledContext } from '../../../shared/contextCompiler';
import { renderCompiledContext } from './roomMessages';
import { selectSpeaker } from '../../../shared/speakerSelection';
import { HARNESS_ACTOR, USER_ACTOR, type MessagePayload, type Participant, type WorldSnapshot } from '../../../shared/world';
import './ConversationAgent.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.conversationAgent.app");
const HISTORY_WINDOW = 40;

function windowTruncate<T>(history: T[]): T[] {
  return history.slice(-HISTORY_WINDOW);
}

function lastContextMessage(context: CompiledContext): string {
  for (let index = context.recentThreadEvents.length - 1; index >= 0; index--) {
    const event = context.recentThreadEvents[index];
    if (event.type === 'message.user' || event.type === 'message.character') return event.text ?? '';
  }
  return '';
}

/**
 * Known tool names used by the conversation agent.
 * Used to detect and hide partial tool call text during streaming.
 */
const TOOL_NAMES = ['correct_mistake', 'create_quiz', 'fetch_url', 'get_media_stats', 'note_mistake', 'recall_backstory', 'save_memory', 'search_wikipedia', 'search_fandom'];

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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

// Stop icon SVG (for aborting stream)
const StopIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

// Mic icon SVG
const MicIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path d="M19 10v2a7 7 0 01-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

export const ConversationContent: Component = () => {
  const { settings, updateSettings, openCloudReLoginModal } = useSettings();
  const server = useServer();
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
  const [inputText, setInputText] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [isCompactingContext] = createSignal(false);

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

  const [world, setWorld] = createSignal<WorldSnapshot | null>(null);
  const [selection, setSelection] = createSignal<{ roomId: string; threadId: string | null } | null>(null);
  const journal = createJournalThreadStore();
  const [liveOverlay, setLiveOverlay] = createSignal<ConversationMessage | null>(null);
  const [messageOverrides, setMessageOverrides] = createSignal<Map<string, Partial<ConversationMessage>>>(new Map());
  const interruptedSpokenText = new Map<string, { text: string; interruptedAt: string }>();
  const supersededEvents = new Set<string>();
  const participantAgents = new Map<string, AgentInstance>();
  let selectionSession = 0;
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [showScenarioModal, setShowScenarioModal] = createSignal(false);
  let voiceScheduledNudgeId = 0;
  const [voiceScheduledNudge, setVoiceScheduledNudge] = createSignal<{ id: number; seconds: number; prompt?: string } | null>(null);

  const cancelVoiceScheduledNudge = () => {
    setVoiceScheduledNudge(null);
  };

  const scheduleVoiceNudge = (nudge: { seconds: number; prompt?: string }) => {
    cancelVoiceScheduledNudge();
    if (!isVoiceCallActive()) return;
    setVoiceScheduledNudge({ id: ++voiceScheduledNudgeId, seconds: nudge.seconds, prompt: nudge.prompt });
  };

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
  const youLabel = () => t('mlearn.Room.You') || 'You';
  const activeRoom = () => world()?.rooms.find((room) => room.id === selection()?.roomId) ?? null;
  const rosterParticipants = () => {
    const room = activeRoom();
    if (!room) return [];
    const byId = new Map((world()?.participants ?? []).map((participant) => [participant.id, participant]));
    return room.participantIds.map((id) => byId.get(id)).filter((participant): participant is Participant => participant !== undefined);
  };
  const displayMessages = createMemo(() => eventsToDisplayMessages(journal.threadEvents(), rosterParticipants(), youLabel())
    .filter((message) => !supersededEvents.has((message as ConversationMessage & { eventId: string }).eventId))
    .map((message) => {
      const eventId = (message as ConversationMessage & { eventId: string }).eventId;
      const interrupted = interruptedSpokenText.get(eventId);
      return { ...message, ...messageOverrides().get(eventId), ...(interrupted ? { content: interrupted.text, interrupted: true, interruptedAt: interrupted.interruptedAt } : {}) };
    }));
  const messages = createMemo(() => liveOverlay() ? [...displayMessages(), liveOverlay()!] : displayMessages());
  const [streamingMessageIndex, setStreamingMessageIndex] = createSignal<number | null>(null);
  const updateMessageOverride = (eventId: string, update: (message: ConversationMessage) => ConversationMessage) => {
    const message = displayMessages().find((item) => (item as ConversationMessage & { eventId: string }).eventId === eventId);
    if (!message) return;
    setMessageOverrides((overrides) => new Map(overrides).set(eventId, update(message)));
  };

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

  const getParticipantAgent = (participant: Participant): AgentInstance => {
    const cached = participantAgents.get(participant.id);
    if (cached) return cached;
    const runtimeAgent = createConversationAgent({
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
    onVoiceNudgeScheduled: scheduleVoiceNudge,
    onMemorySaved: (content: string) => {
      const room = activeRoom();
      if (!room) return;
      void journal.append({
        roomId: room.id,
        scope: { kind: 'sea' },
        type: 'memory.belief',
        actorId: HARNESS_ACTOR,
        witnesses: [USER_ACTOR, participant.id],
        payload: { ownerId: participant.id, kind: 'belief', text: content },
      });
    },
    getIncludeKnowledgeInfo: () => includeKnowledgeInfo(),
    getDisabledTools: () => disabledTools(),
    getWorldContext: () => renderCompiledContext(
      compileContext({ participant, participants: rosterParticipants(), seaEvents: journal.seaEvents(), threadEvents: journal.threadEvents() }),
      rosterParticipants(),
      youLabel(),
    ),
  });
    participantAgents.set(participant.id, runtimeAgent);
    return runtimeAgent;
  };

  const activeRuntimeAgent = () => {
    const participant = rosterParticipants()[0];
    return participant ? getParticipantAgent(participant) : null;
  };
  const requireAgent = (): AgentInstance => {
    const runtimeAgent = activeRuntimeAgent();
    if (!runtimeAgent) throw new Error('No room participant is selected');
    return runtimeAgent;
  };
  const agent: AgentInstance = {
    processMessage: (...args) => requireAgent().processMessage(...args),
    abortStream: () => activeRuntimeAgent()?.abortStream(),
    clearHistory: () => activeRuntimeAgent()?.clearHistory(),
    popHistory: (count) => activeRuntimeAgent()?.popHistory(count),
    restartStream: (callbacks) => requireAgent().restartStream(callbacks),
    tokenize: (text) => requireAgent().tokenize(text),
    continueWithContext: (context, callbacks) => requireAgent().continueWithContext(context, callbacks),
    markInterrupted: (text, at) => requireAgent().markInterrupted(text, at),
    lockSafety: () => activeRuntimeAgent()?.lockSafety(),
    unlockSafety: () => activeRuntimeAgent()?.unlockSafety(),
    isSafetyLocked: () => activeRuntimeAgent()?.isSafetyLocked() ?? false,
    getHistory: () => activeRuntimeAgent()?.getHistory() ?? [],
    loadHistory: (history) => requireAgent().loadHistory(history),
    compactHistory: (maxTokens) => requireAgent().compactHistory(maxTokens),
    summarizeHistory: () => requireAgent().summarizeHistory(),
  };

  const [isSafetyLockedState, setIsSafetyLockedState] = createSignal(false);

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

  const runCheckerOnMessage = (userText: string, messageEventId: string, _assistantEventId?: string) => {
    const customInstructions = tutorConfig()?.customInstructions || undefined;
    void enqueueCheckerTask(async () => {
      const result = await checkerAgent.checkMessage(userText, promptLangName(), customInstructions, {
        speakerRole: 'user',
        includeCorrections: settings.agentMistakeChecker,
        includeSafety: settings.agentSafetyChecker,
        languageFeatures: getLanguageFeatures(),
      });
      if (result.error === 'quota' && settings.agentSafetyChecker) { agent.lockSafety(); setIsSafetyLockedState(true); return; }
      if (result.corrections.length === 0 && !result.safety) {
        return;
      }

      const room = activeRoom();
      const threadId = selection()?.threadId;
      if (!room || !threadId) return;
      const witnesses = [USER_ACTOR, ...room.participantIds];
      if (result.corrections.length) await journal.append({ roomId: room.id, scope: { kind: 'thread', threadId }, type: 'correction', actorId: HARNESS_ACTOR, witnesses, payload: { messageEventId, corrections: result.corrections } });
      if (result.safety) {
        agent.lockSafety(); setIsSafetyLockedState(true);
        await journal.append({ roomId: room.id, scope: { kind: 'thread', threadId }, type: 'safety_flag', actorId: HARNESS_ACTOR, witnesses, payload: { messageEventId, flag: result.safety } });
      }
    });
  };

  onMount(async () => {
    const snapshot = await getBridge().world.getWorldState();
    setWorld(snapshot);
    const firstRoom = snapshot.rooms[0];
    if (firstRoom) await selectRoom(firstRoom.id);
  });

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
      const greetingContext = `[The learner just opened the chat. Greet them warmly and start a natural conversation in ${promptLangName()}. Keep it short — 1 to 2 sentences.]`;
      void runContextTurn(greetingContext);
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
    setLiveOverlay(null);
    clearAssistantStreamState();
    agent.clearHistory();
    setActiveAgentId(null);
    setShowSetupModal(true);
  };

  const handleDeleteMemory = (id: string) => {
    removeAgentMemory(id, settings.language).then(setAllMemories);
  };

  const handleSelectAgent = async (id: string) => {
    cancelVoiceScheduledNudge();
    setActiveAgentId(id);
    await saveActiveAgentId(id);
    // Clear conversation when switching agents
    setLiveOverlay(null);
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
    cancelVoiceScheduledNudge();
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
      setLiveOverlay(null);
      agent.clearHistory();
      agent.unlockSafety();
      setIsSafetyLockedState(false);
    }
  };

  const selectRoom = async (roomId: string, requestedThreadId?: string): Promise<void> => {
    const mySession = ++selectionSession;
    const snapshot = await getBridge().world.getWorldState();
    if (mySession !== selectionSession) return;
    setWorld(snapshot);
    const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return;
    let threadId = requestedThreadId ?? snapshot.threads.find((thread) => thread.roomId === roomId && thread.state === 'active')?.id;
    if (!threadId) {
      const thread = await getBridge().world.createThread(roomId);
      if (mySession !== selectionSession) return;
      threadId = thread.id;
      setWorld((current) => current ? { ...current, threads: [...current.threads, thread] } : current);
    }
    cancelVoiceScheduledNudge();
    agent.abortStream();
    clearAssistantStreamState();
    agent.unlockSafety();
    setIsSafetyLockedState(false);
    setLiveOverlay(null);
    setMessageOverrides(new Map());
    participantAgents.clear();
    setSelection({ roomId, threadId });
    await journal.select({ roomId, threadId });
    if (mySession !== selectionSession) return;
    await getBridge().world.clearRoomUnread(roomId);
    setWorld((current) => current ? { ...current, rooms: current.rooms.map((item) => item.id === roomId ? { ...item, unreadCount: 0 } : item) } : current);
    setSidebarVisible(false);
  };

  const newThread = async (): Promise<void> => {
    const room = activeRoom();
    if (!room || isStreaming()) return;
    const thread = await getBridge().world.createThread(room.id);
    setWorld((current) => current ? { ...current, threads: [...current.threads, thread] } : current);
    await selectRoom(room.id, thread.id);
  };

  const handleScenarioCreated = async (result: { roomId: string; threadId: string }): Promise<void> => {
    const snapshot = await getBridge().world.getWorldState();
    setWorld(snapshot);
    setShowScenarioModal(false);
    await selectRoom(result.roomId, result.threadId);
  };

  // Check LLM availability reactively when provider/config changes
  createEffect(() => {
    // Track reactive dependencies so the effect re-runs on change
    const provider = settings.llmProvider;
    void settings.ollamaUrl;
    void settings.ollamaModel;
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
        if (typeof rawCtx.roomId === 'string') {
          void selectRoom(rawCtx.roomId, typeof rawCtx.threadId === 'string' ? rawCtx.threadId : undefined);
        }
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
        if (typeof rawCtx.initialMessage === 'string' && rawCtx.initialMessage.trim()) {
          setInputText(rawCtx.initialMessage);
          queueMicrotask(() => {
            void handleSend();
          });
        }
      }
    });
    bridge.window.getWindowContext('conversation-agent');
    if (cleanup) onCleanup(cleanup);
    const cleanupOpen = bridge.window.onOpenRoomEvent((payload) => {
      void selectRoom(payload.roomId, payload.threadId);
    });
    if (cleanupOpen) onCleanup(cleanupOpen);
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
    cancelVoiceScheduledNudge();
    journal.teardown();
  });

  // Slash commands
  const slashCommands = (): SlashCommand[] => [
    { id: 'newtopic', label: t('mlearn.ConversationAgent.Commands.NewTopic'), description: t('mlearn.ConversationAgent.Commands.NewTopicDesc') },
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

  const executeCommand = async (command: SlashCommand) => {
    if (command.id === 'newtopic') {
      if (isStreaming() || isCompactingContext() || !isConnected() || isSafetyLockedState()) return;
      const allowed = await ensureLlmAllowed();
      if (!allowed) return;

      setInputText('');
      setShowCommandPalette(false);
      setCommandSelectedIndex(0);
      if (textareaRef) textareaRef.style.height = 'auto';

      const hasMessages = messages().length > 1;
      const context = hasMessages
        ? `[The learner wants to change the topic. Smoothly transition to a new, interesting, and creative topic. Pick something engaging and different from what was discussed before. Start naturally with a question or interesting statement in ${promptLangName()}. Keep it concise — 1 to 3 sentences.]`
        : `[The learner wants you to pick a topic. Start a natural conversation about something interesting and creative in ${promptLangName()}. Keep it concise — 1 to 3 sentences.]`;
      await runContextTurn(context);
      return;
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

  const buildStreamCallbacks = (onDone?: number | ((text: string, widgets: ChatWidget[] | undefined) => void)): StreamCallbacks => {
    let streamTokenizeId = 0;
    let streamTokenizeTimer: ReturnType<typeof setTimeout> | null = null;
    return {
      onChunk: (accumulated) => {
        setIsWaiting(false);
        const visibleContent = stripPartialToolCall(accumulated);
        setLiveOverlay((overlay) => overlay ? { ...overlay, content: visibleContent } : overlay);

        if (visibleContent.trim()) {
          if (streamTokenizeTimer) clearTimeout(streamTokenizeTimer);
          streamTokenizeTimer = setTimeout(() => {
            const tokenizeId = ++streamTokenizeId;
            agent.tokenize(visibleContent).then((tokens) => {
              if (tokenizeId !== streamTokenizeId) return;
              if (tokens.length > 0) setLiveOverlay((overlay) => overlay ? { ...overlay, tokens } : overlay);
            });
          }, 300);
        }
      },
      onToolCall: (widget: ChatWidget) => {
        setIsWaiting(false);
        setLiveOverlay((overlay) => {
          if (!overlay) return overlay;
          const widgets = [...(overlay.widgets ?? (overlay.widget ? [overlay.widget] : [])), widget];
          return { ...overlay, widgets, widget };
        });
      },
      onDone: (finalContent, _tokens, widgets) => {
        if (typeof onDone === 'function') onDone(finalContent, widgets);
        clearAssistantStreamState();
      },
      onError: (error) => {
        clearAssistantStreamState();
        const message = isCloudSessionCancelled(error) ? t('mlearn.CloudReLogin.SignInCanceled')
          : handleCloudSessionError(error, true) ? t('mlearn.CloudReLogin.SessionExpired')
          : isCloudUnreachable(error) ? t('mlearn.AI.CloudUnreachable') : getConversationErrorMessage(error);
        setLiveOverlay({ role: 'assistant', content: message, timestamp: Date.now(), isError: true });
      },
    };
  };

  const sendTextMessage = async (text: string) => {
    const room = activeRoom();
    const threadId = selection()?.threadId;
    if (!text || isStreaming() || isSafetyLockedState()) return;
    if (!room || !threadId) {
      const snapshot = await getBridge().world.getWorldState();
      const firstRoom = snapshot.rooms[0];
      if (!firstRoom) return;
      setWorld(snapshot);
      await selectRoom(firstRoom.id);
      return sendTextMessage(text);
    }
    cancelVoiceScheduledNudge();
    const witnesses = [USER_ACTOR, ...room.participantIds];
    const userEvent = await journal.append({ roomId: room.id, scope: { kind: 'thread', threadId }, type: 'message.user', actorId: USER_ACTOR, witnesses, payload: { text, modality: activeTab() === 'voice' ? 'voice' : 'text' } satisfies MessagePayload });
    setLiveOverlay({ role: 'assistant', content: '', timestamp: Date.now() });
    startAssistantStream(displayMessages().length);
    let pendingWidgets: ChatWidget[] | undefined;
    await runRoomTurn({
      room,
      participants: world()?.participants ?? [],
      seaEvents: journal.seaEvents(),
      threadEvents: [...journal.threadEvents(), userEvent],
      runAgentTurn: async (participantId, context) => {
        const participant = (world()?.participants ?? []).find((candidate) => candidate.id === participantId);
        if (!participant) return { text: '' };
        const runtimeAgent = getParticipantAgent(participant);
        runtimeAgent.loadHistory(windowTruncate(buildLLMHistory(journal.threadEvents(), participant.id, world()?.participants ?? [])));
        return new Promise((resolve, reject) => runtimeAgent.processMessage(lastContextMessage(context), [], {
          ...buildStreamCallbacks((final, widgets) => { pendingWidgets = widgets; resolve({ text: final }); }),
          onError: (error) => reject(new Error(error)),
        }));
      },
      appendEvent: async (draft) => journal.append(draft.type === 'message.character' && pendingWidgets
        ? { ...draft, payload: { ...(draft.payload as MessagePayload), widgets: pendingWidgets, widget: pendingWidgets[pendingWidgets.length - 1] } }
        : draft),
    });
    setLiveOverlay(null);
    if (settings.agentMistakeChecker || settings.agentSafetyChecker) runCheckerOnMessage(text, userEvent.id, undefined);
  };

  const runContextTurn = async (context: string, modality: 'text' | 'voice' = 'text'): Promise<void> => {
    const room = activeRoom();
    const threadId = selection()?.threadId;
    if (!room || !threadId || isStreaming() || isSafetyLockedState()) return;
    const participants = rosterParticipants();
    const latestEvent = journal.threadEvents().at(-1);
    const latestPayload = latestEvent?.payload;
    const latestText = typeof latestPayload === 'object' && latestPayload !== null && 'text' in latestPayload
      && typeof latestPayload.text === 'string' ? latestPayload.text : undefined;
    const participantId = selectSpeaker(participants, { lastEventText: latestText }) ?? participants[0]?.id;
    const participant = participants.find((candidate) => candidate.id === participantId);
    if (!participant) return;
    const runtimeAgent = getParticipantAgent(participant);
    runtimeAgent.loadHistory(windowTruncate(buildLLMHistory(journal.threadEvents(), participant.id, world()?.participants ?? [])));
    setLiveOverlay({ role: 'assistant', content: '', timestamp: Date.now() });
    startAssistantStream(displayMessages().length);
    await new Promise<void>((resolve, reject) => runtimeAgent.continueWithContext(context, {
      ...buildStreamCallbacks(async (text, widgets) => {
        await journal.append({
          roomId: room.id,
          scope: { kind: 'thread', threadId },
          type: 'message.character',
          actorId: participant.id,
          witnesses: [USER_ACTOR, ...room.participantIds],
          payload: { text, widgets, widget: widgets?.at(-1), modality } satisfies MessagePayload,
        });
        setLiveOverlay(null);
        if (settings.autoSpeak && settings.speechEnabled) speakAssistantText(text);
        resolve();
      }),
      onError: (error) => reject(new Error(error)),
    }));
  };

  const handleRequestGreeting = () => {
    if (isStreaming() || messages().length > 0) return;

    const context = `[Voice call started. The learner is waiting for you to speak. Greet them warmly and start a natural conversation in ${promptLangName()}. Keep it short — 1 to 2 sentences.]`;
    void runContextTurn(context, 'voice');
  };

  const handleVoiceIdleSilence = (reason: 'no-transcript' | 'waiting' | 'scheduled', scheduledPrompt?: string) => {
    if (reason === 'scheduled') {
      cancelVoiceScheduledNudge();
    }
    if (isStreaming() || isCompactingContext() || isSafetyLockedState() || !isConnected()) return;
    if (messages().length === 0) return;

    const context = reason === 'scheduled'
      ? `[Voice call scheduled nudge: you asked to be nudged after a short delay. The learner has not spoken since then. Respond naturally in ${promptLangName()} with a brief follow-up.${scheduledPrompt ? ` Private reminder: ${scheduledPrompt}` : ''} Do not mention timers, tools, nudges, transcripts, or system internals.]`
      : reason === 'no-transcript'
      ? `[Voice call silence: the learner appeared to speak, but speech recognition produced no reliable transcript, and they are now quiet. Respond naturally in ${promptLangName()} with a short check-in or gentle prompt. Do not mention speech recognition, VAD, transcripts, or system internals.]`
      : `[Voice call silence: the learner has been quiet for a while. Respond naturally in ${promptLangName()} with a brief check-in, encouragement, or a short follow-up question. Do not mention silence timers, VAD, transcripts, or system internals.]`;
    void runContextTurn(context, 'voice');
  };

  const handleStartConversation = () => {
    if (isStreaming() || messages().length > 0 || !isConnected()) return;

    const context = `[The learner opened the chat. Greet them warmly and start a natural conversation in ${promptLangName()}. Keep it short — 1 to 2 sentences.]`;
    void runContextTurn(context);
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

    await sendTextMessage(text);
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

    const eventId = (targetMsg as ConversationMessage & { eventId?: string } | undefined)?.eventId;
    if (eventId) updateMessageOverride(eventId, (message) => {
      const msg = { ...message };
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
      return msg;
    });

    // Continue agent loop after quiz answer
    if (targetWidget && targetWidget.type === 'quiz' && !isStreaming()) {
      const context = quizIsCorrect
        ? `[The learner answered the quiz correctly: "${answer}"]`
        : `[The learner answered incorrectly: "${answer}". The correct answer was: "${quizCorrectAnswer}"]`;

      void runContextTurn(context);
    }
  };

  const toggleRecording = () => {
    if (isRecording()) {
      getBridge().speech.sttStop();
      setIsRecording(false);
    } else {
      const lang = settings.language;
      getBridge().speech.sttStart(lang);
      setIsRecording(true);
    }
  };

  const handleClear = () => {
    void newThread();
    setLiveOverlay(null);
    clearAssistantStreamState();
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
            {t('mlearn.ConversationAgent.Banner.LocalPrivacyNotice')}
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
            <button
              type="button"
              style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--text-link)', 'text-decoration': 'underline', cursor: 'pointer' }}
              onClick={() => getBridge().window.openWindow({ type: 'memory-browser' })}
            >
              [{t('mlearn.MemoryBrowser.OpenInAgent')}]
            </button>
            <Show when={settings.agentSafetyChecker}>
              {' '}
              {t('mlearn.ConversationAgent.Banner.TerminationNotice')}
            </Show>
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
          <Show when={isCheckingConnection() && server.statusMessage() && server.statusMessage() !== 'Initializing...'}>
            <span class="ca-header-status">{server.statusMessage()}</span>
          </Show>
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
            <button
              type="button"
              class="ca-history-sidebar-backdrop"
              aria-label={t('mlearn.ConversationAgent.History.ToggleSidebar')}
              onClick={() => setSidebarVisible(false)}
            />
            <div class="ca-history-sidebar">
              <RoomSidebar
                world={world()}
                roomId={selection()?.roomId ?? null}
                threadId={selection()?.threadId ?? null}
                onSelectRoom={(roomId) => { void selectRoom(roomId); }}
                onSelectThread={(threadId) => { const room = activeRoom(); if (room) void selectRoom(room.id, threadId); }}
                onNewThread={() => { void newThread(); }}
                onNewScenario={() => setShowScenarioModal(true)}
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
                        isStreaming={msg().role === 'assistant' && index === messages().length - 1 && liveOverlay() !== null && isStreaming()}
                        isWaiting={isWaiting() && msg().role === 'assistant' && index === messages().length - 1 && liveOverlay() !== null}
                        onTokenHover={handleTokenHover}
                        onTokenLeave={handleTokenLeave}
                        triggerMode={currentTriggerMode()}
                        triggerKey={currentKey()}
                        onQuizAnswer={(widgetIndex, answer) => handleQuizAnswer(index, widgetIndex, answer)}
                        onRegenerate={undefined}
                        avatarSrc={rosterParticipants().length === 1 ? rosterParticipants()[0]?.profilePhoto : undefined}
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
                  <span class="hover-trigger-label">{t('mlearn.ConversationAgent.ShowTooltipOn')}</span>
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
                  <span class="hover-trigger-label">{t('mlearn.ConversationAgent.LevelAdapt.Label')}</span>
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
              onIdleSilence={handleVoiceIdleSilence}
              scheduledNudge={voiceScheduledNudge()}
              onAbort={handleAbort}
              defaultVoiceSampleId={activeAgent()?.voiceSampleId}
              agentName={activeAgent()?.agentName}
              profilePhoto={activeAgent()?.profilePhoto}
              onCallStateChange={(active, reason) => {
                setIsVoiceCallActive(active);
                if (!active) cancelVoiceScheduledNudge();
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

                const latest = [...displayMessages()].reverse().find((message) => message.role === 'assistant') as (ConversationMessage & { eventId?: string }) | undefined;
                if (latest?.eventId) interruptedSpokenText.set(latest.eventId, { text: spokenText, interruptedAt });
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

      {/* New scenario modal */}
      <ScenarioEntryModal
        isOpen={showScenarioModal()}
        onClose={() => setShowScenarioModal(false)}
        onCreated={(result) => { void handleScenarioCreated(result); }}
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
