import { conversationStreamMessages } from '../../../shared/conversationMessageShape';
import { streamingMessages, type ConversationOverlay } from './conversationStreaming';
import { followsTailAfterScroll, type MessageScrollMetrics } from './messageScroll';
import { sameMessageGroup } from './messageGrouping';
import { tutorSessionIntent } from '../../services/tutorSessionIntent';
/**
 * Conversation Agent Window App Component
 * AI-powered language tutor with tokenized chat, tool calling, and speech I/O
 */

import { For, Component, Show, Index, batch, createSignal, createEffect, createMemo, onMount, onCleanup, untrack } from 'solid-js';
import { WindowWrapper, useSettings, useLanguage, useLocalization, useLowPowerGate, useServer } from '../../context';
import { useFlashcards } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { getTokenLookupWord } from '../../utils/wordForms';
import { useDictionaryTargetLanguage } from '../../hooks/useDictionaryTargetLanguage';
import {
  CloudSessionCancelledError,
  ensureCloudAccessToken,
} from '../../services/cloudSessionManager';
import {
  describeProviderFailure,
  classifyProviderFailure,
  probeProvider,
  type ProviderFailure,
} from '../../services/providerFailure';
import { Button, Modal, EmptyState, ConnectionStatus, Popover, Textarea, Tag, ChatIcon, Avatar, ResponsiveSidebar, SkeletonCard } from '../../components/common';
import { WordHover } from '../../components/subtitle';
import { ExplainerPopup } from '../../components/subtitle/ExplainerPopup';
import { useWordHover, useTranslation, useTokenizer, useDictionary, getCachedTranslation } from '../../hooks';
import { ChatBubble } from './ChatBubble';
import { ThreadInfoPanel } from './ThreadInfoPanel';
import { IntegrationModal } from './IntegrationModal';
import { VoiceTab, type VoiceSpeechMessage } from './VoiceTab';
import { VoiceAftermath } from './VoiceAftermath';

import { AgeVerificationModal } from './AgeVerificationModal';
import { CommandPalette } from './CommandPalette';
import type { SlashCommand } from './CommandPalette';
import { getConversationDisplayLanguageName, getConversationPromptLanguageName } from './languageNames';
import { RoomSidebar } from './RoomSidebar';
import { ParticipantEditorModal } from './ParticipantEditorModal';
import { ContactProfileModal } from './ContactProfileModal';
import { useConversationPreviews } from './useConversationPreviews';
import { createMessagePreparationQueue, messagePreparations } from './messagePreparation';
import { tokenLookupContext, warmTranslationCache } from '../../hooks/useTranslation';
import { RuntimeInspector } from './RuntimeInspector';
import { NewConversationModal } from './NewConversationModal';
import { StoryProgressModal } from './StoryProgressModal';

import { createConversationAgent, type AgentInstance } from '../../services/conversationAgent';
import { createCheckerAgent } from '../../services/checkerAgent';
import { inferTurnAffect } from '../../../shared/socialState';
import type { TurnAffectOptions, TurnSocialState } from '../../../shared/socialState';
import type { StreamCallbacks } from '../../services/conversationAgent';
import type { ConversationMessage, ConversationAgentContext, Token, ChatWidget, DictionaryEntry, TranslationResponse, VoiceMistake, VoiceSessionAftermath, TutorSessionConfig, StreamStats } from '../../../shared/types';
import { DEFAULT_SETTINGS, isRemoteLLMProvider } from '../../../shared/types';
import { isElectron } from '../../../shared/platform';
import { shouldHideAssistantBubble } from './messageState';
import { createJournalThreadStore, eventsToDisplayMessages, buildLLMHistory } from './journalRuntime';
import { runRoomTurn } from '../../../shared/roomOrchestrator';
import { compileContext, visibleThreadEventsFor, type CompiledContext, type LearnerProjection } from '../../../shared/contextCompiler';
import { renderCompiledContext } from './roomMessages';
import { currentFeedbackAgreement, renderFeedbackAgreement } from '../../services/feedbackAgreement';
import { createVoicePrefetch } from './voicePrefetch';
import { HARNESS_ACTOR, USER_ACTOR, sandboxContext, threadContextId, threadParticipants, type MessagePayload, type OpenRoomEventPayload, type Participant, type ThreadMediaRef, type WorldSnapshot, type VoiceDeliveryPayload, type JournalEventDraft, type JournalEvent } from '../../../shared/world';
import { getLearningLanguageLevelForLanguage, getTokenizerCacheNamespace, shouldTokenizeTextForLanguage } from '../../../shared/languageFeatures';
import './ConversationAgent.css';
import { getLogger } from '../../../shared/utils/logger';

const log = getLogger("renderer.conversationAgent.app");
const HISTORY_WINDOW = 40;
const SELECTION_KEY = 'conversation-selection';

const mediaRefFromContext = (context: ConversationAgentContext): ThreadMediaRef => ({
  mediaHash: context.mediaHash,
  mediaName: context.mediaName,
  mediaType: context.mediaType,
  assessedLevelName: context.assessedLevelName || undefined,
  subtitleHistory: context.subtitleHistory,
  characterContext: context.characterContext,
});

type EventMessage = ConversationMessage & { eventId: string; actorId?: string };

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
const TOOL_NAMES = ['correct_mistake', 'create_quiz', 'fetch_url', 'get_conversation_context', 'note_mistake', 'save_memory', 'search_wikipedia'];

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
  const { settings, updateSettings, openCloudReLoginModal, isLoading } = useSettings();
  const server = useServer();
  const {
    currentLangData,
    isTokenTranslatable,
    getLanguageFeatures,
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
  const isValidVoiceMistake = (mistake: VoiceMistake): boolean => {
    const word = mistake.word.trim();
    const context = mistake.context.trim();
    const correction = mistake.correction.trim();
    return Boolean(word && context && correction && context.includes(word));
  };

  const [mediaContext, setMediaContext] = createSignal<ConversationAgentContext | null>(null);
  let translatedInstructions: string | null = null;
  const [pendingTutorConfig, setPendingTutorConfig] = createSignal<TutorSessionConfig>();
  const [inputText, setInputText] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [isCompactingContext] = createSignal(false);

  // Command palette state
  const [showCommandPalette, setShowCommandPalette] = createSignal(false);
  const [commandSelectedIndex, setCommandSelectedIndex] = createSignal(0);
  const [isWaiting, setIsWaiting] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [isCheckingConnection, setIsCheckingConnection] = createSignal(true);
  /**
   * Why the provider cannot be used, when it cannot.
   *
   * `null` while the provider is usable *and* before the first probe resolves,
   * so this is only consulted once `isCheckingConnection` is false - at which
   * point a non-null value is the reason the composer is disabled.
   */
  const [connectionFailure, setConnectionFailure] = createSignal<ProviderFailure | null>(null);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isSpeaking, setIsSpeaking] = createSignal(false);

  const [showSplash, setShowSplash] = createSignal(true);
  const [showDisclaimer, setShowDisclaimer] = createSignal(true);

  // Voice mode state
  const [isVoiceCallActive, setIsVoiceCallActive] = createSignal(false);
  const [voiceMistakes, setVoiceMistakes] = createSignal<VoiceMistake[]>([]);
  const [voiceSessionStart, setVoiceSessionStart] = createSignal<number>(0);
  const [voiceAftermath, setVoiceAftermath] = createSignal<VoiceSessionAftermath | null>(null);


  // Word hover state
  const { hoverData, isVisible, showHover, hideHover, cancelHide, forceHide } = useWordHover();
  const dictionaryTargetLanguage = useDictionaryTargetLanguage();
  const wordLookupOptions = { getCanonicalForm, getWordVariants, getReadingVariants, dictionaryTargetLanguage, languageData: currentLangData };
  const { translateWord } = useTranslation({
    immediate: true,
    language: () => settings.language,
    ...wordLookupOptions,
  });
  const { lookup } = useDictionary({ language: () => settings.language, ...wordLookupOptions });
  const { tokenize: tokenizeCached } = useTokenizer({ language: () => settings.language, languageData: currentLangData });
  const [translationData, setTranslationData] = createSignal<TranslationResponse | null>(null);
  const [dictionaryEntries, setDictionaryEntries] = createSignal<DictionaryEntry[]>([]);
  const [isLoadingDict, setIsLoadingDict] = createSignal(false);
  let hoverRequestId = 0;

  const [integrationRecoveryError, setIntegrationRecoveryError] = createSignal<string | null>(null);
  const [world, setWorld] = createSignal<WorldSnapshot | null>(null);
  const [initializingConversations, setInitializingConversations] = createSignal(true);
  const [selectingConversation, setSelectingConversation] = createSignal(false);
  const [conversationLoadError, setConversationLoadError] = createSignal(false);
  const conversationsLoading = () => initializingConversations() || selectingConversation();
  const [selection, setSelection] = createSignal<{ roomId: string; threadId: string | null } | null>(null);
  // Pending first entry into a persistent Room while Living World is off;
  // the inline confirm routes the user to consent instead of selecting.
  const [livingWorldPrompt, setLivingWorldPrompt] = createSignal<{ roomId: string; threadId?: string } | null>(null);
  const journal = createJournalThreadStore();
  const [liveOverlay, setLiveOverlay] = createSignal<ConversationOverlay | null>(null);
  const [messageOverrides, setMessageOverrides] = createSignal<Map<string, Partial<ConversationMessage>>>(new Map());
  const pendingVoiceMemoryWrites = new Map<string, JournalEventDraft[]>();
  const admittedVoiceSources = new Map<string, JournalEvent>();
  let deliveryWriteQueue: Promise<void> = Promise.resolve();
  let voiceMemoryWriteQueue: Promise<void> = Promise.resolve();
  const readyVoiceMemoryIds = new Set<string>();
  const [failedVoiceMemoryIds, setFailedVoiceMemoryIds] = createSignal<ReadonlySet<string>>(new Set());
  const [activeVoiceSessionId, setActiveVoiceSessionId] = createSignal<string | null>(null);
  const [admittedVoiceEventIds, setAdmittedVoiceEventIds] = createSignal<ReadonlySet<string>>(new Set());
  const supersededEvents = new Set<string>();
  const participantAgents = new Map<string, AgentInstance>();
  const reviewOperations = new Set<string>();
  const restrictedUserEventIds = new Set<string>();
  const pendingMemoryWrites = new Map<string, string[]>();
  const approvedMemoryWrites = new Map<string, string[]>();
  let selectionSession = 0;
  let cancelConversationTurn: (() => void) | null = null;
  let activeTurn: { modality: 'text' | 'voice'; cancelled: boolean; reviews: Set<string> } | null = null;
  onCleanup(() => {
    selectionSession++;
    if (activeTurn) activeTurn.cancelled = true;
    cancelConversationTurn?.();
    cancelConversationTurn = null;
    for (const runtime of participantAgents.values()) runtime.abortStream();
    participantAgents.clear();
    for (const operationId of reviewOperations) void getBridge().world.cancelConversationReview(operationId);
  });
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [sidebarView, setSidebarView] = createSignal<'chats' | 'contacts' | 'practice'>('chats');
  const [addingContact, setAddingContact] = createSignal(false);
  const [showStoryProgress, setShowStoryProgress] = createSignal(false);
  const [contactId, setContactId] = createSignal<string | null>(null);
  const [showRuntimeInspector, setShowRuntimeInspector] = createSignal(false);
  const selectedContact = () => world()?.participants.find(person => person.id === contactId());
  const conversationPreviews = useConversationPreviews(world);
  const publishContact = (person: Participant): void => { setWorld(current => current ? {
    ...current, participants: [...current.participants.filter(item => item.id !== person.id), person],
  } : current); };
  const messageContact = async (person: Participant): Promise<void> => {
    const snapshot = await getBridge().world.getWorldState();
    if (person.kind === 'persistent') {
      const room = snapshot.rooms.filter(item => item.participantIds.length === 1 && item.participantIds[0] === person.id)
        .sort((a, b) => (conversationPreviews.previews()[b.id]?.timestamp ?? b.createdAt) - (conversationPreviews.previews()[a.id]?.timestamp ?? a.createdAt))[0];
      if (room) {
        const threads = snapshot.threads.filter(thread => thread.roomId === room.id && thread.state !== 'archived');
        const latest = [conversationPreviews.previews()[room.id], ...threads.map(thread => conversationPreviews.previews()[`${room.id}/${thread.id}`])]
          .filter(item => item !== undefined).sort((a, b) => b.timestamp - a.timestamp)[0];
        await selectRoom(room.id, latest ? latest.threadId : threads.sort((a, b) => b.createdAt - a.createdAt)[0]?.id); return;
      }
      if (!settings.livingWorldEnabled) {
        openComposer('message', person.id);
        return;
      }
      const created = await getBridge().world.createPersistentRoom({ operationId: crypto.randomUUID(), participantIds: [person.id] });
      await selectRoom(created.id);
    } else {
      const thread = snapshot.threads.filter(item => item.sandbox?.bindings.length === 1 && item.sandbox.bindings[0].baseline.id === person.id && item.state !== 'archived')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (thread) { await selectRoom(thread.id, thread.id); return; }
      const created = await getBridge().world.createSandbox({ operationId: crypto.randomUUID(), participantIds: [person.id] });
      await selectRoom(created.id, created.id);
    }
  };
  const [showNewConversationModal, setShowNewConversationModal] = createSignal(false);
  const [composerParticipantId, setComposerParticipantId] = createSignal<string | undefined>();
  const [newConversationMode, setNewConversationMode] = createSignal<'message' | 'practice' | 'scenario'>('message');
  const openComposer = (mode: 'message' | 'practice' | 'scenario', participantId?: string): void => {
    setComposerParticipantId(participantId);
    setNewConversationMode(mode);
    setShowNewConversationModal(true);
  };
  const [showOverflowMenu, setShowOverflowMenu] = createSignal(false);
  const [showIntegrationModal, setShowIntegrationModal] = createSignal(false);
  let overflowAnchorRef: HTMLButtonElement | undefined;
  const [showDetailsDrawer, setShowDetailsDrawer] = createSignal(false);
  const openDetails = (): void => {
    setShowDetailsDrawer(true);
    void getBridge().world.getWorldState().then(setWorld).catch(error => log.error('Failed to refresh world activity', error));
  };
  const [voiceOverlayRequested, setVoiceOverlayRequested] = createSignal(false);
  const [voiceContactParticipantId, setVoiceContactParticipantId] = createSignal<string | null>(null);
  const [incomingCall, setIncomingCall] = createSignal<{ contactId: string; callId: string; participantId?: string } | null>(null);
  const [contactIngressError, setContactIngressError] = createSignal<string | null>(null);
  const [voiceHeaderStatus, setVoiceHeaderStatus] = createSignal('');
  const callSurfaceOpen = () => Boolean(voiceOverlayRequested() || isVoiceCallActive() || voiceAftermath());
  const callIdentity = () => (voiceContactParticipantId() ? activeVoiceParticipant()?.displayName : rosterParticipants().map(person => person.displayName).join(', '))
    || activeRoom()?.title || t('mlearn.ConversationAgent.Title');
  const [contactEventId, setContactEventId] = createSignal<string | null>(null);
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
  let messageContentRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  createEffect(() => {
    const eventId = contactEventId();
    messages();
    if (!eventId || !messagesRef) return;
    const target = messagesRef.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`);
    if (target) target.scrollIntoView({ block: 'center' });
  });

  const ingestContactOpen = (payload: OpenRoomEventPayload): void => {
    setContactIngressError(payload.contactError ?? null);
    setContactEventId(payload.eventId ?? null);
    if (payload.contactId && payload.callId && !payload.contactError) {
      const participantId = world()?.contacts?.find(contact => contact.contactId === payload.contactId)?.participantId;
      setIncomingCall({ contactId: payload.contactId, callId: payload.callId, participantId });
    } else {
      setIncomingCall(null);
    }
  };

  const respondToIncomingCall = async (response: 'accept' | 'decline'): Promise<void> => {
    const incoming = incomingCall();
    if (!incoming) return;
    const result = await getBridge().world.respondToContact(incoming.contactId, response);
    if (!result.ok) {
      setContactIngressError(result.reason);
      setIncomingCall(null);
      return;
    }
    setWorld(await getBridge().world.getWorldState());
    setIncomingCall(null);
    if (response === 'accept') {
      setVoiceContactParticipantId(result.contact.participantId);
      setVoiceOverlayRequested(true);
    } else {
      setVoiceContactParticipantId(null);
    }
  };

  const langName = () => {
    return getConversationDisplayLanguageName(settings.language, currentLangData(), t, settings.uiLanguage);
  };
  const promptLangName = () => getConversationPromptLanguageName(settings.language, currentLangData());
  const youLabel = () => t('mlearn.Home.Cards.Room.You');
  // Observed media hints stay separate from the learner-authored thread intent.
  // Current canonical knowledge reconciles stale media suggestions. A chosen
  // learning target directs practice; it must never become an ability estimate.
  const learnerProjection = (): LearnerProjection => {
    const media = mediaContext();
    const level = getLearningLanguageLevelForLanguage(settings, settings.language);
    const notSettled = (word: string): boolean => !flashcardCtx.isWordSettledSync(word, settings.language);
    const mediaFailures = [...(media?.failedWords ?? [])]
      .sort((a, b) => a.ease - b.ease)
      .slice(0, 15)
      .map((w) => w.word)
      .filter(notSettled);
    return {
      language: promptLangName(),
      wordsBasis: 'prediction',
      grammarBasis: 'prediction',
      failedWords: [...new Set(mediaFailures)],
      grammarPoints: [
        ...[...(media?.failedGrammar ?? [])].sort((a, b) => a.ease - b.ease).slice(0, 10).map((g) => g.pattern),
      ],
      // Exposure signal only (patterns repeatedly seen, never failed) — kept
      // out of grammarPoints so prediction never masquerades as failure.
      grammarExposure: media?.grammarExposure?.map((g) => g.pattern),
      learningTarget: level !== null ? (getLevelName(level) ?? undefined) : undefined,
    };
  };
  const activeRoom = () => world()?.rooms.find((room) => room.id === selection()?.roomId) ?? (activeThread() ? sandboxContext(activeThread()!) : undefined) ?? null;
  const activeThread = () => world()?.threads.find((thread) => thread.id === selection()?.threadId) ?? null;
  const rosterParticipants = () => {
    const room = activeRoom();
    if (!room) return [];
    if (activeThread()?.sandbox) return threadParticipants(activeThread()!, world()?.participants ?? []);
    const byId = new Map((world()?.participants ?? []).map((participant) => [participant.id, participant]));
    return room.participantIds.map((id) => byId.get(id)).filter((participant): participant is Participant => participant !== undefined);
  };
  const hasActiveRoomSelection = () => selection() !== null && activeRoom() !== null;
  // Voice turns get the same journal-compiled world context as the text path,
  // prefetched speculatively from STT partials (latest-wins cache). The turn
  // text drives bounded turn-specific ranking/budgeting; scopeId keeps each
  // participant's view separate, and the journal-size version invalidates
  // speculative work if the world changed mid-utterance.
  let previousContextWorld: WorldSnapshot | null = null;
  let contextWorldRevision = 0;
  const voiceContextPrefetch = createVoicePrefetch(
    (turnText: string, scopeId: string): CompiledContext => {
      const participant = rosterParticipants().find(candidate => candidate.id === scopeId);
      if (!participant) throw new Error('Conversation participant is unavailable');
      return compileContext({ room: activeRoom() ?? undefined, thread: activeThread() ?? undefined, participant, participants: rosterParticipants(),
        seaEvents: journal.seaEvents(), threadEvents: journal.threadEvents(),
        learnerProjection: learnerProjection(), threadMedia: activeThread()?.mediaRef ?? (mediaContext() ? mediaRefFromContext(mediaContext()!) : undefined),
        threadIntent: activeThread()?.intent, turn: { text: turnText } });
    },
    () => {
      if (world() !== previousContextWorld) { previousContextWorld = world(); contextWorldRevision++; }
      return `${selectionSession}:${contextWorldRevision}:${journal.seaEvents().length}:${journal.threadEvents().length}:${JSON.stringify(learnerProjection())}`;
    },
  );
  let lastUserMessageEventId: string | null = null;
  let lastUserMessageEventRoomId: string | null = null;
  let lastVadSpeechEndTs: number | null = null;
  const displayMessages = createMemo(() => eventsToDisplayMessages(journal.threadEvents(), rosterParticipants(), youLabel())
    .filter((message) => !supersededEvents.has((message as EventMessage).eventId))
    .map((message) => {
      const eventId = (message as EventMessage).eventId;
      const override = messageOverrides().get(eventId);
      if (!message.voiceDelivery) return { ...message, ...override };
      const originalWidgets = message.widgets ?? (message.widget ? [message.widget] : []);
      const preparedWidgets = override?.widgets ?? (override?.widget ? [override.widget] : []);
      const preparations = messagePreparations(message as EventMessage);
      const prepared = override ? messagePreparations({ ...message, ...override } as EventMessage) : [];
      const widgets = originalWidgets.map((widget, index) => {
        const candidate = preparedWidgets[index];
        const text = preparations.find(item => item.widgetIndex === index)?.text;
        return candidate?.type === widget.type && text && prepared.some(item => item.widgetIndex === index && item.text === text)
          ? { ...widget, data: { ...widget.data, tokens: candidate.data.tokens } } : widget;
      });
      return { ...message, ...override, content: message.content, generatedContent: message.generatedContent,
        voiceDelivery: message.voiceDelivery, interrupted: message.interrupted,
        tokens: override?.content === message.content ? override.tokens : undefined,
        widgets: widgets.length ? widgets : undefined, widget: widgets.at(-1) };
    }));
  const messages = createMemo(() => [...displayMessages(), ...streamingMessages(liveOverlay())]);
  const speechMessages = createMemo<VoiceSpeechMessage[]>(() => displayMessages().flatMap(message => {
    const eventMessage = message as EventMessage & { modality?: 'voice'; voiceSessionId?: string };
    if (!admittedVoiceEventIds().has(eventMessage.eventId) || eventMessage.modality !== 'voice' || !eventMessage.voiceSessionId || !eventMessage.actorId
      || message.role !== 'assistant' || message.interrupted || message.isError) return [];
    return [{ eventId: eventMessage.eventId, actorId: eventMessage.actorId, voiceSessionId: eventMessage.voiceSessionId,
      content: message.generatedContent ?? message.content, voiceSampleId: rosterParticipants().find(person => person.id === eventMessage.actorId)?.voiceSampleId }];
  }));
  const [streamingMessageIndex, setStreamingMessageIndex] = createSignal<number | null>(null);
  const updateMessageOverride = (eventId: string, update: (message: ConversationMessage) => ConversationMessage) => {
    const message = displayMessages().find((item) => (item as EventMessage).eventId === eventId);
    if (!message) return;
    setMessageOverrides((overrides) => new Map(overrides).set(eventId, update(message)));
  };

  const [annotationFailed, setAnnotationFailed] = createSignal(false);
  const [annotationRetry, setAnnotationRetry] = createSignal(0);
  const [visibleMessageRevision, setVisibleMessageRevision] = createSignal(0);
  const messageElements = new Set<HTMLElement>();
  const visibleMessageElements = new Set<HTMLElement>();
  let messageObserver: IntersectionObserver | undefined;
  const registerMessage = (element: HTMLDivElement): void => {
    messageElements.add(element); messageObserver?.observe(element);
    onCleanup(() => { messageObserver?.unobserve(element); messageElements.delete(element); visibleMessageElements.delete(element); });
  };
  const preparation = createMessagePreparationQueue({
    tokenize: tokenizeCached,
    apply: (id, text, tokens, widgetIndex) => {
      const message = displayMessages().find(item => (item as EventMessage).eventId === id);
      if (!message) return;
      if (widgetIndex === undefined) {
        if (message.content === text && message.tokens !== tokens) updateMessageOverride(id, current => ({ ...current, tokens }));
      } else {
        updateMessageOverride(id, current => {
          const widgets = [...(current.widgets ?? (current.widget ? [current.widget] : []))];
          const widget = widgets[widgetIndex];
          if (!widget || !messagePreparations(current as EventMessage).some(item => item.widgetIndex === widgetIndex && item.text === text)) return current;
          widgets[widgetIndex] = { ...widget, data: { ...widget.data, tokens } };
          return { ...current, widgets, widget: widgets.at(-1) };
        });
      }
    },
    warm: async tokens => {
      const capabilities = getLanguageFeatures().tokenizerCapabilities;
      const words = tokens.filter(isTokenTranslatable).map(token => getTokenLookupWord(token, capabilities)).filter(Boolean);
      await warmTranslationCache(words, undefined, undefined, settings.language, dictionaryTargetLanguage(), currentLangData(), { throwOnFailure: true });
    },
    onError: error => { setAnnotationFailed(true); log.warn('Message annotation unavailable', error); },
  });
  onCleanup(() => preparation.dispose());
  onMount(() => {
    if (typeof IntersectionObserver !== 'function') return;
    messageObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleMessageElements.add(entry.target as HTMLElement);
        else visibleMessageElements.delete(entry.target as HTMLElement);
      }
      setVisibleMessageRevision(value => value + 1);
    }, { root: messagesRef, rootMargin: '600px 0px' });
    for (const element of messageElements) messageObserver.observe(element);
    onCleanup(() => { messageObserver?.disconnect(); messageElements.clear(); visibleMessageElements.clear(); });
  });
  createEffect(() => {
    visibleMessageRevision();
    const languageData = currentLangData();
    const selected = selection();
    preparation.reset(JSON.stringify([selected?.roomId, selected?.threadId, settings.language, getTokenizerCacheNamespace(languageData), dictionaryTargetLanguage(), annotationRetry()]));
    const visibleIds = new Set([...visibleMessageElements].map(element => element.dataset.eventId));
    const displayed = displayMessages() as EventMessage[];
    // Prepare the current tail immediately; older text enters through the scroll
    // viewport plus overscan. Loading a long archive never queues every word.
    const candidates = displayed.filter((message, index) => (index >= displayed.length - HISTORY_WINDOW || visibleIds.has(message.eventId))
      && message.eventId !== (liveOverlay() as EventMessage | null)?.eventId
      && (message.role === 'assistant' || message.role === 'user'));
    preparation.enqueue(candidates.slice().reverse().flatMap(messagePreparations)
      .filter(item => shouldTokenizeTextForLanguage(item.text, settings.language, languageData)));
  });

  const providerLabel = () => {
    switch (settings.llmProvider) {
      case 'cloud': return t('mlearn.AI.Settings.Provider.Cloud');
      case 'openai-compatible': return t('mlearn.AI.Settings.Provider.OpenAICompatible');
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

  const getParticipantAgent = (participant: Participant, compiled?: CompiledContext): AgentInstance => {
    const cached = participantAgents.get(participant.id);
    if (cached && !compiled) return cached;
    const runtimeSession = selectionSession;
    const runtimeAgent = createConversationAgent({
    getInteractionMode: () => activeThread()?.interactionMode ?? activeRoom()?.interactionMode ?? 'social',
    getTraceContext: () => ({ source: isVoiceCallActive() ? 'voice' : 'conversation', roomId: selection()?.roomId, threadId: selection()?.threadId ?? undefined, participantId: participant.id, sourceEventId: lastUserMessageEventId ?? undefined }),
    getSettings: () => settings,
    tokenize: tokenizeCached,
    getLanguage: () => settings.language,
    getLanguageName: () => promptLangName(),
    getLanguageData: currentLangData,
    getLanguageFeatures: () => getLanguageFeatures(),
    getObservedLearnerText: () => {
      if (runtimeSession !== selectionSession) return '';
      const event = journal.threadEvents().find(candidate => candidate.id === lastUserMessageEventId
        && candidate.type === 'message.user' && candidate.actorId === USER_ACTOR);
      return event ? (event.payload as MessagePayload).text : '';
    },
    flashcardCtx,
    isVoiceMode: isVoiceCallActive,
    onVoiceMistake: (mistake: VoiceMistake) => {
      if (runtimeSession !== selectionSession) return;
      if (!isValidVoiceMistake(mistake)) return;
      setVoiceMistakes((prev) => [...prev, mistake]);
      // Grammar evidence requires a real pattern: the note_mistake tool has no
      // pattern field, and tracking a bare word would pollute the grammar store.
      if (mistake.type === 'grammar' && getGrammarPoint(mistake.word)) {
        flashcardCtx.trackGrammarFailed(mistake.word);
      }
    },
    onVoiceNudgeScheduled: (nudge) => {
      if (runtimeSession === selectionSession) scheduleVoiceNudge(nudge);
    },
    onMemorySaved: (content: string) => {
      if (runtimeSession !== selectionSession) return;
      pendingMemoryWrites.set(participant.id, [...(pendingMemoryWrites.get(participant.id) ?? []), content]);
    },
    getDisabledTools: () => new Set(settings.agentMemoryEnabled ? [] : ['save_memory']),
    getWorldContext: (turnText) => renderCompiledContext(
      compiled ?? compileContext({
        room: activeRoom() ?? undefined,
        thread: activeThread() ?? undefined,
        participant: rosterParticipants().find(item => item.id === participant.id) ?? participant,
        participants: rosterParticipants(),
        seaEvents: journal.seaEvents(),
        threadEvents: journal.threadEvents(),
        learnerProjection: learnerProjection(),
        threadMedia: activeThread()?.mediaRef ?? (mediaContext() ? mediaRefFromContext(mediaContext()!) : undefined), threadIntent: activeThread()?.intent,
        ...(turnText ? { turn: { text: turnText } } : {}),
      }),
      rosterParticipants(),
      youLabel(),
    ) + renderFeedbackAgreement(currentFeedbackAgreement(journal.threadEvents())),
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

  const activeVoiceParticipant = () => rosterParticipants().find(item => item.id === voiceContactParticipantId())
      ?? rosterParticipants()[0];
  const activeRuntimeAgent = () => {
    const participant = activeVoiceParticipant();
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
    const room = activeRoom();
    const threadId = selection()?.threadId;
    const session = selectionSession;
    const initialPracticeIntent = activeThread()?.intent;
    const recentConversation = displayMessages().filter(message => !message.isError && (message.role === 'user' || message.role === 'assistant'))
      .slice(-12).map(message => ({ role: message.role as 'user' | 'assistant', content: message.content.slice(-4000) }));
    const includeCorrections = settings.agentMistakeChecker && (activeThread()?.interactionMode ?? activeRoom()?.interactionMode ?? 'social') === 'practice';
    void enqueueCheckerTask(async () => {
      // Earlier queued checks may have committed a changed agreement. Read the
      // captured conversation, bounded to this message, when this task runs.
      const feedbackEvents = includeCorrections && room
        ? threadId ? await getBridge().journal.readThread(room.id, threadId)
          : await getBridge().journal.readSeaProjection(room.id)
        : [];
      const feedbackAgreement = currentFeedbackAgreement(feedbackEvents, messageEventId);
      const result = await checkerAgent.checkMessage(userText, promptLangName(), customInstructions, {
        speakerRole: 'user',
        includeCorrections,
        ...(includeCorrections ? { recentConversation, initialPracticeIntent, feedbackAgreement } : {}),
        includeSafety: settings.agentSafetyChecker,
        languageFeatures: getLanguageFeatures(),
      });
      if (result.feedbackAgreement && room) {
        await getBridge().journal.appendEvent(room.id, { roomId: room.id,
          scope: threadId ? { kind: 'thread', threadId } : { kind: 'sea' }, type: 'feedback.agreement',
          actorId: HARNESS_ACTOR, witnesses: [USER_ACTOR, ...room.participantIds],
          payload: { sourceEventId: messageEventId, ...result.feedbackAgreement } });
        if (session === selectionSession) await journal.refresh();
      }
      if (session !== selectionSession) return;
      if (result.error === 'quota' && settings.agentSafetyChecker) { agent.lockSafety(); setIsSafetyLockedState(true); return; }
      if (result.socialClimate) {
        // Describes THIS turn's message but arrives after its prompt was built —
        // applies to the next prompt (see getTurnSocialState).
        pendingCheckerSocial = result.socialClimate;
      }
      if (result.corrections.length === 0 && !result.safety) {
        return;
      }

      if (!room) return;
      const witnesses = [USER_ACTOR, ...room.participantIds];
      if (result.corrections.length) await journal.append({ roomId: room.id, scope: threadId ? { kind: 'thread', threadId } : { kind: 'sea' }, type: 'correction', actorId: HARNESS_ACTOR, witnesses, payload: { messageEventId, corrections: result.corrections } });
      if (result.safety) {
        agent.lockSafety(); setIsSafetyLockedState(true);
        await journal.append({ roomId: room.id, scope: threadId ? { kind: 'thread', threadId } : { kind: 'sea' }, type: 'safety_flag', actorId: HARNESS_ACTOR, witnesses, payload: { messageEventId, flag: result.safety } });
      }
    });
  };

  let initialSelection: Promise<void> = Promise.resolve();
  let contextIngress: Promise<void> = Promise.resolve();
  const loadConversations = async (): Promise<void> => {
    setInitializingConversations(true);
    setConversationLoadError(false);
    const session = selectionSession;
    try {
      const snapshot = await getBridge().world.getWorldState();
      if (session !== selectionSession) return;
      setWorld(snapshot);
      let saved: { roomId?: string; threadId?: string } | null = null;
      try {
        const raw = await getBridge().kvStore.kvGet(SELECTION_KEY);
        if (raw) saved = JSON.parse(raw);
      } catch (error) { log.warn('Unable to restore conversation selection', error); }
      if (session !== selectionSession) return;
      const savedThread = snapshot.threads.find(thread => thread.id === saved?.threadId
        && threadContextId(thread) === saved?.roomId);
      const eligibleSavedThread = settings.livingWorldEnabled || savedThread?.sandbox ? savedThread : undefined;
      const sandboxes = snapshot.threads.filter(thread => thread.sandbox && thread.state !== 'archived')
        .sort((a, b) => b.createdAt - a.createdAt);
      const roomId = settings.livingWorldEnabled
        ? (eligibleSavedThread ? threadContextId(eligibleSavedThread) : (snapshot.rooms.find(room => room.id === saved?.roomId)?.id
          ?? snapshot.rooms.slice().sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? sandboxes[0]?.id))
        : (eligibleSavedThread?.id ?? sandboxes[0]?.id);
      if (roomId) await selectRoom(roomId, eligibleSavedThread?.id);
    } catch (error) {
      if (session === selectionSession) setConversationLoadError(true);
      log.error('Unable to load conversations', error);
    } finally {
      setInitializingConversations(false);
    }
  };
  onMount(() => { initialSelection = loadConversations(); });

  onMount(() => {
    let stopped = false, frame: number | undefined, revision = 0;
    const unsubscribe = getBridge().world.onChanged(notice => {
      conversationPreviews.refresh(notice);
      // No polling: coalesce committed changes without clearing the visible chat.
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const current = ++revision;
        void getBridge().world.getWorldState().then(snapshot => {
          if (!stopped && current === revision) setWorld(snapshot);
        }).catch(error => log.error('Unable to refresh contacts', error));
        void journal.refresh().catch(error => log.error('Unable to refresh conversation', error));
      });
    });
    onCleanup(() => { stopped = true; revision++; unsubscribe(); if (frame !== undefined) cancelAnimationFrame(frame); });
  });

  const draftBySelection = new Map<string, string>();
  const [draftReadyKey, setDraftReadyKey] = createSignal<string | null>(null);
  let draftWrites: Promise<void> = Promise.resolve();
  createEffect(() => {
    const key = draftReadyKey();
    const text = inputText();
    if (!key) return;
    draftBySelection.set(key, text);
    // Serialize writes: a slower earlier edit must not replace the newest draft.
    draftWrites = draftWrites.then(() => getBridge().kvStore.kvSet(`conversation-draft:${key}`, JSON.stringify({ text })))
      .catch(error => log.error('Unable to save conversation draft', error));
  });
  const scrollBySelection = new Map<string, number>();
  let pendingScrollKey: string | null = null;
  const selectionKey = (roomId: string, threadId: string | null) => `${roomId}:${threadId ?? ''}`;
  const selectRoom = async (roomId: string, requestedThreadId?: string): Promise<void> => {
    const current = selection();
    const targetThreadId = requestedThreadId ?? (activeThread()?.sandbox && current?.roomId === roomId ? current.threadId : null);
    if (current?.roomId === roomId && current.threadId === targetThreadId && !selectingConversation() && !conversationLoadError()) {
      // Opening the current chat/call must not tear down its pending reply.
      await journal.refresh();
      setSidebarVisible(false);
      return;
    }
    const mySession = ++selectionSession;
    batch(() => {
      setIsVoiceCallActive(false);
      setActiveVoiceSessionId(null);
      setAdmittedVoiceEventIds(new Set<string>());
      setVoiceAftermath(null);
      setVoiceOverlayRequested(false);
      setVoiceContactParticipantId(null);
    });
    if (activeTurn) activeTurn.cancelled = true;
    activeTurn = null;
    setDraftReadyKey(null);
    cancelConversationTurn?.();
    cancelConversationTurn = null;
    setConversationLoadError(false);
    try {
      for (const operationId of reviewOperations) void getBridge().world.cancelConversationReview(operationId);
      reviewOperations.clear();
      restrictedUserEventIds.clear(); pendingMemoryWrites.clear(); approvedMemoryWrites.clear();
      const previous = selection();
      if (previous) {
        const key = selectionKey(previous.roomId, previous.threadId);
        draftBySelection.set(key, inputText());
        if (messagesRef) scrollBySelection.set(key, messagesRef.scrollTop);
      }
      setSelectingConversation(true);
      const snapshot = await getBridge().world.getWorldState();
      if (mySession !== selectionSession) return;
      setWorld(snapshot);
      const selectedSandbox = snapshot.threads.find(thread => thread.sandbox && thread.id === roomId && (!requestedThreadId || thread.id === requestedThreadId));
      const room = snapshot.rooms.find((candidate) => candidate.id === roomId) ?? (selectedSandbox ? sandboxContext(selectedSandbox) : undefined);
      if (!room) return;
      const requestedThread = requestedThreadId ? snapshot.threads.find(thread => thread.id === requestedThreadId && threadContextId(thread) === roomId) : undefined;
      if (requestedThreadId && !requestedThread) throw new Error('Conversation is unavailable');
      // First entry into a persistent Room (non-sandbox) requires Living World
      // consent; disposable sandboxes are exempt. Declining selects nothing.
      if (!selectedSandbox && !settings.livingWorldEnabled) {
        setLivingWorldPrompt({ roomId, threadId: requestedThreadId });
        return;
      }
      const threadId = selectedSandbox?.id ?? requestedThread?.id ?? null;
      cancelVoiceScheduledNudge();
      setMediaContext(null);
      translatedInstructions = null;
      pendingCheckerSocial = null;
      turnHeuristicSocial = null;
      for (const runtime of participantAgents.values()) runtime.abortStream();
      agent.abortStream();
      clearAssistantStreamState();
      agent.unlockSafety();
      setIsSafetyLockedState(false);
      setLiveOverlay(null);
      setMessageOverrides(new Map());
      setAnnotationFailed(false);
      participantAgents.clear();
      setSidebarView((selectedSandbox?.interactionMode ?? requestedThread?.interactionMode ?? snapshot.rooms.find(item => item.id === roomId)?.interactionMode) === 'practice' ? 'practice' : 'chats');
      const key = selectionKey(roomId, threadId);
      pendingScrollKey = scrollBySelection.has(key) ? key : null;
      setSelection({ roomId, threadId });
      if (!draftBySelection.has(key)) {
        try {
          await draftWrites;
          const rawDraft = await getBridge().kvStore.kvGet(`conversation-draft:${key}`);
          const savedDraft: unknown = rawDraft ? JSON.parse(rawDraft) : null;
          if (isRecord(savedDraft) && typeof savedDraft.text === 'string') draftBySelection.set(key, savedDraft.text);
        } catch (error) { log.error('Unable to restore conversation draft', error); }
        if (mySession !== selectionSession) return;
      }
      // The first selection can finish while a learner has already begun typing
      // in the visible composer. Do not erase that draft on initial hydration.
      if (previous || !inputText()) setInputText(draftBySelection.get(key) ?? '');
      setDraftReadyKey(key);
      await journal.select({ roomId, threadId, continuityRoomIds: selectedSandbox ? Object.keys(selectedSandbox.sandbox!.baselineHeads) : snapshot.rooms.map(item => item.id), baselineHeads: selectedSandbox?.sandbox?.baselineHeads });
      if (mySession !== selectionSession) return;
      await getBridge().kvStore.kvSet(SELECTION_KEY, JSON.stringify({ roomId, threadId }));
      if (!selectedSandbox) await getBridge().world.clearRoomUnread(roomId);
      setWorld((current) => current ? { ...current, rooms: current.rooms.map((item) => item.id === roomId ? { ...item, unreadCount: 0 } : item) } : current);
      setSidebarVisible(false);
    } catch (error) {
      if (mySession === selectionSession) setConversationLoadError(true);
      throw error;
    } finally {
      if (mySession === selectionSession) setSelectingConversation(false);
    }
  };

  // Creation runs only through the canonical New Conversation boundary; the
  // legacy Room-linked createThread entry is gone. Existing room-linked
  // threads (including legacy-migrated ones) remain listed and selectable.
  const handleScenarioCreated = async (result: { roomId: string; threadId: string | null; intent?: string }): Promise<void> => {
    const launchMedia = mediaContext();
    const snapshot = await getBridge().world.getWorldState();
    setWorld(snapshot);
    await selectRoom(result.roomId, result.threadId ?? undefined);
    if (launchMedia) {
      setMediaContext(launchMedia);
      const thread = activeThread();
      if (result.threadId && thread?.id === result.threadId) {
        const updatedThread = await getBridge().world.updateThread({ ...thread, mediaRef: mediaRefFromContext(launchMedia) });
        setWorld((current) => current ? {
          ...current,
          threads: current.threads.map((item) => item.id === updatedThread.id ? updatedThread : item),
        } : current);
      }
    }
    const tutor = pendingTutorConfig();
    if (tutor) {
      translatedInstructions = tutor.customInstructions || null;
      setPendingTutorConfig(undefined);
    }
    setShowNewConversationModal(false);
    setComposerParticipantId(undefined);
    // Creation publishes setup context. The next actual exchange consumes it;
    // setup is not submitted to the turn engine as a synthetic user action.
  };

  // Consent for a blocked persistent-Room entry: enabling persists the
  // setting through the settings bridge, then retries the original selection.
  const enableLivingWorldAndEnter = async (): Promise<void> => {
    const prompt = livingWorldPrompt();
    setLivingWorldPrompt(null);
    if (!prompt) return;
    updateSettings({ livingWorldEnabled: true });
    try {
      await selectRoom(prompt.roomId, prompt.threadId);
    } catch (error) {
      log.error('Unable to open conversation', error);
    }
  };


  const handleUpdateParticipant = async (participant: Participant): Promise<void> => {
    await getBridge().world.updateParticipant(participant, activeThread()?.sandbox ? activeThread()!.id : undefined);
    participantAgents.delete(participant.id);
    setWorld(await getBridge().world.getWorldState());
  };

  const handleRenameThread = async (title: string): Promise<void> => {
    const thread = activeThread();
    if (!thread) return;
    const updatedThread = await getBridge().world.updateThread({ ...thread, title: title || undefined });
    setWorld((current) => current ? { ...current, threads: current.threads.map((item) => item.id === updatedThread.id ? updatedThread : item) } : current);
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
    if (isLoading()) {
      setIsCheckingConnection(true);
      return;
    }
    // Track reactive dependencies so the effect re-runs on change
    void settings.ollamaUrl;
    void settings.ollamaModel;
    void settings.cloudAuthAccessToken;
    void settings.cloudAuthToken;
    void settings.cloudAuthStatus;
    void settings.cloudApiUrl;
    void settings.overrideCloudEndpointUrl;
    void settings.compatibleApiBaseUrl;
    void settings.compatibleApiKey;
    void settings.compatibleModel;

    setIsCheckingConnection(true);

    (async () => {
      // One probe, one classification. This effect used to dispatch a
      // reachability check per provider inline and collapse every outcome -
      // including a thrown one - into a boolean, so the window could only say
      // "Disconnected" and never what was wrong. The classified record is kept
      // so the status chip can name the failure and the send button can be
      // disabled for the reason the learner has to fix.
      const classified = await probeProvider(settings);
      setConnectionFailure(classified);
      setIsConnected(!classified);
      setIsCheckingConnection(false);
    })();
  });

  // Listen for model status changes (e.g., download completes)
  onMount(() => {
    const bridge = getBridge();

    const cleanupStatus = bridge.llm.onLLMModelStatus((status: { downloaded: boolean; ready: boolean }) => {
      if (settings.llmProvider === 'builtin') {
        setIsConnected(status.ready);
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
        await initialSelection;
        if (typeof rawCtx.roomId === 'string') {
          await selectRoom(rawCtx.roomId, typeof rawCtx.threadId === 'string' ? rawCtx.threadId : undefined);
        }
        if (typeof rawCtx.roomId === 'string') {
          ingestContactOpen(rawCtx as unknown as OpenRoomEventPayload);
        }
        if (rawCtx.initialTab === 'stats') setShowDetailsDrawer(true);
        if (isConversationAgentContext(rawCtx)) {
          setMediaContext(rawCtx);
          // A media-only launch must not relabel the previously selected
          // conversation. Attach context only when the caller names a thread;
          // otherwise let the learner create a distinct conversation.
          if (typeof rawCtx.threadId === 'string' && activeThread()?.id === rawCtx.threadId) {
            await updateActiveThread((thread) => ({ ...thread, mediaRef: mediaRefFromContext(rawCtx) }));
          } else {
            openComposer('practice');
          }
        }
        if (isTutorSessionConfig(rawCtx.tutorConfig)) {
          const config = rawCtx.tutorConfig;
          setPendingTutorConfig(config);
          openComposer('practice');
        }
        if (typeof rawCtx.initialMessage === 'string' && rawCtx.initialMessage.trim()) {
          setInputText(rawCtx.initialMessage);
          queueMicrotask(() => {
            void handleSend();
          });
        }
    };
    const cleanup = bridge.window.onWindowContext((ctx) => {
      if (isRecord(ctx)) contextIngress = contextIngress.then(() => receiveContext(ctx)).catch(error => log.error('Unable to open conversation context', error));
    });
    bridge.window.getWindowContext('conversation-agent');
    if (cleanup) onCleanup(cleanup);
    const cleanupOpen = bridge.window.onOpenRoomEvent((payload) => {
      void selectRoom(payload.roomId, payload.threadId).then(() => ingestContactOpen(payload)).catch(error => log.error('Unable to open conversation', error));
    });
    if (cleanupOpen) onCleanup(cleanupOpen);
  });

  // Dictionary hydration and new messages must not pull a reader away from history.
  const [followingTail, setFollowingTail] = createSignal(true);
  let scrollFrame: number | undefined;
  let lastScrollMetrics: MessageScrollMetrics | undefined;
  const handleMessageScroll = (element: HTMLDivElement): void => {
    const current = { top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight };
    setFollowingTail(followsTailAfterScroll(followingTail(), lastScrollMetrics, current));
    lastScrollMetrics = current;
  };
  createEffect(() => { selection()?.roomId; selection()?.threadId; lastScrollMetrics = undefined; setFollowingTail(true); });
  const scrollToLatest = (): void => {
    setFollowingTail(true);
    if (messagesRef) messagesRef.scrollTop = messagesRef.scrollHeight;
  };
  const scheduleMessageScroll = (): void => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    if (conversationsLoading()) return;
    const restoreKey = pendingScrollKey;
    const session = selectionSession;
    if (!restoreKey && !untrack(followingTail)) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined;
      if (session !== selectionSession || !messagesRef) return;
      if (restoreKey && pendingScrollKey === restoreKey) {
        // Restore only after real messages replace the loading skeletons.
        pendingScrollKey = null;
        messagesRef.scrollTop = scrollBySelection.get(restoreKey)!;
        setFollowingTail(messagesRef.scrollHeight - messagesRef.clientHeight - messagesRef.scrollTop < 80);
      } else if (followingTail()) messagesRef.scrollTop = messagesRef.scrollHeight;
      lastScrollMetrics = { top: messagesRef.scrollTop, height: messagesRef.scrollHeight, viewport: messagesRef.clientHeight };
    });
  };
  createEffect(() => { messages(); scheduleMessageScroll(); });
  onMount(() => {
    const observer = new ResizeObserver(() => scheduleMessageScroll());
    if (messageContentRef) observer.observe(messageContentRef);
    if (messagesRef) observer.observe(messagesRef);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => { if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame); });

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
    if (isRemoteLLMProvider(settings.llmProvider)) return true;
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
    if (window.getSelection()?.isCollapsed === false || !isTokenTranslatable(token)) return;

    const lookupWord = getTokenLookupWord(token, getLanguageFeatures().tokenizerCapabilities);
    const requestId = ++hoverRequestId;

    // Show immediately with cached data if available
    const cached = getCachedTranslation(lookupWord, settings.language, { ...wordLookupOptions, context: tokenLookupContext(token) });
    setTranslationData(cached ?? null);
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
        const result = await translateWord(lookupWord, tokenLookupContext(token));
        if (requestId !== hoverRequestId) return;
        if (result) {
          setTranslationData(result);
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

  const providerErrorOverlay = (error: unknown): ConversationOverlay => {
    const failure = classifyProviderFailure(error, settings.llmProvider);
    const description = describeProviderFailure(error, t, settings.llmProvider);
    return {
      role: 'assistant',
      content: failure.id === 'unknown' ? t(failure.key) : description,
      timestamp: Date.now(),
      isError: true,
      recovery: failure.recovery === 'settings' ? 'settings' : undefined,
    };
  };

  const buildStreamCallbacks = (onDone?: (text: string, tokens: Token[] | undefined, widgets: ChatWidget[] | undefined, streamStats?: StreamStats) => void, keepStreaming = false, ownsTurn: () => boolean = () => true): StreamCallbacks => {
    const session = selectionSession;
    const current = () => session === selectionSession && ownsTurn();
    let streamTokenizeId = 0;
    let streamTokenizeTimer: ReturnType<typeof setTimeout> | null = null;
    const finishAnnotation = (): void => {
      if (streamTokenizeTimer) clearTimeout(streamTokenizeTimer);
      streamTokenizeTimer = null;
      streamTokenizeId++;
    };
    return {
      onChunk: (accumulated) => {
        if (!current()) return;
        setIsWaiting(false);
        const beats = conversationStreamMessages(stripPartialToolCall(accumulated));
        const visibleContent = beats.join('\n\n');
        setLiveOverlay((overlay) => overlay ? { ...overlay, content: visibleContent, beats } : overlay);

        if (visibleContent.trim()) {
          if (streamTokenizeTimer) clearTimeout(streamTokenizeTimer);
          streamTokenizeTimer = setTimeout(() => {
            const tokenizeId = ++streamTokenizeId;
            agent.tokenize(visibleContent).then((tokens) => {
              if (!current() || tokenizeId !== streamTokenizeId) return;
              if (tokens.length > 0) setLiveOverlay((overlay) => overlay ? { ...overlay, tokens: (overlay.beats?.length ?? 0) > 1 ? undefined : tokens } : overlay);
            }).catch(error => log.warn('Stream annotation unavailable', error));
          }, 300);
        }
      },
      onToolCall: (widget: ChatWidget) => {
        if (!current()) return;
        setIsWaiting(false);
        setLiveOverlay((overlay) => {
          if (!overlay) return overlay;
          const widgets = [...(overlay.widgets ?? (overlay.widget ? [overlay.widget] : [])), widget];
          return { ...overlay, widgets, widget };
        });
      },
      onDone: (finalContent, tokens, widgets, streamStats) => {
        finishAnnotation();
        if (!current()) return;
        onDone?.(finalContent, tokens, widgets, streamStats);
        if (!keepStreaming) clearAssistantStreamState();
      },
      onError: (error) => {
        finishAnnotation();
        if (!current()) return;
        log.error('Conversation response failed', error);
        clearAssistantStreamState();
        setLiveOverlay(providerErrorOverlay(error));
      },
    };
  };

  const runConversationTurn = async (text: string, contextOnly = false, modality: 'text' | 'voice' = isVoiceCallActive() ? 'voice' : 'text'): Promise<void> => {
    const voiceSessionId = modality === 'voice' ? activeVoiceSessionId() ?? undefined : undefined;
    if (!text || activeTurn || isStreaming() || isSafetyLockedState()) return;
    const session = selectionSession;
    const turn = { modality, cancelled: false, reviews: new Set<string>() };
    activeTurn = turn;
    const ownsTurn = () => session === selectionSession && activeTurn === turn && !turn.cancelled;
    // Reserve before preflight: teardown must also cancel a call waiting for
    // credentials, settings, or context, and a second send cannot race it.
    startAssistantStream(displayMessages().length);
    try {
      await initialSelection;
      if (!ownsTurn()) return;
      await contextIngress;
      if (!ownsTurn()) return;
      const room = activeRoom();
      const threadId = selection()?.threadId;
      if (!room) {
        const snapshot = await getBridge().world.getWorldState();
        if (!ownsTurn()) return;
        const firstRoom = snapshot.rooms[0];
        if (!firstRoom) return;
        setWorld(snapshot);
        // Consent boundary: a first send must not enter a persistent Room while
        // Living World is off; it targets a disposable sandbox instead, if any.
        const fallbackThread = settings.livingWorldEnabled ? undefined : snapshot.threads.find(thread => thread.sandbox);
        if (!settings.livingWorldEnabled && !fallbackThread) return;
        turn.cancelled = true;
        activeTurn = null;
        clearAssistantStreamState();
        await selectRoom(fallbackThread ? fallbackThread.id : firstRoom.id);
        return runConversationTurn(text, contextOnly, modality);
      }
      if (isRemoteLLMProvider(settings.llmProvider)) {
        try {
          if (settings.llmProvider === 'cloud') {
            const accessToken = await ensureCloudAccessToken({ interactive: true });
            if (!ownsTurn()) return;
            if (!accessToken) throw new CloudSessionCancelledError();
          }
          if (isElectron()) await getBridge().settings.awaitSettingsSaved();
          if (!ownsTurn()) return;
        } catch (error) {
          if (ownsTurn()) setLiveOverlay(providerErrorOverlay(error));
          return;
        }
      }
      cancelVoiceScheduledNudge();
      turnHeuristicSocial = inferTurnAffect(text, turnSocialOpts(text));
      // Speech end ≈ the final STT result that triggered this send; the LLM
      // request dispatches when the agent turn below reaches processMessage.
      const voiceTurnTiming = isVoiceCallActive() ? { speechEndTs: lastVadSpeechEndTs ?? Date.now(), requestDispatchTs: 0 } : null;
      let prefetchLogged = false;
      const witnesses = [USER_ACTOR, ...room.participantIds];
      const previousSourceEventId = lastUserMessageEventRoomId === room.id ? lastUserMessageEventId : null;
      const userEvent = contextOnly ? null : await journal.append({ roomId: room.id, scope: threadId ? { kind: 'thread', threadId } : { kind: 'sea' }, type: 'message.user', actorId: USER_ACTOR, witnesses, payload: { text, modality } satisfies MessagePayload });
      if (!ownsTurn()) return;
      const memorySourceEventId = userEvent?.id ?? previousSourceEventId;
      lastUserMessageEventId = userEvent?.id ?? null;
      lastUserMessageEventRoomId = room.id;
      setLiveOverlay({ role: 'assistant', content: '', timestamp: Date.now() });
      startAssistantStream(displayMessages().length);
      let pendingResponse: { tokens?: Token[]; widgets?: ChatWidget[] } = {};
      await runRoomTurn({
        thread: activeThread() ?? undefined,
        room,
        ...(contextOnly ? { contextTurn: { text, threadId: threadId ?? undefined } } : {}),
        modality,
        initialSpeakerId: modality === 'voice' ? voiceContactParticipantId() ?? undefined : undefined,
        participants: rosterParticipants(),
        seaEvents: journal.seaEvents(),
        threadEvents: journal.threadEvents(),
        compileContextFn: (input) => modality === 'voice' ? voiceContextPrefetch.resolveFinal(text, input.participant.id) : compileContext({ ...input, thread: activeThread() ?? undefined, learnerProjection: learnerProjection(), threadMedia: activeThread()?.mediaRef ?? (mediaContext() ? mediaRefFromContext(mediaContext()!) : undefined), threadIntent: activeThread()?.intent, turn: { text } }),
        runAgentTurn: async (participantId, context) => {
          const participant = rosterParticipants().find((candidate) => candidate.id === participantId);
          if (!participant) return { text: '' };
          if (!ownsTurn()) throw new Error('Conversation response cancelled');
          setLiveOverlay({ role: 'assistant', content: '', timestamp: Date.now(), displayName: participant.displayName, actorId: participant.id });
          setStreamingMessageIndex(displayMessages().length);
          const runtimeAgent = getParticipantAgent(participant, context);
          pendingMemoryWrites.delete(participant.id);
          runtimeAgent.loadHistory(windowTruncate(buildLLMHistory(
            visibleThreadEventsFor(participant, journal.threadEvents().filter(event => !restrictedUserEventIds.has(event.id)),
              activeThread()?.sandbox ? [] : journal.seaEvents().filter(event => !restrictedUserEventIds.has(event.id))), participant.id, rosterParticipants())));
          if (voiceTurnTiming) voiceTurnTiming.requestDispatchTs = Date.now();
          const history = runtimeAgent.getHistory();
          const last = history.at(-1);
          const currentText = contextOnly ? text : last?.content ?? lastContextMessage(context);
          if (!contextOnly && last) runtimeAgent.popHistory(1);
          return new Promise((resolve, reject) => {
            const cancel = () => reject(new Error('Conversation response cancelled'));
            cancelConversationTurn = cancel;
            runtimeAgent.processMessage(currentText, [], {
              ...buildStreamCallbacks((final, tokens, widgets, streamStats) => {
                void (async () => {
                  if (!ownsTurn()) throw new Error('Conversation response cancelled');
                  if (voiceTurnTiming && streamStats && !prefetchLogged) {
                    prefetchLogged = true;
                    const dispatchMs = voiceTurnTiming.requestDispatchTs - voiceTurnTiming.speechEndTs;
                    const { cacheHit, compileMs } = voiceContextPrefetch.lastStats();
                    log.info('[VoicePrefetch] voice turn', { cacheHit, compileMs, totalMs: dispatchMs + streamStats.timeToFirstToken });
                  }
                    if (!isElectron()) { pendingResponse = { tokens, widgets }; approvedMemoryWrites.set(participant.id, pendingMemoryWrites.get(participant.id) ?? []); resolve({ text: final }); return; }
                  const operationId = crypto.randomUUID();
                  reviewOperations.add(operationId);
                  turn.reviews.add(operationId);
                  try {
                    const result = await getBridge().world.reviewConversationTurn({ operationId, roomId: room.id,
                      threadId: threadId ?? undefined, participantId: participant.id, sourceEventId: userEvent?.id,
                      userText: text, assistantText: final,
                      auxiliaryText: widgets?.length ? JSON.stringify(widgets).slice(0, 12_000) : undefined,
                      recent: history.filter(message => message.role === 'user' || message.role === 'assistant')
                        .slice(-12).map(message => ({ role: message.role as 'user' | 'assistant', content: message.content.slice(-4000) })),
                      repairContext: renderCompiledContext(context, rosterParticipants(), youLabel()).slice(0, 30_000),
                      language: promptLangName() });
                    if (!ownsTurn()) throw new Error('Conversation response cancelled');
                    if (result.status === 'unavailable') throw new Error(result.error);
                    if (result.restrictUserContext && userEvent) restrictedUserEventIds.add(userEvent.id);
                    if (result.status === 'support') { pendingResponse = {}; pendingMemoryWrites.delete(participant.id); resolve({ text: t('mlearn.ConversationAgent.Story.SupportResponse'), reviewEvent: result.reviewEvent }); return; }
                    pendingResponse = result.status === 'approved' ? { tokens, widgets } : {};
                    if (result.status === 'approved' && !result.restrictUserContext) approvedMemoryWrites.set(participant.id, pendingMemoryWrites.get(participant.id) ?? []);
                    else pendingMemoryWrites.delete(participant.id);
                    resolve({ text: result.text, reviewEvent: result.reviewEvent });
                  } finally { reviewOperations.delete(operationId); turn.reviews.delete(operationId); }
                })().catch(reject).finally(() => {
                  if (cancelConversationTurn === cancel) cancelConversationTurn = null;
                });
              }, true, ownsTurn),
              onError: (error) => {
                if (cancelConversationTurn === cancel) cancelConversationTurn = null;
                reject(new Error(error));
              },
            });
          });
        },
        appendEvent: async (draft, shape) => {
          if (!ownsTurn()) throw new Error('Conversation response cancelled');
          const scopedDraft = draft.type === 'message.character' && modality === 'voice'
            ? { ...draft, payload: { ...(draft.payload as MessagePayload), voiceSessionId, voiceDelivery: 'tracked' as const } } : draft;
          const event = await journal.append(scopedDraft.type === 'message.character' && pendingResponse.widgets && (!shape || shape.index === shape.count - 1)
            ? { ...scopedDraft, payload: { ...(scopedDraft.payload as MessagePayload), widgets: pendingResponse.widgets, widget: pendingResponse.widgets[pendingResponse.widgets.length - 1] } }
            : scopedDraft);
          if (!ownsTurn()) throw new Error('Conversation response cancelled');
          if (draft.type === 'message.character') setLiveOverlay(null);
          if (draft.type === 'message.character') {
            const writes = approvedMemoryWrites.get(draft.actorId) ?? [];
            approvedMemoryWrites.delete(draft.actorId); pendingMemoryWrites.delete(draft.actorId);
            for (const content of writes) {
              const sourceEventId = memorySourceEventId && !restrictedUserEventIds.has(memorySourceEventId) ? memorySourceEventId : null;
              const sourceEventIds = [...(sourceEventId ? [sourceEventId] : []), ...(modality === 'voice' ? [event.id] : [])];
              const memoryDraft: JournalEventDraft = { roomId: room.id, scope: threadId ? { kind: 'thread', threadId } : { kind: 'sea' },
                type: 'memory.belief', actorId: HARNESS_ACTOR, witnesses: [USER_ACTOR, draft.actorId],
                payload: { ownerId: draft.actorId, kind: 'belief', text: content,
                  ...(sourceEventIds.length ? { sourceEventIds } : {}) } };
              if (modality === 'voice') pendingVoiceMemoryWrites.set(event.id, [...(pendingVoiceMemoryWrites.get(event.id) ?? []), memoryDraft]);
              else void journal.append(memoryDraft).catch(error => log.error('Conversation memory write failed', error));
            }
          }
          if (draft.type === 'message.character' && modality === 'voice') {
            admittedVoiceSources.set(event.id, event);
            setAdmittedVoiceEventIds(previous => new Set([...previous, event.id]));
          }
          if (draft.type === 'message.character' && contextOnly && modality === 'text' && settings.autoSpeak && settings.speechEnabled) {
            speakAssistantText((draft.payload as MessagePayload).text);
          }
          if (draft.type === 'message.character' && modality !== 'voice' && pendingResponse.tokens?.length && (!shape || shape.count === 1)) {
            updateMessageOverride(event.id, (message) => ({ ...message, tokens: pendingResponse.tokens }));
          }
          return event;
        },
      });
      if (!ownsTurn()) return;
      setLiveOverlay(null);
      if (userEvent && (settings.agentMistakeChecker || settings.agentSafetyChecker)) runCheckerOnMessage(text, userEvent.id);
      if (userEvent && modality !== 'voice') {
        // Automatic scoped reflection (MEM-02): the completed encounter
        // triggers main-owned consolidation of this context; the snapshot
        // refresh makes evolved scenario state reach the next turn.
        const triggerContext = threadId ? { roomId: threadId, threadId } : { roomId: room.id };
        void getBridge().world.triggerReflection(triggerContext)
          .then(() => getBridge().world.getWorldState())
          .then((snapshot) => { if (session === selectionSession) setWorld(snapshot); })
          .catch(() => undefined);
      }
    } catch (error) {
      if (ownsTurn()) {
        log.error('Conversation turn failed', error);
        setLiveOverlay(providerErrorOverlay(error));
      }
    } finally {
      if (activeTurn === turn) {
        activeTurn = null;
        clearAssistantStreamState();
        turnHeuristicSocial = null;
      }
    }
  };

  const saveDeliveredVoiceMemories = (eventId: string): Promise<void> => {
    const write = voiceMemoryWriteQueue.then(async () => {
      if (!readyVoiceMemoryIds.has(eventId)) return;
      const drafts = pendingVoiceMemoryWrites.get(eventId) ?? [];
      while (drafts.length) {
        const draft = drafts[0];
        await getBridge().journal.appendEvent(draft.roomId, draft);
        drafts.shift(); // Retire each note only after its own durable ACK.
      }
      pendingVoiceMemoryWrites.delete(eventId);
      readyVoiceMemoryIds.delete(eventId);
      setFailedVoiceMemoryIds(previous => new Set([...previous].filter(id => id !== eventId)));
    }).catch(error => {
      log.error('Conversation voice memory write failed', error);
      setFailedVoiceMemoryIds(previous => new Set([...previous, eventId]));
    });
    voiceMemoryWriteQueue = write;
    return write;
  };

  const persistVoiceDelivery = (delivery: VoiceDeliveryPayload): Promise<void> => {
    const source = admittedVoiceSources.get(delivery.messageEventId);
    if (!source || source.actorId !== delivery.actorId || (source.payload as MessagePayload).voiceSessionId !== delivery.voiceSessionId) {
      return Promise.reject(new Error('Voice delivery source is unavailable'));
    }
    const session = selectionSession;
    const draft: JournalEventDraft = { roomId: source.roomId, scope: source.scope, type: 'delivery.voice',
      actorId: HARNESS_ACTOR, witnesses: [...source.witnesses], payload: delivery };
    const write = deliveryWriteQueue.then(async () => {
      if (session === selectionSession) await journal.append(draft);
      else await getBridge().journal.appendEvent(source.roomId, draft);
    });
    deliveryWriteQueue = write.catch(() => undefined);
    // Delivery is already committed. Notes/reflection are separate operations with their own recovery.
    void write.then(() => {
      if (delivery.state !== 'playing') admittedVoiceSources.delete(source.id);
      if (delivery.state === 'completed') {
        readyVoiceMemoryIds.add(source.id);
        void saveDeliveredVoiceMemories(source.id);
      } else if (delivery.state !== 'playing') pendingVoiceMemoryWrites.delete(source.id);
      if (delivery.state !== 'playing') {
        const triggerContext = source.scope.kind === 'thread'
          ? { roomId: source.scope.threadId, threadId: source.scope.threadId } : { roomId: source.roomId };
        void getBridge().world.triggerReflection(triggerContext)
          .then(() => getBridge().world.getWorldState())
          .then(snapshot => { if (session === selectionSession) setWorld(snapshot); }).catch(() => undefined);
      }
    }).catch(() => undefined);
    return write;
  };

  const sendTextMessage = (text: string): Promise<void> => runConversationTurn(text);
  const runContextTurn = (context: string, modality: 'text' | 'voice' = 'text'): Promise<void> =>
    runConversationTurn(context, true, modality);

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
    if (!canActOnConnection()) return;
    const failure = connectionFailure();
    if (failure?.recovery === 'settings' && settings.llmProvider === 'cloud') {
      openCloudReLoginModal();
      return;
    }
    // Every other unusable provider is repaired where it is configured, not
    // in a re-authentication flow that only the cloud provider has.
    getBridge().window.openWindow({ type: 'settings' });
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

  const abortCallResponse = () => {
    // Call teardown owns only turns begun in that call. A completed text
    // response may still be awaiting review when the learner opens a call.
    const turn = activeTurn;
    if (!turn || turn.modality !== 'voice') return;
    turn.cancelled = true;
    activeTurn = null;
    selectionSession++;
    for (const operationId of turn.reviews) {
      void getBridge().world.cancelConversationReview(operationId);
      reviewOperations.delete(operationId);
    }
    turn.reviews.clear();
    cancelConversationTurn?.();
    cancelConversationTurn = null;
    for (const runtime of participantAgents.values()) runtime.abortStream();
    participantAgents.clear();
    pendingMemoryWrites.clear(); approvedMemoryWrites.clear();
    turnHeuristicSocial = null;
    setLiveOverlay(null);
    clearAssistantStreamState();
  };

  const handleAbort = () => {
    // Invalidate callbacks before cancelling inference or review. A completed
    // provider response is still cancellable until it enters the journal.
    selectionSession++;
    if (activeTurn) activeTurn.cancelled = true;
    activeTurn = null;
    for (const runtime of participantAgents.values()) runtime.abortStream();
    participantAgents.clear();
    for (const operationId of reviewOperations) void getBridge().world.cancelConversationReview(operationId);
    reviewOperations.clear();
    cancelConversationTurn?.();
    cancelConversationTurn = null;
    pendingMemoryWrites.clear(); approvedMemoryWrites.clear();
    setLiveOverlay(null);
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
    if (e.isComposing || e.keyCode === 229) return;
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
    if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const normalizeQuizAnswer = (answer: string): string => answer.trim().toLocaleLowerCase();

  const pendingWidgetAnswers = new Set<string>();
  const handleQuizAnswer = async (messageIndex: number, widgetIndex: number, answer: string) => {
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
    const room = activeRoom();
    const threadId = selection()?.threadId;
    const responseKey = `${eventId}:${widgetIndex}`;
    if (!eventId || !room || !targetWidget || targetWidget.type !== 'quiz'
      || targetWidget.resolved || pendingWidgetAnswers.has(responseKey)) return;
    const responseSession = selectionSession;
    pendingWidgetAnswers.add(responseKey);
    try {
      await journal.append({ roomId: room.id, scope: threadId ? { kind: 'thread', threadId } : { kind: 'sea' },
        type: 'widget.response', actorId: USER_ACTOR, witnesses: [USER_ACTOR, ...room.participantIds],
        payload: { messageEventId: eventId, widgetIndex, userAnswer: answer, isCorrect: quizIsCorrect } });
    } catch (error) {
      log.error('Unable to save quiz answer', error);
      setLiveOverlay(providerErrorOverlay(error));
      return;
    } finally {
      pendingWidgetAnswers.delete(responseKey);
    }
    if (responseSession !== selectionSession) return;
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

  /**
   * The label for a provider that cannot be used.
   *
   * This used to be a fixed "Disconnected", which is a statement about the
   * socket rather than about the learner's situation: a wrong API key, an
   * unselected model, an expired cloud session and an unreachable host all
   * render the same word, and the only one of them with a next step available
   * in the window (re-authentication) was reachable from a chip that looked
   * identical to the three dead ends. The classified failure carries both the
   * sentence and the recovery, so the chip can offer the right one.
   */
  const connectionLabel = (): string => {
    if (isCheckingConnection()) return t('mlearn.ConnectionStatus.Connecting');
    if (isConnected()) return t('mlearn.ConnectionStatus.Connected');
    return t(connectionFailure()?.key ?? 'mlearn.ConnectionStatus.Disconnected');
  };

  /**
   * What clicking the status chip should do.
   *
   * Driven by the failure's recovery rather than by the provider, so a cloud
   * session that expired offers sign-in and every other unusable provider
   * offers the AI settings where its fix lives. A failure with no recovery the
   * window can offer keeps the chip inert rather than pretending otherwise.
   */
  const canActOnConnection = (): boolean => (
    !isCheckingConnection()
    && !isConnected()
    && connectionFailure()?.recovery === 'settings'
  );

  const ConnectionInfo: Component<{ details?: boolean }> = (props) => (
    <Button
          variant="ghost"
          class={`ca-connection-info ${canActOnConnection() ? 'is-actionable' : ''}`}
          onClick={handleConnectionStatusClick}
          aria-disabled={!canActOnConnection()}
          aria-label={`${providerLabel()} · ${connectionLabel()}`}
        >
          <Tag class="ca-provider-label" headless size="sm">{providerLabel()}</Tag>
          <ConnectionStatus
            status={isCheckingConnection() ? 'loading' : isConnected() ? 'connected' : 'disconnected'}
            showLabel={isCheckingConnection() || !isConnected()}
            size="sm"
          />
          <Show when={props.details && !isCheckingConnection() && !isConnected()}>
            <span class="ca-connection-reason">{connectionLabel()}</span>
          </Show>
          <Show when={isCheckingConnection() && server.statusMessage() && server.statusMessage() !== 'Initializing...'}>
            <span class="ca-header-status">{t('mlearn.Global.Status.StartingBackend')}</span>
          </Show>
        </Button>
  );

  const ConversationHeader: Component = () => (
    <div class="ca-header">
        <Show when={!callSurfaceOpen()}><Button buttonType="icon"
          variant="ghost"
          class="ca-sidebar-toggle"
          icon="sidebar"
          onClick={() => setSidebarVisible((visible) => !visible)}
          aria-label={t('mlearn.ConversationAgent.History.ToggleSidebar')}
          aria-controls="conversation-sidebar" aria-expanded={sidebarVisible()}
        /></Show>
        <div class="ca-header-identity">
          <Button variant="ghost" class="ca-header-contact" onClick={() => {
            if (rosterParticipants().length === 1 && !activeThread()?.sandbox) setContactId(rosterParticipants()[0].id);
            else openDetails();
          }} disabled={!activeRoom()}>
            <Show when={rosterParticipants().length === 1}><Avatar size="sm" name={rosterParticipants()[0].displayName} src={rosterParticipants()[0].profilePhoto} /></Show>
            <span class="ca-header-title" title={callSurfaceOpen() ? callIdentity() : activeRoom()?.title}>{callSurfaceOpen() ? callIdentity() : activeRoom()?.title ?? t('mlearn.ConversationAgent.Title')}</span>
          </Button>
          <Show when={callSurfaceOpen()}>
            <span class="ca-call-header-state" role="status" aria-live="polite">{voiceAftermath() ? t('mlearn.ConversationAgent.Voice.Aftermath.Title') : voiceHeaderStatus() || t('mlearn.ConversationAgent.Voice.CheckingModels')}</span>
          </Show>
          <Show when={!callSurfaceOpen() && (activeThread()?.mediaRef ?? (mediaContext() ? mediaRefFromContext(mediaContext()!) : undefined))} keyed>
            {(media) => (
              <Button variant="ghost" class="ca-media-chip" onClick={openDetails}>
                {media.mediaName}
              </Button>
            )}
          </Show>
        </div>
        <Show when={!callSurfaceOpen()}><ConnectionInfo /></Show>
        <Show when={!callSurfaceOpen()}><Button buttonType="icon"
          variant="ghost"
          icon={<PhoneIcon />}
          disabled={rosterParticipants().length === 0}
          onClick={() => { setContactIngressError(null); setVoiceOverlayRequested(true); }}
          aria-label={t('mlearn.ConversationAgent.Call.StartAria')}
        /></Show>
        <div class="ca-overflow-anchor">
          <Button buttonType="icon"
            ref={(el: HTMLButtonElement) => { overflowAnchorRef = el; }}
            variant="ghost"
            onClick={() => setShowOverflowMenu((open) => !open)}
            aria-label={t('mlearn.ConversationAgent.Menu.OverflowAria')}
          >…</Button>
          <Popover
            open={showOverflowMenu}
            anchor={() => overflowAnchorRef}
            onClose={() => setShowOverflowMenu(false)}
            label={t('mlearn.ConversationAgent.Menu.OverflowAria')}
            class="ca-overflow-menu"
          >
            <div class="ca-provider-details"><ConnectionInfo details /></div>
            <p class="ca-ai-notice">{t('mlearn.ConversationAgent.Disclaimer')}</p>
            <Button variant="ghost" class="ca-overflow-item" onClick={() => { openComposer('message'); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Contacts.NewMessage')}</Button>
            <Button variant="ghost" class="ca-overflow-item" onClick={() => { openComposer('practice'); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Contacts.NewPractice')}</Button>
            <Button variant="ghost" class="ca-overflow-item" onClick={() => { openComposer('scenario'); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Contacts.NewScenario')}</Button>
            <Button variant="ghost" class="ca-overflow-item" onClick={() => { openDetails(); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Menu.Details')}</Button>
            <Button variant="ghost" class="ca-overflow-item" onClick={() => { getBridge().window.openWindow({ type: 'settings' }); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Menu.Settings')}</Button>
            <Button variant="ghost" class="ca-overflow-item" onClick={() => { getBridge().window.openWindow({ type: 'memory-browser' }); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Menu.MemoryBrowser')}</Button>
            <Button variant="ghost" class="ca-overflow-item" onClick={() => { setAddingContact(true); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Contacts.Add')}</Button>
            <Show when={settings.devMode}><Button variant="ghost" class="ca-overflow-item" onClick={() => { setShowRuntimeInspector(true); setShowOverflowMenu(false); }}>{t('mlearn.ConversationAgent.Developer.Title')}</Button></Show>
          </Popover>
        </div>
      </div>
  );

  return (
    <div class="conversation-agent" classList={{ 'has-call-surface': callSurfaceOpen() }}>
      <Show when={integrationRecoveryError()}><p class="integration-error" role="alert">{integrationRecoveryError()}</p></Show>
      <For each={world()?.integrations?.filter(record => record.status !== 'committed')}>
        {(record) => <div class="integration-error" role="status">
          <span>{t(record.status === 'pending' ? 'mlearn.ConversationAgent.Integration.Pending' : 'mlearn.ConversationAgent.Integration.Interrupted')} {record.note}</span>
          <Show when={record.status === 'interrupted'}>
            <details>
              <summary>{t('mlearn.ConversationAgent.Integration.CurrentWorldState')}</summary>
              <p>{t('mlearn.ConversationAgent.Integration.PeopleLabel')}: {record.adoptParticipantIds.map(id => {
                const person = world()?.participants.find(item => item.id === id);
                return `${person?.displayName ?? id}: ${t(person ? 'mlearn.ConversationAgent.Integration.Present' : 'mlearn.ConversationAgent.Integration.Absent')}`;
              }).join(', ')}</p>
              <p>{t('mlearn.ConversationAgent.Integration.CurrentRoster')}: {world()?.rooms.find(room => room.id === record.destinationRoomId)?.participantIds.map(id => world()?.participants.find(person => person.id === id)?.displayName ?? id).join(', ')}</p>
              <p>{t('mlearn.ConversationAgent.Integration.ScenarioLabel')}: {t(world()?.rooms.some(room => room.id === record.destinationRoomId && room.scenarioRef === record.integrationId) ? 'mlearn.ConversationAgent.Integration.Present' : 'mlearn.ConversationAgent.Integration.Absent')}</p>
            </details>
          </Show>
          <Show when={record.status === 'pending'}>
            <Button onClick={async () => {
              try {
                await getBridge().world.integrateThread({ integrationId: record.integrationId,
                  threadId: record.sourceThreadId, destinationRoomId: record.destinationRoomId,
                  memoryEventIds: record.memoryEventIds, adoptParticipantIds: record.adoptParticipantIds,
                  includeScenario: record.includeScenario });
              } catch (error) { setIntegrationRecoveryError(String(error)); }
              finally { setWorld(await getBridge().world.getWorldState()); }
            }}>{t('mlearn.ConversationAgent.Integration.Retry')}</Button>
          </Show>
        </div>}
      </For>
      <Show when={showSplash() && isRemoteLLMProvider(settings.llmProvider)}>
        <AgeVerificationModal onAccept={() => setShowSplash(false)} />
      </Show>
      <Modal
        isOpen={showDisclaimer() && !isRemoteLLMProvider(settings.llmProvider)}
        onClose={() => setShowDisclaimer(false)}
        title={t('mlearn.ConversationAgent.Title')}
        closeOnOverlay={false}
        closeOnEscape={false}
        showCloseButton={false}
        size="md"
        footer={
          <Button variant="primary" size="lg" onClick={() => setShowDisclaimer(false)}>
            {t('mlearn.ConversationAgent.AgeVerification.ContinueButton')}
          </Button>
        }
      >
        <div class="ca-disclaimer">
          <p class="ca-disclaimer__warning">
            {t('mlearn.ConversationAgent.Banner.AIWarning')}
          </p>
          <p>
            {t('mlearn.ConversationAgent.Banner.LocalPrivacyNotice')}
          </p>
          <p>
            {t('mlearn.ConversationAgent.Banner.SafetyNotice', { status: t(settings.agentSafetyChecker ? 'mlearn.ConversationAgent.Banner.StatusOn' : 'mlearn.ConversationAgent.Banner.StatusOff') })}
            <Show when={settings.agentSafetyChecker}>
              {' '}
              {t('mlearn.ConversationAgent.Banner.TerminationNotice')}
            </Show>
          </p>
          <div class="ca-disclaimer__links">
            <Button variant="default" size="sm" onClick={() => getBridge().window.openWindow({ type: 'settings' })}>
              {t('mlearn.ConversationAgent.Banner.SettingsLink')}
            </Button>
            <Button variant="default" size="sm" onClick={() => getBridge().window.openWindow({ type: 'memory-browser' })}>
              {t('mlearn.MemoryBrowser.OpenInAgent')}
            </Button>
          </div>
        </div>
      </Modal>
      <Show when={callSurfaceOpen()}><ConversationHeader /></Show>

      <div class="ca-chat-panel">
          <ResponsiveSidebar id="conversation-sidebar" label={t('mlearn.ConversationAgent.History.ToggleSidebar')}
            title={t('mlearn.ConversationAgent.Sidebar.Title')} open={sidebarVisible()} onOpenChange={setSidebarVisible} class="ca-history-sidebar">
            <RoomSidebar world={world()} loading={initializingConversations() && !world()} loadError={conversationLoadError() && !world()} view={sidebarView()} roomId={selection()?.roomId ?? null} threadId={selection()?.threadId ?? null}
              previews={conversationPreviews.previews()} previewsError={conversationPreviews.error()} previewLoading={conversationPreviews.isLoading}
              onSelectRoom={roomId => { void selectRoom(roomId).catch(error => setContactIngressError(String(error))); }}
              onSelectThread={threadId => { const thread = world()?.threads.find(item => item.id === threadId); if (thread) void selectRoom(threadContextId(thread), threadId).catch(error => setContactIngressError(String(error))); }}
              onNewConversation={() => openComposer('message')} onPractice={() => openComposer('practice')} onAddContact={() => setAddingContact(true)}
              onStoryProgress={() => setShowStoryProgress(true)}
              onViewChange={setSidebarView}
              onSelectContact={person => setContactId(person.id)} />
          </ResponsiveSidebar>
          <div class="ca-chat-content">
            <Show when={!callSurfaceOpen()}><ConversationHeader /></Show>
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
            <div class="ca-messages" aria-busy={conversationsLoading()} ref={messagesRef} onScroll={event => handleMessageScroll(event.currentTarget)}
              onPointerDown={event => { if (event.button === 0) forceHide(); }}
              onPointerMove={event => { if (event.buttons & 1) forceHide(); }}>
              <div class="ca-message-content" ref={messageContentRef}>
              <Show when={!conversationsLoading()} fallback={
                <div class="ca-history-loading" role="status" aria-label={t('mlearn.Global.Loading')}>
                  <SkeletonCard title={false} lines={2} animate={false} class="ca-history-placeholder user" />
                  <SkeletonCard title={false} lines={4} animate={false} class="ca-history-placeholder" />
                  <SkeletonCard title={false} lines={2} animate={false} class="ca-history-placeholder user" />
                </div>
              }>
              <Show when={!conversationLoadError()} fallback={
                <EmptyState icon={<ChatIcon size={24} />} title={t('mlearn.ConversationAgent.ErrorTitle')}
                  action={{ label: t('mlearn.Global.Retry'), onClick: () => {
                    const selected = selection();
                    if (selected) void selectRoom(selected.roomId, selected.threadId ?? undefined).catch(error => log.error('Unable to retry conversation', error));
                    else initialSelection = loadConversations();
                  }, variant: 'primary' }} class="ca-empty ca-history-error" />
              }>
              <Show
                when={messages().length > 0}
                fallback={
                  <EmptyState
                    icon={<ChatIcon size={24} />}
                    title={t('mlearn.ConversationAgent.Empty.Title')}
                    description={t(hasActiveRoomSelection() ? 'mlearn.ConversationAgent.Empty.ReadyHint' : 'mlearn.ConversationAgent.Empty.Hint', { lang: langName() })}
                    action={{
                      label: hasActiveRoomSelection() ? t('mlearn.ConversationAgent.Empty.StartConversation') : t(sidebarView() === 'practice' ? 'mlearn.ConversationAgent.Contacts.NewPractice' : 'mlearn.ConversationAgent.Contacts.NewMessage'),
                      onClick: hasActiveRoomSelection() ? handleStartConversation : () => openComposer(sidebarView() === 'practice' ? 'practice' : 'message'),
                      variant: 'primary',
                    }}
                    class="ca-empty"
                  />
                }
              >
                <Index each={messages()}>
                  {(msg, index) => (
                    <Show when={!isEmptyToolOnlyBubble(index)}>
                      <div
                        ref={registerMessage}
                        data-event-id={(msg() as EventMessage).eventId}
                        class={`ca-message-row${sameMessageGroup(messages()[index - 1] as EventMessage, msg() as EventMessage) ? ' ca-message-continuation' : ''}${(msg() as EventMessage).eventId === contactEventId() ? ' ca-contact-target' : ''}`}
                      >
                        <ChatBubble
                          message={msg()}
                          showSpeaker={rosterParticipants().length > 1 && !sameMessageGroup(messages()[index - 1] as EventMessage, msg() as EventMessage)}
                          showAvatar={!sameMessageGroup(msg() as EventMessage, messages()[index + 1] as EventMessage)}
                          showTimestamp={!sameMessageGroup(msg() as EventMessage, messages()[index + 1] as EventMessage)}
                          isStreaming={msg().role === 'assistant' && index === messages().length - 1 && liveOverlay() !== null && isStreaming()}
                          isWaiting={isWaiting() && msg().role === 'assistant' && index === messages().length - 1 && liveOverlay() !== null}
                          studyMode={(activeThread()?.interactionMode ?? activeRoom()?.interactionMode) === 'practice' && currentFeedbackAgreement(journal.threadEvents())?.active !== false}
                          onTokenHover={handleTokenHover}
                          onTokenLeave={handleTokenLeave}
                          triggerMode={currentTriggerMode()}
                          triggerKey={currentKey()}
                          onQuizAnswer={(widgetIndex, answer) => handleQuizAnswer(index, widgetIndex, answer)}
                          onRegenerate={undefined}
                          onErrorRecovery={(msg() as ConversationOverlay).recovery === 'settings'
                            ? () => { void getBridge().window.openWindow({ type: 'settings' }); }
                            : undefined}
                          avatarSrc={rosterParticipants().length === 1 ? rosterParticipants()[0]?.profilePhoto : undefined}
                        />
                      </div>
                    </Show>
                  )}
                </Index>
              </Show>
              </Show>
              </Show>
              </div>
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
                  lookupContext={tokenLookupContext(data.token)}
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

            <Show when={isSafetyLockedState()}>
              <div class="ca-safety-lockout">
                {t('mlearn.ConversationAgent.Safety.LockoutMessage')}
              </div>
            </Show>
            <Show when={!followingTail()}><Button variant="secondary" size="sm" class="ca-jump-latest" onClick={scrollToLatest}>{t('mlearn.ConversationAgent.Contacts.Latest')}</Button></Show>
            <Show when={annotationFailed()}><div class="ca-annotation-notice" role="status">
              <span>{t('mlearn.ConversationAgent.Contacts.AnnotationUnavailable')}</span>
              <Button size="sm" variant="ghost" onClick={() => { setAnnotationFailed(false); setAnnotationRetry(value => value + 1); }}>{t('mlearn.Global.Retry')}</Button>
            </div></Show>
            <Show when={!isCheckingConnection() && !isConnected()}>
              <div class="ca-provider-notice" role="status">
                <span>{connectionLabel()}</span>
                <Show when={canActOnConnection()}><Button variant="ghost" size="sm" onClick={handleConnectionStatusClick}>{t('mlearn.ConversationAgent.Menu.Settings')}</Button></Show>
              </div>
            </Show>
            {/* Input */}
            <div class="ca-input-area">
              <div class="ca-input-row">
                <Show when={settings.speechEnabled}>
                  <Button buttonType="icon"
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
                    disabled={conversationsLoading() || conversationLoadError() || !hasActiveRoomSelection() || rosterParticipants().length === 0 || !isConnected() || isSafetyLockedState()}
                    ghost
                  />

                  <Show
                    when={!isStreaming()}
                    fallback={
                      <Button buttonType="icon"
                        icon={<StopIcon />}
                        variant="danger"
                        onClick={handleAbort}
                        aria-label={t('mlearn.ConversationAgent.StopStreaming')}
                      />
                    }
                  >
                    <Button buttonType="icon"
                      icon={<SendIcon />}
                      variant="default"
                      onClick={handleSend}
                      disabled={conversationsLoading() || conversationLoadError() || !hasActiveRoomSelection() || rosterParticipants().length === 0 || !inputText().trim() || !isConnected() || isCompactingContext() || isSafetyLockedState()}
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

      <Show when={failedVoiceMemoryIds().size > 0}>
        <div class="ca-contact-error ca-memory-error" role="alert">
          <span>{t('mlearn.ConversationAgent.Voice.MemoryRecordFailed')}</span>
          <Button onClick={() => { for (const id of failedVoiceMemoryIds()) void saveDeliveredVoiceMemories(id); }}>
            {t('mlearn.Global.TryAgain')}
          </Button>
        </div>
      </Show>
      <Show when={contactIngressError()} keyed>
        {(message) => <div class="ca-contact-error" role="status">{message}</div>}
      </Show>

      <Show when={incomingCall()} keyed>
        {(call) => {
          const caller = () => world()?.participants.find(participant => participant.id === call.participantId)?.displayName
            ?? t('mlearn.ConversationAgent.IncomingCall.UnknownCaller');
          return <section class="ca-incoming-call" role="dialog" aria-label={t('mlearn.ConversationAgent.IncomingCall.Title')}>
            <span class="ca-incoming-call-icon"><PhoneIcon /></span>
            <div class="ca-incoming-call-copy">
              <strong>{t('mlearn.ConversationAgent.IncomingCall.Title')}</strong>
              <span>{t('mlearn.ConversationAgent.IncomingCall.From', { name: caller() })}</span>
            </div>
            <Button variant="ghost" onClick={() => { void respondToIncomingCall('decline'); }}>{t('mlearn.ConversationAgent.IncomingCall.Decline')}</Button>
            <Button variant="primary" onClick={() => { void respondToIncomingCall('accept'); }}>{t('mlearn.ConversationAgent.IncomingCall.Accept')}</Button>
          </section>;
        }}
      </Show>

      <Show when={voiceOverlayRequested() || isVoiceCallActive() || voiceAftermath()}>
        <div class="ca-voice-overlay">
          <Show when={voiceAftermath()} fallback={<VoiceTab
              autoStartCall={voiceOverlayRequested()}
              messages={messages()}
              speechMessages={speechMessages()}
              isStreaming={isStreaming()}
              onSendMessage={sendTextMessage}
              onPartialTranscript={(text) => voiceContextPrefetch.onPartial(text, activeVoiceParticipant()?.id ?? '')}
              onRequestGreeting={handleRequestGreeting}
              onIdleSilence={handleVoiceIdleSilence}
              scheduledNudge={voiceScheduledNudge()}
              onAbort={abortCallResponse}
              onStatusChange={setVoiceHeaderStatus}
              onSpeechEnd={(ts) => { lastVadSpeechEndTs = ts; }}
              agentName={callIdentity()}
              profilePhoto={voiceContactParticipantId() || rosterParticipants().length === 1 ? activeVoiceParticipant()?.profilePhoto : undefined}
              defaultVoiceSampleId={activeVoiceParticipant()?.voiceSampleId}
              voiceSampleIds={rosterParticipants().flatMap(person => person.voiceSampleId ? [person.voiceSampleId] : [])}
              onCallStateChange={(active, reason, error, sessionId) => {
                setAdmittedVoiceEventIds(new Set<string>());
                setActiveVoiceSessionId(active ? sessionId ?? crypto.randomUUID() : null);
                if (!active) abortCallResponse();
                if (reason === 'failed' && error) setContactIngressError(error);
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
                    setVoiceContactParticipantId(null);
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
                  setVoiceContactParticipantId(null);
                }
              }}
              onDelivery={persistVoiceDelivery}
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
              onDismiss={() => batch(() => { setVoiceAftermath(null); setVoiceOverlayRequested(false); setVoiceContactParticipantId(null); })}
            />
          )}
          </Show>
        </div>
      </Show>

      <Show when={addingContact()}><ParticipantEditorModal onClose={() => setAddingContact(false)} onCreate={async input => {
        const person = await getBridge().world.createParticipant(input);
        publishContact(person); setAddingContact(false); setContactId(person.id);
      }} storyTracks={world()?.storyTracks ?? []} /></Show>
      <Show when={showStoryProgress() && world()}>{snapshot => <StoryProgressModal world={snapshot()!}
        onClose={() => setShowStoryProgress(false)} onRefresh={async () => { setWorld(await getBridge().world.getWorldState()); }} />}</Show>
      <Show when={selectedContact()}>{person => <ContactProfileModal person={person()}
        onClose={() => setContactId(null)} onMessage={messageContact}
        rooms={world()?.rooms.filter(room => room.participantIds.includes(person().id))}
        onOpenRoom={roomId => { void selectRoom(roomId).catch(error => setContactIngressError(String(error))); }}
        muted={(settings.proactiveOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveOptOutParticipantIds).includes(person().id)}
        onMutedChange={muted => {
          const current = settings.proactiveOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveOptOutParticipantIds;
          updateSettings({ proactiveOptOutParticipantIds: muted ? [...new Set([...current, person().id])] : current.filter(id => id !== person().id) });
        }}
        onSave={async updated => {
          const saved = await getBridge().world.updateParticipant(updated);
          participantAgents.get(saved.id)?.abortStream(); participantAgents.delete(saved.id); publishContact(saved);
        }}
        onRemove={async removed => {
          participantAgents.get(removed.id)?.abortStream(); participantAgents.delete(removed.id);
          await getBridge().world.deleteParticipant(removed.id);
          setWorld(await getBridge().world.getWorldState()); setContactId(null);
        }} />}</Show>
      <Show when={settings.devMode && showRuntimeInspector()}>
        <Modal isOpen onClose={() => setShowRuntimeInspector(false)} title={t('mlearn.ConversationAgent.Developer.Title')} size="xl" fullHeight panelClass="ca-runtime-modal">
          <RuntimeInspector initialRoomId={selection()?.roomId} />
        </Modal>
      </Show>
      <Show when={showDetailsDrawer()}>
        <Modal isOpen onClose={() => setShowDetailsDrawer(false)} title={t('mlearn.ConversationAgent.Menu.Details')} size="md">
          <ThreadInfoPanel roomTitle={activeRoom()?.title}
            roomId={activeThread()?.sandbox ? activeThread()?.id : activeRoom()?.id}
            thread={activeThread()}
            roomScenario={activeRoom()?.scenario}
            reflectionRuns={world()?.reflectionRuns}
            autonomyJobs={world()?.autonomyJobs}
            contacts={world()?.contacts}
            autonomyEnabled={settings.worldAutonomyEnabled ?? DEFAULT_SETTINGS.worldAutonomyEnabled}
            contactEnabled={settings.proactivityEnabled ?? DEFAULT_SETTINGS.proactivityEnabled}
            roomContactMuted={(settings.proactiveOptOutRoomIds ?? DEFAULT_SETTINGS.proactiveOptOutRoomIds).includes(activeRoom()?.id ?? '')}
            quietHoursEnabled={settings.proactiveQuietHoursEnabled ?? DEFAULT_SETTINGS.proactiveQuietHoursEnabled}
            quietHoursStart={settings.proactiveQuietHoursStart ?? DEFAULT_SETTINGS.proactiveQuietHoursStart}
            quietHoursEnd={settings.proactiveQuietHoursEnd ?? DEFAULT_SETTINGS.proactiveQuietHoursEnd}
            mutedParticipantIds={settings.proactiveOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveOptOutParticipantIds}
            callMutedParticipantIds={settings.proactiveCallOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveCallOptOutParticipantIds}
            context={mediaContext()}
            participants={rosterParticipants()}
            onRenameThread={handleRenameThread}
            onUpdateParticipant={handleUpdateParticipant}
            onDeleteThread={handleDeleteThread}
            onIntegrate={() => { setShowIntegrationModal(true); }}
            onUpdateStoryBranch={async input => { await getBridge().world.updateStoryBranch(input); setWorld(await getBridge().world.getWorldState()); }}
            onRetryMaintenance={async (reflectionId) => {
              await getBridge().world.retryMaintenance(reflectionId);
              setWorld(await getBridge().world.getWorldState());
            }}
            onSetAutonomyEnabled={(enabled) => updateSettings({ worldAutonomyEnabled: enabled })}
            onSetContactEnabled={(enabled) => updateSettings({ proactivityEnabled: enabled })}
            onSetRoomContactMuted={(muted) => {
              const roomId = activeRoom()?.id;
              if (!roomId) return;
              const current = settings.proactiveOptOutRoomIds ?? DEFAULT_SETTINGS.proactiveOptOutRoomIds;
              updateSettings({ proactiveOptOutRoomIds: muted
                ? [...new Set([...current, roomId])]
                : current.filter(id => id !== roomId) });
            }}
            onSetQuietHours={(value) => updateSettings({
              ...(value.enabled !== undefined ? { proactiveQuietHoursEnabled: value.enabled } : {}),
              ...(value.start !== undefined ? { proactiveQuietHoursStart: value.start } : {}),
              ...(value.end !== undefined ? { proactiveQuietHoursEnd: value.end } : {}),
            })}
            onSetParticipantMuted={(participantId, muted) => {
              const current = settings.proactiveOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveOptOutParticipantIds;
              updateSettings({ proactiveOptOutParticipantIds: muted
                ? [...new Set([...current, participantId])]
                : current.filter(id => id !== participantId) });
            }}
            onSetParticipantCallsAllowed={(participantId, allowed) => {
              const current = settings.proactiveCallOptOutParticipantIds ?? DEFAULT_SETTINGS.proactiveCallOptOutParticipantIds;
              updateSettings({ proactiveCallOptOutParticipantIds: allowed
                ? current.filter(id => id !== participantId)
                : [...new Set([...current, participantId])] });
            }}
          />
        </Modal>
      </Show>
      <Show when={showNewConversationModal() && !(isRemoteLLMProvider(settings.llmProvider) ? showSplash() : showDisclaimer())}>
        <Show when={pendingTutorConfig() ?? 'manual'} keyed>{(_config) => <NewConversationModal
          world={world()}
          mode={newConversationMode()}
          initialParticipantId={composerParticipantId()}
          initialIntent={pendingTutorConfig() ? tutorSessionIntent(pendingTutorConfig()!) : undefined}
          mediaName={mediaContext()?.mediaName}
          onContactCreated={publishContact}
          onClose={() => { setShowNewConversationModal(false); setComposerParticipantId(undefined); setPendingTutorConfig(undefined); setMediaContext(null); }}
          onCreated={handleScenarioCreated}
        />}</Show>
      </Show>
      <Show when={showIntegrationModal() && activeThread()?.sandbox}>
        <IntegrationModal
          thread={activeThread()!}
          rooms={world()?.rooms ?? []}
          onClose={() => setShowIntegrationModal(false)}
          onIntegrated={async () => {
            setWorld(await getBridge().world.getWorldState());
            const thread = activeThread()!;
            const sandbox = thread.sandbox;
            await journal.select({ roomId: thread.id, threadId: thread.id,
              continuityRoomIds: sandbox ? Object.keys(sandbox.baselineHeads) : undefined,
              baselineHeads: sandbox?.baselineHeads });
          }}
        />
      </Show>
      <Show when={livingWorldPrompt()}>
        <Modal
            isOpen
            onClose={() => setLivingWorldPrompt(null)}
            title={t('mlearn.ConversationAgent.LivingWorld.ConsentTitle')}
            size="sm"
            footer={
              <div style={{ display: 'flex', 'justify-content': 'flex-end', gap: 'var(--spacing-2)' }}>
                <Button variant="ghost" onClick={() => setLivingWorldPrompt(null)}>
                  {t('mlearn.ConversationAgent.LivingWorld.NotNow')}
                </Button>
                <Button variant="primary" onClick={() => { void enableLivingWorldAndEnter(); }}>
                  {t('mlearn.ConversationAgent.LivingWorld.EnableAndContinue')}
                </Button>
              </div>
            }
          >
            <p style={{ margin: '0', 'font-size': '0.9375rem', 'line-height': '1.6', 'color': 'var(--text-secondary)' }}>
              {t('mlearn.ConversationAgent.LivingWorld.ConsentHint')}
            </p>
          </Modal>
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
