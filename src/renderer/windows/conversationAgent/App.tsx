/**
 * Conversation Agent Window App Component
 * AI-powered language tutor with tokenized chat, tool calling, and speech I/O
 */

import { Component, Show, For, Index, createSignal, createEffect, createMemo, onMount, onCleanup } from 'solid-js';
import { WindowWrapper, useSettings, useLanguage, useLocalization, useLowPowerGate, useServer } from '../../context';
import { useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { CloudLLMAdapter } from '../../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../../shared/backends';
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
  loadActiveAgentId,
  saveActiveAgentId,
  migrateIfNeeded,
  loadAllMemories,
  generateAgentId,
} from '../../services/agentConfigService';
import {
  Btn,
  IconBtn,
  Modal,
  EmptyState,
  ConnectionStatus,
  Popover,
  Textarea,
  Tag,
  ChatIcon,
} from '../../components/common';
import { WordHover } from '../../components/subtitle';
import { ExplainerPopup } from '../../components/subtitle/ExplainerPopup';
import { useWordHover, useTranslation, useTokenizer, useDictionary, getCachedTranslation } from '../../hooks';
import { ChatBubble } from './ChatBubble';
import { ThreadInfoPanel } from './ThreadInfoPanel';
import { VoiceTab } from './VoiceTab';
import { VoiceAftermath } from './VoiceAftermath';
import { AgentSetupModal } from './AgentSetupModal';
import { AgeVerificationModal } from './AgeVerificationModal';
import { CommandPalette } from './CommandPalette';
import type { SlashCommand } from './CommandPalette';
import { getConversationDisplayLanguageName, getConversationPromptLanguageName } from './languageNames';
import { RoomSidebar } from './RoomSidebar';
import { NewConversationModal } from './NewConversationModal';

import { createConversationAgent, type AgentInstance } from '../../services/conversationAgent';
import { createCheckerAgent } from '../../services/checkerAgent';
import { inferTurnAffect } from '../../../shared/socialState';
import type { TurnAffectOptions, TurnSocialState } from '../../../shared/socialState';
import type { StreamCallbacks } from '../../services/conversationAgent';
import type { ConversationMessage, ConversationAgentContext, Token, ChatWidget, DictionaryEntry, TranslationResponse, VoiceMistake, VoiceSessionAftermath, TutorSessionConfig, AgentConfig, AgentMemoryEntry, StreamStats } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { getConversationErrorMessage } from './errorUtils';
import { shouldHideAssistantBubble } from './messageState';
import { createJournalThreadStore, eventsToDisplayMessages, buildLLMHistory } from './journalRuntime';
import { runRoomTurn } from '../../../shared/roomOrchestrator';
import { compileContext, type CompiledContext, type LearnerProjection } from '../../../shared/contextCompiler';
import { renderCompiledContext } from './roomMessages';
import { createVoicePrefetch } from './voicePrefetch';
import { selectSpeaker } from '../../../shared/speakerSelection';
import { HARNESS_ACTOR, USER_ACTOR, type MessagePayload, type Participant, type WorldSnapshot } from '../../../shared/world';
import { shouldTokenizeTextForLanguage } from '../../../shared/languageFeatures';
import './ConversationAgent.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.conversationAgent.app");
const HISTORY_WINDOW = 40;

type EventMessage = ConversationMessage & { eventId: string };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isConversationAgentContext(value: unknown): value is ConversationAgentContext {
  if (!isRecord(value)) return false;
  return typeof value.mediaHash === 'string'
    && typeof value.mediaName === 'string'
    && (value.mediaType === 'video' || value.mediaType === 'book')
    && (typeof value.assessedLevel === 'number' || value.assessedLevel === null)
    && typeof value.assessedLevelName === 'string'
    && typeof value.language === 'string'
    && Array.isArray(value.failedWords)
    && Array.isArray(value.failedGrammar)
    && isRecord(value.wordLevelPercentages)
    && isRecord(value.grammarLevelPercentages);
}

function isTutorSessionConfig(value: unknown): value is TutorSessionConfig {
  return isRecord(value)
    && Array.isArray(value.selectedGrammar)
    && Array.isArray(value.selectedWords)
    && Array.isArray(value.selectedMedia)
    && typeof value.customInstructions === 'string';
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

const PhoneIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.9a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.9.6 2.9.7a2 2 0 011.7 2z" />
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
    getLevelName,
    getCanonicalForm,
    getWordVariants,
    getReadingVariants,
    getGrammarPoint,
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

  const [mediaContext, setMediaContext] = createSignal<ConversationAgentContext | null>(null);
  const [tutorSelections, setTutorSelections] = createSignal<Pick<TutorSessionConfig, 'selectedGrammar' | 'selectedWords'>>({ selectedGrammar: [], selectedWords: [] });
  let translatedInstructions: string | null = null;
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

  const [showSplash, setShowSplash] = createSignal(true);
  const [showDisclaimer, setShowDisclaimer] = createSignal(true);
  const canOpenCloudSignIn = () => (
    settings.llmProvider === 'cloud'
    && !isCheckingConnection()
    && !isConnected()
  );

  // Voice mode state
  const [isVoiceCallActive, setIsVoiceCallActive] = createSignal(false);
  const [voiceMistakes, setVoiceMistakes] = createSignal<VoiceMistake[]>([]);
  const [voiceSessionStart, setVoiceSessionStart] = createSignal<number>(0);
  const [voiceAftermath, setVoiceAftermath] = createSignal<VoiceSessionAftermath | null>(null);

  // Agent setup & memory state
  const [agents, setAgents] = createSignal<AgentConfig[]>([]);
  const [activeAgentId, setActiveAgentId] = createSignal<string | null>(null);
  const [allMemories, setAllMemories] = createSignal<AgentMemoryEntry[]>([]);
  void allMemories;
  const [showSetupModal, setShowSetupModal] = createSignal(false);
  const [editingAgent, setEditingAgent] = createSignal<AgentConfig | null>(null);
  const [legacyAgentsLoaded, setLegacyAgentsLoaded] = createSignal(false);
  let firstRunModalHandled = false;

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
  const { tokenize: tokenizeCached } = useTokenizer({ language: settings.language, languageData: currentLangData });
  const [translationData, setTranslationData] = createSignal<TranslationResponse | null>(null);
  const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [isLoadingDict, setIsLoadingDict] = createSignal(false);
  let hoverRequestId = 0;

  const [world, setWorld] = createSignal<WorldSnapshot | null>(null);
  const [selection, setSelection] = createSignal<{ roomId: string; threadId: string | null } | null>(null);
  const journal = createJournalThreadStore();
  const [liveOverlay, setLiveOverlay] = createSignal<ConversationMessage | null>(null);
  const [messageOverrides, setMessageOverrides] = createSignal<Map<string, Partial<ConversationMessage>>>(new Map());
  const tokenizedMessageIds = new Set<string>();
  const interruptedSpokenText = new Map<string, { text: string; interruptedAt: string }>();
  const supersededEvents = new Set<string>();
  const participantAgents = new Map<string, AgentInstance>();
  let selectionSession = 0;
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [showNewConversationModal, setShowNewConversationModal] = createSignal(false);
  const [showOverflowMenu, setShowOverflowMenu] = createSignal(false);
  let overflowAnchorRef: HTMLButtonElement | undefined;
  const [showDetailsDrawer, setShowDetailsDrawer] = createSignal(false);
  const [voiceOverlayRequested, setVoiceOverlayRequested] = createSignal(false);
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
  // Learner state as one implicit projection: media-scoped failures + level +
  // (compat) legacy tutor selections, until the tutorConfig merge lands fully.
  // Media failures reconcile against the canonical knowledge resolver: a word
  // the journal settles (evidence-backed known or teaching-excluded) never
  // reaches the tutor as a failure, however stale media ease ranks it.
  // Explicit tutor selections bypass reconciliation — they are practice
  // assignments, not failure inferences. Grammar mixes explicit selections
  // with legacy ease-heuristic media stats, so its basis stays 'prediction'
  // until grammar targets/projection land.
  const learnerProjection = (): LearnerProjection => {
    const media = mediaContext();
    const tutor = tutorSelections();
    const level = Number(settings.learningLanguageLevels?.[settings.language] ?? 0);
    const notSettled = (word: string): boolean => !flashcardCtx.isWordSettledSync(word, settings.language);
    const mediaFailures = (media?.failedWords ?? [])
      .sort((a, b) => a.ease - b.ease)
      .slice(0, 15)
      .map((w) => w.word)
      .filter(notSettled);
    const selectedWords = (tutor?.selectedWords ?? []).map((w) => w.word);
    return {
      language: promptLangName(),
      wordsBasis: 'evidence',
      grammarBasis: 'prediction',
      failedWords: [...new Set([...mediaFailures, ...selectedWords])],
      grammarPoints: [
        ...(media?.failedGrammar ?? []).sort((a, b) => a.ease - b.ease).slice(0, 10).map((g) => g.pattern),
        ...(tutor?.selectedGrammar ?? []).map((g) => g.pattern),
      ],
      // Exposure signal only (patterns repeatedly seen, never failed) — kept
      // out of grammarPoints so prediction never masquerades as failure.
      grammarExposure: media?.grammarExposure?.map((g) => g.pattern),
      levelEstimate: level > 0 ? (getLevelName(level) ?? undefined) : media?.assessedLevelName ?? undefined,
    };
  };
  const activeRoom = () => world()?.rooms.find((room) => room.id === selection()?.roomId) ?? null;
  const activeThread = () => world()?.threads.find((thread) => thread.id === selection()?.threadId) ?? null;
  const mediaContextForTools = (): ConversationAgentContext | null => {
    const context = mediaContext();
    const media = activeThread()?.mediaRef;
    if (!media) return context;
    return {
      mediaHash: media.mediaHash,
      mediaName: media.mediaName,
      mediaType: media.mediaType,
      assessedLevel: context?.assessedLevel ?? null,
      assessedLevelName: media.assessedLevelName ?? context?.assessedLevelName ?? '',
      language: context?.language ?? settings.language,
      failedWords: context?.failedWords ?? [],
      failedGrammar: context?.failedGrammar ?? [],
      grammarExposure: context?.grammarExposure ?? [],
      wordLevelPercentages: context?.wordLevelPercentages ?? { entries: [], totalUnique: 0, totalOccurrences: 0 },
      grammarLevelPercentages: context?.grammarLevelPercentages ?? { entries: [], totalUnique: 0, totalOccurrences: 0 },
      subtitleHistory: media.subtitleHistory,
      characterContext: media.characterContext,
    };
  };
  const rosterParticipants = () => {
    const room = activeRoom();
    if (!room) return [];
    const byId = new Map((world()?.participants ?? []).map((participant) => [participant.id, participant]));
    return room.participantIds.map((id) => byId.get(id)).filter((participant): participant is Participant => participant !== undefined);
  };
  const hasActiveRoomSelection = () => selection() !== null && activeRoom() !== null;
  // Voice turns get the same journal-compiled world context as the text path,
  // prefetched speculatively from STT partials (latest-wins cache). The turn
  // text drives bounded turn-specific ranking/budgeting; scopeId keeps each
  // participant's view separate, and the journal-size version invalidates
  // speculative work if the world changed mid-utterance.
  const voiceContextPrefetch = createVoicePrefetch(
    (turnText: string, scopeId: string): string => {
      const participant = rosterParticipants().find((candidate) => candidate.id === scopeId);
      if (!participant) return '';
      return renderCompiledContext(
        compileContext({
          participant,
          participants: rosterParticipants(),
          seaEvents: journal.seaEvents(),
          threadEvents: journal.threadEvents(),
          learnerProjection: learnerProjection(),
          threadMedia: activeThread()?.mediaRef,
          turn: { text: turnText },
        }),
        rosterParticipants(),
        youLabel(),
      );
    },
    () => `${journal.seaEvents().length}:${journal.threadEvents().length}`,
  );
  let lastUserMessageEventId: string | null = null;
  let lastUserMessageEventRoomId: string | null = null;
  let lastVadSpeechEndTs: number | null = null;
  const displayMessages = createMemo(() => eventsToDisplayMessages(journal.threadEvents(), rosterParticipants(), youLabel())
    .filter((message) => !supersededEvents.has((message as EventMessage).eventId))
    .map((message) => {
      const eventId = (message as EventMessage).eventId;
      const interrupted = interruptedSpokenText.get(eventId);
      return { ...message, ...messageOverrides().get(eventId), ...(interrupted ? { content: interrupted.text, interrupted: true, interruptedAt: interrupted.interruptedAt } : {}) };
    }));
  const messages = createMemo(() => liveOverlay() ? [...displayMessages(), liveOverlay()!] : displayMessages());
  const [streamingMessageIndex, setStreamingMessageIndex] = createSignal<number | null>(null);
  const updateMessageOverride = (eventId: string, update: (message: ConversationMessage) => ConversationMessage) => {
    const message = displayMessages().find((item) => (item as EventMessage).eventId === eventId);
    if (!message) return;
    setMessageOverrides((overrides) => new Map(overrides).set(eventId, update(message)));
  };

  createEffect(() => {
    for (const message of displayMessages() as EventMessage[]) {
      if (
        (message.role !== 'assistant' && message.role !== 'user')
        ||
        message.tokens?.length
        || tokenizedMessageIds.has(message.eventId)
        || !shouldTokenizeTextForLanguage(message.content, settings.language, currentLangData())
      ) continue;

      tokenizedMessageIds.add(message.eventId);
      void tokenizeCached(message.content)
        .then((tokens) => {
          if (!tokens.length || displayMessages().find((item) => (item as EventMessage).eventId === message.eventId)?.tokens?.length) return;
          updateMessageOverride(message.eventId, (current) => ({ ...current, tokens }));
        })
        .catch((error: unknown) => log.error('error', error));
    }
  });

  const providerLabel = () => {
    switch (settings.llmProvider) {
      case 'cloud': return t('mlearn.AI.Settings.Provider.Cloud');
      case 'ollama': return t('mlearn.AI.Settings.Provider.Ollama');
      default: return t('mlearn.AI.Settings.Provider.Builtin');
    }
  };

  // Ephemeral turn-scoped affect state — lives in this closure for the session,
  // never journaled. Durable social facts remain Dreamer/journal territory.
  let turnHeuristicSocial: TurnSocialState | null = null;
  let pendingCheckerSocial: TurnSocialState | null = null;

  // Structural context for the affect heuristic: correction pressure in the
  // recent thread tail plus literal question repetition (language-agnostic).
  const turnSocialOpts = (text: string): TurnAffectOptions => {
    const events = journal.threadEvents();
    let correctionCount = 0;
    for (const event of events.slice(-12)) {
      if (event.type === 'correction') correctionCount += 1;
    }
    const normalized = text.trim().replace(/\s+/g, ' ').toLowerCase();
    const earlierQuestions = events
      .filter((event) => event.type === 'message.user')
      .map((event) => (event.payload as { text?: unknown }).text)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().replace(/\s+/g, ' ').toLowerCase());
    return {
      correctionCount,
      repeatedQuestion: normalized.includes('?') && earlierQuestions.includes(normalized),
    };
  };

  const getParticipantAgent = (participant: Participant): AgentInstance => {
    const cached = participantAgents.get(participant.id);
    if (cached) return cached;
    const runtimeAgent = createConversationAgent({
    getSettings: () => settings,
    getLanguage: () => settings.language,
    getLanguageName: () => promptLangName(),
    getLanguageFeatures: () => getLanguageFeatures(),
    getMediaContext: mediaContextForTools,
    flashcardCtx,
    getFrequency,
    getTargetLevel: () => Number(settings.learningLanguageLevels?.[settings.language] ?? 0) || null,
    getLanguageData: () => currentLangData(),
    getLevelName,
    isVoiceMode: isVoiceCallActive,
    onVoiceMistake: (mistake: VoiceMistake) => {
      if (!isValidVoiceMistake(mistake)) return;
      setVoiceMistakes((prev) => [...prev, mistake]);
      // Grammar evidence requires a real pattern: the note_mistake tool has no
      // pattern field, and tracking a bare word would pollute the grammar store.
      if (mistake.type === 'grammar' && getGrammarPoint(mistake.word)) {
        flashcardCtx.trackGrammarFailed(mistake.word);
      }
    },
    onVoiceNudgeScheduled: scheduleVoiceNudge,
    onMemorySaved: (content: string) => {
      const room = activeRoom();
      if (!room) return;
      // Provenance applies only when the saved belief belongs to the room the
      // tracked turn was sent in; otherwise the id would point across rooms.
      const provenanceEventId = lastUserMessageEventRoomId === room.id ? lastUserMessageEventId : null;
      void journal.append({
        roomId: room.id,
        scope: { kind: 'sea' },
        type: 'memory.belief',
        actorId: HARNESS_ACTOR,
        witnesses: [USER_ACTOR, participant.id],
        payload: {
          ownerId: participant.id,
          kind: 'belief',
          text: content,
          ...(provenanceEventId ? { sourceEventIds: [provenanceEventId] } : {}),
        },
        ...(provenanceEventId ? { provenance: { sourceThreadEventIds: [provenanceEventId] } } : {}),
      });
    },
    getDisabledTools: () => new Set(settings.agentMemoryEnabled ? [] : ['save_memory']),
    getWorldContext: (turnText) => renderCompiledContext(
      compileContext({
        participant,
        participants: rosterParticipants(),
        seaEvents: journal.seaEvents(),
        threadEvents: journal.threadEvents(),
        learnerProjection: learnerProjection(),
        threadMedia: activeThread()?.mediaRef,
        ...(turnText ? { turn: { text: turnText } } : {}),
      }),
      rosterParticipants(),
      youLabel(),
    ),
    getVoiceWorldContext: (turnText) => voiceContextPrefetch.resolveFinal(turnText, participant.id),
    getTurnSocialState: () => {
      // Checker verdicts land AFTER the turn's prompt is built (the checker runs
      // post-turn), so a fresh verdict rides the NEXT prompt instead — one-shot.
      // Once consumed or absent, the synchronous heuristic for the current turn
      // applies.
      const checkerVerdict = pendingCheckerSocial;
      pendingCheckerSocial = null;
      return checkerVerdict ?? turnHeuristicSocial;
    },
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
    const customInstructions = translatedInstructions || undefined;
    void enqueueCheckerTask(async () => {
      const result = await checkerAgent.checkMessage(userText, promptLangName(), customInstructions, {
        speakerRole: 'user',
        includeCorrections: settings.agentMistakeChecker,
        includeSafety: settings.agentSafetyChecker,
        languageFeatures: getLanguageFeatures(),
      });
      if (result.error === 'quota' && settings.agentSafetyChecker) { agent.lockSafety(); setIsSafetyLockedState(true); return; }
      if (result.socialClimate) {
        // Describes THIS turn's message but arrives after its prompt was built —
        // applies to the next prompt (see getTurnSocialState).
        pendingCheckerSocial = result.socialClimate;
      }
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

  createEffect(() => {
    if (firstRunModalHandled || !legacyAgentsLoaded() || agents().length > 0) return;
    const snapshot = world();
    if (!snapshot) return;
    firstRunModalHandled = true;
    if (!snapshot.participants.some((participant) => participant.kind === 'persistent')) {
      setShowNewConversationModal(true);
    }
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
    }

    setLegacyAgentsLoaded(true);

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
    setShowNewConversationModal(false);
    await selectRoom(result.roomId, result.threadId);
  };

  const handleUpdateParticipant = async (participant: Participant): Promise<void> => {
    await getBridge().world.updateParticipant(participant);
    setWorld(await getBridge().world.getWorldState());
  };

  const handleDeleteThread = async (): Promise<void> => {
    const room = activeRoom();
    const thread = activeThread();
    if (!room || !thread) return;

    await getBridge().world.deleteThread(room.id, thread.id);
    const snapshot = await getBridge().world.getWorldState();
    setWorld(snapshot);
    setShowDetailsDrawer(false);

    if (snapshot.threads.some((candidate) => candidate.roomId === room.id)) {
      await selectRoom(room.id);
    } else {
      setSelection(null);
    }
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
    const updateActiveThread = async (update: (thread: NonNullable<ReturnType<typeof activeThread>>) => NonNullable<ReturnType<typeof activeThread>>) => {
      const thread = activeThread();
      if (!thread) return;
      const updatedThread = await bridge.world.updateThread(update(thread));
      setWorld((current) => current ? { ...current, threads: current.threads.map((item) => item.id === updatedThread.id ? updatedThread : item) } : current);
    };
    const receiveContext = async (rawCtx: Record<string, unknown>) => {
        if (typeof rawCtx.roomId === 'string') {
          await selectRoom(rawCtx.roomId, typeof rawCtx.threadId === 'string' ? rawCtx.threadId : undefined);
        }
        if (rawCtx.initialTab === 'stats') setShowDetailsDrawer(true);
        if (isConversationAgentContext(rawCtx)) {
          setMediaContext(rawCtx);
          await updateActiveThread((thread) => ({
            ...thread,
            mediaRef: {
              mediaHash: rawCtx.mediaHash,
              mediaName: rawCtx.mediaName,
              mediaType: rawCtx.mediaType,
              assessedLevelName: rawCtx.assessedLevelName || undefined,
              subtitleHistory: rawCtx.subtitleHistory,
              characterContext: rawCtx.characterContext,
            },
          }));
        }
        if (isTutorSessionConfig(rawCtx.tutorConfig)) {
          const config = rawCtx.tutorConfig;
          setTutorSelections({ selectedGrammar: config.selectedGrammar, selectedWords: config.selectedWords });
          translatedInstructions = config.customInstructions || null;
          if (config.customInstructions) {
            await updateActiveThread((thread) => thread.title ? thread : { ...thread, title: config.customInstructions.slice(0, 50) });
          }
        }
        if (typeof rawCtx.initialMessage === 'string' && rawCtx.initialMessage.trim()) {
          setInputText(rawCtx.initialMessage);
          queueMicrotask(() => {
            void handleSend();
          });
        }
    };
    const cleanup = bridge.window.onWindowContext((ctx) => {
      if (isRecord(ctx)) void receiveContext(ctx);
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

  const buildStreamCallbacks = (onDone?: (text: string, tokens: Token[] | undefined, widgets: ChatWidget[] | undefined, streamStats?: StreamStats) => void): StreamCallbacks => {
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
      onDone: (finalContent, tokens, widgets, streamStats) => {
        onDone?.(finalContent, tokens, widgets, streamStats);
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
    turnHeuristicSocial = inferTurnAffect(text, turnSocialOpts(text));
    // Speech end ≈ the final STT result that triggered this send; the LLM
    // request dispatches when the agent turn below reaches processMessage.
    const voiceTurnTiming = isVoiceCallActive() ? { speechEndTs: lastVadSpeechEndTs ?? Date.now(), requestDispatchTs: 0 } : null;
    let prefetchLogged = false;
    const witnesses = [USER_ACTOR, ...room.participantIds];
    const userEvent = await journal.append({ roomId: room.id, scope: { kind: 'thread', threadId }, type: 'message.user', actorId: USER_ACTOR, witnesses, payload: { text, modality: isVoiceCallActive() ? 'voice' : 'text' } satisfies MessagePayload });
    lastUserMessageEventId = userEvent.id;
    lastUserMessageEventRoomId = room.id;
    setLiveOverlay({ role: 'assistant', content: '', timestamp: Date.now() });
    startAssistantStream(displayMessages().length);
    let pendingResponse: { tokens?: Token[]; widgets?: ChatWidget[] } = {};
    await runRoomTurn({
      room,
      participants: world()?.participants ?? [],
      seaEvents: journal.seaEvents(),
      threadEvents: [...journal.threadEvents(), userEvent],
      compileContextFn: (input) => compileContext({ ...input, learnerProjection: learnerProjection(), threadMedia: activeThread()?.mediaRef, turn: { text } }),
      runAgentTurn: async (participantId, context) => {
        const participant = (world()?.participants ?? []).find((candidate) => candidate.id === participantId);
        if (!participant) return { text: '' };
        const runtimeAgent = getParticipantAgent(participant);
        runtimeAgent.loadHistory(windowTruncate(buildLLMHistory(journal.threadEvents(), participant.id, world()?.participants ?? [])));
        if (voiceTurnTiming) voiceTurnTiming.requestDispatchTs = Date.now();
        return new Promise((resolve, reject) => runtimeAgent.processMessage(lastContextMessage(context), [], {
          ...buildStreamCallbacks((final, tokens, widgets, streamStats) => {
            if (voiceTurnTiming && streamStats && !prefetchLogged) {
              prefetchLogged = true;
              const dispatchMs = voiceTurnTiming.requestDispatchTs - voiceTurnTiming.speechEndTs;
              const { cacheHit, compileMs } = voiceContextPrefetch.lastStats();
              log.info('[VoicePrefetch] voice turn', { cacheHit, compileMs, totalMs: dispatchMs + streamStats.timeToFirstToken });
            }
            pendingResponse = { tokens, widgets };
            resolve({ text: final });
          }),
          onError: (error) => reject(new Error(error)),
        }));
      },
      appendEvent: async (draft) => {
        const event = await journal.append(draft.type === 'message.character' && pendingResponse.widgets
          ? { ...draft, payload: { ...(draft.payload as MessagePayload), widgets: pendingResponse.widgets, widget: pendingResponse.widgets[pendingResponse.widgets.length - 1] } }
          : draft);
        if (draft.type === 'message.character' && pendingResponse.tokens?.length) {
          updateMessageOverride(event.id, (message) => ({ ...message, tokens: pendingResponse.tokens }));
        }
        return event;
      },
    });
    setLiveOverlay(null);
    if (settings.agentMistakeChecker || settings.agentSafetyChecker) runCheckerOnMessage(text, userEvent.id, undefined);
    // The turn is over — agent-initiated turns (greetings, nudges) start clean.
    turnHeuristicSocial = null;
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
      ...buildStreamCallbacks(async (text, tokens, widgets) => {
        const event = await journal.append({
          roomId: room.id,
          scope: { kind: 'thread', threadId },
          type: 'message.character',
          actorId: participant.id,
          witnesses: [USER_ACTOR, ...room.participantIds],
          payload: { text, widgets, widget: widgets?.at(-1), modality } satisfies MessagePayload,
        });
        if (tokens?.length) updateMessageOverride(event.id, (message) => ({ ...message, tokens }));
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
            <Btn variant="ghost" class="ca-inline-link" onClick={() => getBridge().window.openWindow({ type: 'settings' })}>
              [{t('mlearn.ConversationAgent.Banner.SettingsLink')}]
            </Btn>
            {' '}
            <Btn variant="ghost" class="ca-inline-link" onClick={() => getBridge().window.openWindow({ type: 'memory-browser' })}>
              [{t('mlearn.MemoryBrowser.OpenInAgent')}]
            </Btn>
            <Show when={settings.agentSafetyChecker}>
              {' '}
              {t('mlearn.ConversationAgent.Banner.TerminationNotice')}
            </Show>
          </p>
        </div>
      </Modal>
      <div class="ca-header">
        <IconBtn
          variant="ghost"
          icon="sidebar"
          onClick={() => setSidebarVisible((visible) => !visible)}
          aria-label={t('mlearn.ConversationAgent.History.ToggleSidebar')}
        />
        <div class="ca-header-identity">
          <span class="ca-header-title">{activeRoom()?.title ?? t('mlearn.ConversationAgent.Title')}</span>
          <Show when={activeThread()?.mediaRef} keyed>
            {(media) => (
              <Btn variant="ghost" class="ca-media-chip" onClick={() => setShowDetailsDrawer(true)}>
                {media.mediaName}
              </Btn>
            )}
          </Show>
        </div>
        <div class="ca-header-spacer" />
        <Btn
          variant="ghost"
          class={`ca-connection-info ${canOpenCloudSignIn() ? 'is-actionable' : ''}`}
          onClick={handleConnectionStatusClick}
          aria-disabled={!canOpenCloudSignIn()}
          aria-label={canOpenCloudSignIn() ? t('mlearn.Connection.SignIn') : undefined}
        >
          <Tag class="ca-provider-label" headless size="sm">{providerLabel()}</Tag>
          <ConnectionStatus
            status={isCheckingConnection() ? 'loading' : isConnected() ? 'connected' : 'disconnected'}
            showLabel={isCheckingConnection() || !isConnected()}
            size="sm"
          />
          <Show when={isCheckingConnection() && server.statusMessage() && server.statusMessage() !== 'Initializing...'}>
            <span class="ca-header-status">{server.statusMessage()}</span>
          </Show>
        </Btn>
        <IconBtn
          variant="ghost"
          icon={<PhoneIcon />}
          disabled={rosterParticipants().length === 0}
          onClick={() => setVoiceOverlayRequested(true)}
          aria-label={t('mlearn.ConversationAgent.Call.StartAria')}
        />
        <div class="ca-overflow-anchor">
          <IconBtn
            ref={(el: HTMLButtonElement) => { overflowAnchorRef = el; }}
            variant="ghost"
            onClick={() => setShowOverflowMenu((open) => !open)}
            aria-label={t('mlearn.ConversationAgent.Menu.OverflowAria')}
          >…</IconBtn>
          <Popover
            open={showOverflowMenu}
            anchor={() => overflowAnchorRef}
            onClose={() => setShowOverflowMenu(false)}
            label={t('mlearn.ConversationAgent.Menu.OverflowAria')}
            class="ca-overflow-menu"
          >
            <Btn variant="ghost" class="ca-overflow-item" onClick={() => { void newThread(); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Menu.NewThread')}</Btn>
            <Btn variant="ghost" class="ca-overflow-item" onClick={() => { setShowDetailsDrawer(true); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Menu.Details')}</Btn>
            <div class="ca-overflow-word-hover">
              <span>{t('mlearn.ConversationAgent.Menu.WordHover')}</span>
              <div>
                <For each={['hover', 'long-hover', 'key-hover'] as const}>
                  {(mode) => <Btn variant="ghost" class={currentTriggerMode() === mode ? 'active' : ''} onClick={() => updateSettings({ readerWordHoverTrigger: mode })}>{mode}</Btn>}
                </For>
              </div>
            </div>
            <Btn variant="ghost" class="ca-overflow-item" onClick={() => { getBridge().window.openWindow({ type: 'settings' }); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Menu.Settings')}</Btn>
            <Btn variant="ghost" class="ca-overflow-item" onClick={() => { getBridge().window.openWindow({ type: 'memory-browser' }); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Menu.MemoryBrowser')}</Btn>
          </Popover>
        </div>
      </div>

      <div class="ca-chat-panel">
          <Show when={sidebarVisible()}>
            <>
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
          onNewConversation={() => { setShowNewConversationModal(true); }}
              />
            </div>
            </>
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
                      label: hasActiveRoomSelection() ? t('mlearn.ConversationAgent.Empty.StartConversation') : t('mlearn.ConversationAgent.Empty.NewConversation'),
                      onClick: hasActiveRoomSelection() ? handleStartConversation : () => setShowNewConversationModal(true),
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
            <Show when={isLowPowerActive()}>
              <div class="ca-lowpower-chip">{t('mlearn.LowPowerGate.StatusBarTooltip')}</div>
            </Show>
          </div>
        </div>

      <Show when={voiceOverlayRequested() || isVoiceCallActive() || voiceAftermath()}>
        <div class="ca-voice-overlay">
          <Show when={voiceAftermath()} fallback={<VoiceTab
              autoStartCall={voiceOverlayRequested()}
              messages={messages()}
              isStreaming={isStreaming()}
              onSendMessage={sendTextMessage}
              onPartialTranscript={(text) => voiceContextPrefetch.onPartial(text, rosterParticipants()[0]?.id ?? '')}
              onRequestGreeting={handleRequestGreeting}
              onIdleSilence={handleVoiceIdleSilence}
              scheduledNudge={voiceScheduledNudge()}
              onAbort={handleAbort}
              onSpeechEnd={(ts) => { lastVadSpeechEndTs = ts; }}
              agentName={rosterParticipants()[0]?.displayName ?? activeAgent()?.agentName}
              profilePhoto={rosterParticipants()[0]?.profilePhoto ?? activeAgent()?.profilePhoto}
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
                    setVoiceOverlayRequested(false);
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
            />}>
          {(aftermath) => (
            <VoiceAftermath
              aftermath={aftermath()}
              onDismiss={() => { setVoiceAftermath(null); setVoiceOverlayRequested(false); }}
            />
          )}
          </Show>
        </div>
      </Show>

      <Show when={showDetailsDrawer()}>
        <>
        <button type="button" class="ca-details-backdrop" aria-label="Close conversation details" onClick={() => setShowDetailsDrawer(false)} />
        <aside class="ca-details-drawer">
          <ThreadInfoPanel
            thread={activeThread()}
            context={mediaContext()}
            participants={rosterParticipants()}
            onUpdateParticipant={handleUpdateParticipant}
            onDeleteThread={handleDeleteThread}
          />
        </aside>
        </>
      </Show>

      {/* Agent setup modal */}
      <AgentSetupModal
        isOpen={showSetupModal()}
        onComplete={handleSetupComplete}
        onClose={() => { setShowSetupModal(false); setEditingAgent(null); }}
        initialConfig={editingAgent()}
      />

      <Show when={showNewConversationModal()}>
        <NewConversationModal
          world={world()}
          onClose={() => setShowNewConversationModal(false)}
          onCreated={(result) => { void handleScenarioCreated(result); }}
        />
      </Show>

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
