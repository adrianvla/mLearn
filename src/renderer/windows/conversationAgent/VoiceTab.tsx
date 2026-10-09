/**
 * VoiceTab — Real-time voice conversation UI for the Conversation Agent.
 * Captures audio via getUserMedia, streams PCM to main process for STT/VAD,
 * plays back TTS audio via Web Audio API with sentence-level interruption tracking.
 */

import { Component, Show, createSignal, createEffect, on, onCleanup, Index, onMount } from 'solid-js';
import { useSettings, useLocalization, useLowPowerGate } from '../../context';
import { formatLogTimestamp } from '../../utils/timeFormatting';
import { getBridge } from '../../../shared/bridges';
import { Button, ProgressBar, RangeInput, EmptyState, AlertBanner, Spinner, Select, MicrophoneIcon } from '../../components/common';
import type { SelectOption } from '../../components/common';
import { showToast } from '../../components/common/Feedback/Toast';
import { ChatBubble } from './ChatBubble';
import type { ConversationMessage, VoiceModelStatus, VoiceSTTResult, VoiceTtsAudio, VoiceTtsStatus, VoiceTtsRequestIdentity, VoiceMode, VoiceVadEvent, Token, VoiceSessionStatus, VoiceSessionRequestIdentity, VoiceCallTTSProvider } from '../../../shared/types';
import type { VoiceDeliveryPayload } from '../../../shared/world';
import { VoicePlaybackDelivery } from './voicePlaybackDelivery';
import { matchesVoiceTtsRequest } from '../../../shared/utils/voiceTtsOwnership';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import './VoiceTab.css';
import { CallParticipants, type CallParticipant } from './CallParticipants';
import { getLogger } from '../../../shared/utils/logger';
import { scheduleAudioChunk } from './ttsScheduling';
import {
  abortVoiceTtsTurn,
  createVoiceTtsTurnState,
  enqueueVoiceTtsPhrasesForMessage,
  finishVoiceTtsPhraseRequest,
  resetVoiceTtsTurnState,
  takeNextVoiceTtsPhrase,
} from './voiceTtsTurn';

const log = getLogger("renderer.conversationAgent.voice");
const NO_TRANSCRIPT_RECOVERY_MS = 1800;
const IDLE_SILENCE_NUDGE_MS = 9000;
const IDLE_SILENCE_NUDGE_COOLDOWN_MS = 25000;

/**
 * Resolve the public asset relative to the HTML entry, including packaged
 * file:// pages. Use a blob when Chromium cannot load the file as a worklet.
 */
export async function loadAudioWorkletModule(ctx: AudioContext, pageUrl = window.location.href): Promise<void> {
  const moduleUrl = new URL('../../audio-processor.js', pageUrl).href;
  try {
    await ctx.audioWorklet.addModule(moduleUrl);
  } catch {
    const response = await fetch(moduleUrl);
    const source = await response.text();
    const blob = new Blob([source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

// ============================================================================
// Icons
// ============================================================================

const PhoneIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
  </svg>
);

const PhoneOffIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true">
    <path d="M5.5 14.5c3.9-3 9.1-3 13 0" />
    <path d="M7.8 12.9l-1.9 2.2c-.7.8-.2 2 1 2h2.5c.6 0 1.1-.4 1.3-.9l.5-1.5" />
    <path d="M16.2 12.9l1.9 2.2c.7.8.2 2-1 2h-2.5c-.6 0-1.1-.4-1.3-.9l-.5-1.5" />
  </svg>
);

const MicIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
    <path d="M19 10v2a7 7 0 01-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

// ============================================================================
// Props
// ============================================================================

type VoiceTtsChoice = 'system' | 'lightweight' | 'voice-clone';
type LocalVoiceTtsProvider = 'system' | 'kokoro' | 'qwen3';
type VoiceDebugTone = 'info' | 'active' | 'warn' | 'error';
type VoiceDebugEvent = {
  id: number;
  time: string;
  label: string;
  detail: string;
  tone: VoiceDebugTone;
};
type VoiceTimelinePhrase = {
  phraseIndex: number;
  text: string;
};
type VoiceTimelineChunk = {
  id: number;
  phraseIndex: number;
  startOffset: number;
  duration: number;
  sampleCount: number;
};
type ScheduledVoiceNudge = {
  id: number;
  seconds: number;
  prompt?: string;
};

/** Compute hints carried by voice status IPC payloads. */
type VoiceDeviceHint = {
  /** Device the voice service uses for speech compute ('cuda' | 'mps' | 'cpu'). */
  device?: 'cuda' | 'mps' | 'cpu';
  /** Pre-derived CPU-performance warning from the voice service. */
  cpuWarning?: boolean;
};

function voiceTtsChoiceFromProvider(provider: VoiceCallTTSProvider | undefined): VoiceTtsChoice {
  switch (provider) {
    case 'qwen3': return 'voice-clone';
    case 'kokoro': return 'lightweight';
    case 'system': return 'system';
    case 'cloud': return 'voice-clone';
    default: return 'system';
  }
}

function providerFromVoiceTtsChoice(choice: VoiceTtsChoice): LocalVoiceTtsProvider {
  switch (choice) {
    case 'system': return 'system';
    case 'lightweight': return 'kokoro';
    case 'voice-clone': return 'qwen3';
  }
}

export interface VoiceTabProps {
  participants?: readonly CallParticipant[];
  contextLabel?: string;
  onDismiss?: () => void;
  /** Start a call immediately after the tab mounts. */
  autoStartCall?: boolean;
  messages: Array<ConversationMessage & { eventId?: string; actorId?: string }>;
  /** Final journal responses, distinct from the live chat candidate. */
  speechMessages?: readonly VoiceSpeechMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  /** Fired on every non-final STT partial while listening (feeds speculative prefetch). */
  onPartialTranscript?: (text: string) => void;
  /** Fired when VAD confirms the user stopped speaking — the true start of the turn-latency budget. */
  onSpeechEnd?: (timestamp: number) => void;
  onRequestGreeting: () => void;
  onIdleSilence?: (reason: 'no-transcript' | 'waiting' | 'scheduled', scheduledPrompt?: string) => void;
  scheduledNudge?: ScheduledVoiceNudge | null;
  onAbort: () => void;
  /** Persist exact-message playback observations before the next actor speaks. */
  onDelivery?: (delivery: VoiceDeliveryPayload) => Promise<void> | void;
  /** Called when voice call starts or stops */
  onCallStateChange?: (active: boolean, reason?: 'completed' | 'failed' | 'cleanup', error?: string, sessionId?: string) => void;
  /** Present the existing call state in the window header without owning it. */
  onStatusChange?: (status: string) => void;
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode?: WordHoverTriggerMode;
  triggerKey?: string;
  isConnected: boolean;
  language: string;
  /** Default voice sample from the agent config */
  defaultVoiceSampleId?: string;
  /** Profiles present in the group, without assigning one participant's voice to everyone. */
  voiceSampleIds?: readonly string[];
  /** Active agent display name */
  agentName?: string;
  /** Active agent profile photo as a data URI */
  profilePhoto?: string;
}

export interface VoiceSpeechMessage {
  eventId: string;
  actorId: string;
  voiceSessionId: string;
  content: string;
  voiceSampleId?: string;
}

// ============================================================================
// Component
// ============================================================================

export const VoiceTab: Component<VoiceTabProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { requestAccess } = useLowPowerGate();

  // State
  const [isCallActive, setIsCallActive] = createSignal(false);
  const supportsCalls = getBridge().voice.supportsCalls !== false;
  const [modelStatus, setModelStatus] = createSignal<VoiceModelStatus | null>(null);
  const [isChecking, setIsChecking] = createSignal(true);
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [downloadProgress, setDownloadProgress] = createSignal(0);
  const [isInitializing, setIsInitializing] = createSignal(false);
  const [initError, setInitError] = createSignal('');
  const [hasAudibleSpeech, setHasAudibleSpeech] = createSignal(false);
  const [activeSpeakerId, setActiveSpeakerId] = createSignal<string | null>(null);
  const [callState, setCallState] = createSignal<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const [partialTranscript, setPartialTranscript] = createSignal('');
  const [pttActive, setPttActive] = createSignal(false);
  const [audioLevel, setAudioLevel] = createSignal(0);
  const [micError, setMicError] = createSignal('');
  const [captureReady, setCaptureReady] = createSignal(false);
  const [ttsModelLoading, setTtsModelLoading] = createSignal(false);
  const [ttsDownloadProgress, setTtsDownloadProgress] = createSignal(0);
  const [sessionStatus, setSessionStatus] = createSignal<VoiceSessionStatus | null>(null);
  const [ttsChunkCount, setTtsChunkCount] = createSignal(0);
  const [lastInterruption, setLastInterruption] = createSignal('');
  const [debugEvents, setDebugEvents] = createSignal<VoiceDebugEvent[]>([]);
  const [vadDebug, setVadDebug] = createSignal<VoiceVadEvent | null>(null);
  const [microphones, setMicrophones] = createSignal<MediaDeviceInfo[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = createSignal('');
  const [showAdvancedUi, setShowAdvancedUi] = createSignal(false);
  // Tick counter drives continuous visualizer animation independent of audio level
  const [tick, setTick] = createSignal(0);

  const [ttsChoice, setTtsChoice] = createSignal<VoiceTtsChoice>(
    voiceTtsChoiceFromProvider(settings.ttsProvider ?? DEFAULT_SETTINGS.ttsProvider),
  );
  // True when the active voice status reports CPU-only speech compute
  const [cpuVoiceWarning, setCpuVoiceWarning] = createSignal(false);
  const applyVoiceDeviceStatus = (status: VoiceTtsStatus | VoiceModelStatus | null | undefined) => {
    // VOICE_TTS_STATUS and model-status relays attach device/cpuWarning at runtime;
    // payloads without compute hints (older backend builds) never clear the flag
    const hint = status as VoiceDeviceHint | null | undefined;
    if (!status || (hint?.device === undefined && hint?.cpuWarning === undefined)) return;
    setCpuVoiceWarning(hint.cpuWarning === true || hint.device === 'cpu');
  };

  // Refs
  let messagesRef: HTMLDivElement | undefined;
  type MicrophoneCapture = {
    request: VoiceSessionRequestIdentity;
    stream?: MediaStream;
    context?: AudioContext;
    worklet?: AudioWorkletNode;
    analyser?: AnalyserNode;
  };
  let microphoneRequest: VoiceSessionRequestIdentity | null = null;
  let activeCapture: MicrophoneCapture | null = null;
  let greetingRequested = false;
  const ownsMicrophoneRequest = (event: Partial<VoiceSessionRequestIdentity>) => (
    isCallActive() && microphoneRequest !== null
    && event.sessionId === microphoneRequest.sessionId && event.requestId === microphoneRequest.requestId
  );
  let analyserNode: AnalyserNode | null = null;
  let animFrameId: number | null = null;
  let ttsTimelineCanvas: HTMLCanvasElement | undefined;
  let ttsTimelineDrawFrameId: number | null = null;

  // TTS sentence queue for interruption tracking
  let ttsQueue: VoiceTtsAudio[] = [];
  let ttsQueueIndex = 0;
  let ttsSources: AudioBufferSourceNode[] = [];
  let ttsPlaying = false;
  let ttsGenerationActive = false;
  const voiceTtsTurn = createVoiceTtsTurnState();
  let ttsAudioContext: AudioContext | null = null; // separate context for TTS playback
  let ttsNextStartTime: number | null = null;
  let ttsPlaybackTimer: ReturnType<typeof setTimeout> | null = null;
  let noTranscriptRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let idleSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledNudgeTimer: ReturnType<typeof setTimeout> | null = null;
  let scheduledNudgeActiveId: number | null = null;
  let lastIdleSilenceNudgeAt = 0;

  // TTS generation guard — prevents stale audio from playing after cancellation
  let ttsAborted = false;
  let callSessionId = crypto.randomUUID();
  let activeTtsRequest: VoiceTtsRequestIdentity | null = null;
  let activeSpeech: VoiceSpeechMessage | null = null;
  let pendingSpeech: VoiceSpeechMessage[] = [];
  let seenSpeechEventIds = new Set<string>();
  let speechTurnIndex = 0;
  let playbackDelivery: VoicePlaybackDelivery | null = null;
  let settlingSpeech: VoiceSpeechMessage | null = null;
  let systemPhrase = false;
  let systemPlaybackStarted = false;
  // True VAD speech-end wall time — the start of the turn-latency budget
  let lastSpeechEndTs: number | null = null;
  let ttsTurnStartTime = 0;
  let ttsScheduledDuration = 0;
  // Barge-in detection: consecutive mic-loud frames during TTS playback
  let bargeInFrames = 0;
  const BARGE_IN_THRESHOLD = 0.28;
  const BARGE_IN_FRAMES_REQUIRED = 8;
  const BARGE_IN_GRACE_MS = 1200;
  let debugEventId = 0;
  let ttsTimelinePhrases: VoiceTimelinePhrase[] = [];
  let ttsTimelineChunks: VoiceTimelineChunk[] = [];
  let ttsTimelineChunkId = 0;
  let ttsTimelineBaseTime: number | null = null;
  let ttsTimelineInterruptedAt: number | null = null;
  const [ttsTimelineRevision, setTtsTimelineRevision] = createSignal(0);

  // Voice mode from settings
  const voiceMode = () => (settings.voiceMode || DEFAULT_SETTINGS.voiceMode) as VoiceMode;
  const ttsSpeed = () => settings.voiceTtsSpeed ?? DEFAULT_SETTINGS.voiceTtsSpeed;
  const silenceThreshold = () => settings.voiceSilenceThreshold ?? DEFAULT_SETTINGS.voiceSilenceThreshold;

  let currentVoiceMode: VoiceMode = voiceMode();
  createEffect(() => {
    currentVoiceMode = voiceMode();
  });

  const addDebugEvent = (label: string, detail: string, tone: VoiceDebugTone = 'info') => {
    const time = formatLogTimestamp(Date.now(), settings.uiLanguage);
    const event = { id: debugEventId++, time, label, detail, tone };
    setDebugEvents(events => [event, ...events].slice(0, 30));
  };

  const setTtsPlaybackActive = (active: boolean) => {
    if (ttsPlaying === active) return;
    ttsPlaying = active;
    if (microphoneRequest) getBridge().voice.voiceSendTtsState(active, microphoneRequest);
  };

  const formatVadNumber = (value: number | undefined, digits = 2): string => (
    value === undefined ? 'n/a' : value.toFixed(digits)
  );

  const formatVadSeconds = (value: number | undefined): string => (
    value === undefined ? 'n/a' : `${value.toFixed(2)}s`
  );

  const formatVadDetail = (event: VoiceVadEvent): string => {
    const parts = [
      event.reason ?? event.type,
      `p ${formatVadNumber(event.speechProb)}`,
      `thr ${formatVadNumber(event.threshold)}`,
      `silence ${formatVadSeconds(event.silenceSeconds)}/${formatVadSeconds(event.silenceThreshold)}`,
      `speech ${formatVadSeconds(event.speechSeconds)}`,
    ];
    return parts.join(' · ');
  };

  const vadDebugSummary = (): string => {
    const event = vadDebug();
    if (!event) return t('mlearn.ConversationAgent.Voice.None');
    return `${event.type} · ${formatVadDetail(event)}`;
  };

  const clearNoTranscriptRecovery = () => {
    if (noTranscriptRecoveryTimer) {
      clearTimeout(noTranscriptRecoveryTimer);
      noTranscriptRecoveryTimer = null;
    }
  };

  const clearIdleSilenceTimer = () => {
    if (idleSilenceTimer) {
      clearTimeout(idleSilenceTimer);
      idleSilenceTimer = null;
    }
  };

  const clearScheduledNudgeTimer = () => {
    if (scheduledNudgeTimer) {
      clearTimeout(scheduledNudgeTimer);
      scheduledNudgeTimer = null;
    }
    scheduledNudgeActiveId = null;
  };

  const canNotifyIdleSilence = () => (
    isCallActive()
    && !isInitializing()
    && !props.isStreaming
    && !ttsPlaying
    && !ttsGenerationActive
    && callState() === 'listening'
    && !partialTranscript().trim()
    && props.messages.length > 0
  );

  const scheduleIdleSilenceNudge = (reason: 'no-transcript' | 'waiting') => {
    clearIdleSilenceTimer();
    if (props.scheduledNudge) return;
    if (!canNotifyIdleSilence()) return;
    idleSilenceTimer = setTimeout(() => {
      idleSilenceTimer = null;
      if (!canNotifyIdleSilence()) return;
      if (props.scheduledNudge) return;
      const now = Date.now();
      if (now - lastIdleSilenceNudgeAt < IDLE_SILENCE_NUDGE_COOLDOWN_MS) {
        scheduleIdleSilenceNudge('waiting');
        return;
      }
      lastIdleSilenceNudgeAt = now;
      addDebugEvent('Silence', `${reason}: notifying agent after quiet listening`, 'info');
      props.onIdleSilence?.(reason);
    }, IDLE_SILENCE_NUDGE_MS);
  };

  const scheduleToolNudge = (nudge: ScheduledVoiceNudge) => {
    clearScheduledNudgeTimer();
    if (!canNotifyIdleSilence()) return;
    scheduledNudgeActiveId = nudge.id;
    clearIdleSilenceTimer();
    addDebugEvent('Silence', `scheduled: will nudge in ${nudge.seconds.toFixed(1)}s`, 'info');
    scheduledNudgeTimer = setTimeout(() => {
      scheduledNudgeTimer = null;
      scheduledNudgeActiveId = null;
      if (!canNotifyIdleSilence()) return;
      addDebugEvent('Silence', `scheduled: notifying agent after ${nudge.seconds.toFixed(1)}s`, 'info');
      props.onIdleSilence?.('scheduled', nudge.prompt);
    }, nudge.seconds * 1000);
  };

  const scheduleNoTranscriptRecovery = () => {
    clearNoTranscriptRecovery();
    noTranscriptRecoveryTimer = setTimeout(() => {
      noTranscriptRecoveryTimer = null;
      if (!isCallActive() || props.isStreaming || ttsPlaying || callState() !== 'processing') return;
      addDebugEvent('STT', 'No final transcript after VAD end · UI -> Listening', 'warn');
      setCallState('listening');
      setPartialTranscript('');
      scheduleIdleSilenceNudge('no-transcript');
    }, NO_TRANSCRIPT_RECOVERY_MS);
  };

  const bumpTtsTimeline = () => {
    setTtsTimelineRevision(value => value + 1);
  };

  const resetTtsTimeline = () => {
    ttsTimelinePhrases = [];
    ttsTimelineChunks = [];
    ttsTimelineChunkId = 0;
    ttsTimelineBaseTime = null;
    ttsTimelineInterruptedAt = null;
    bumpTtsTimeline();
  };

  const appendTtsTimelinePhrases = (phrases: string[], startIndex: number) => {
    if (phrases.length === 0) return;
    const existing = new Set(ttsTimelinePhrases.map(phrase => phrase.phraseIndex));
    const nextPhrases = phrases
      .map((text, offset) => ({ phraseIndex: startIndex + offset, text }))
      .filter(phrase => !existing.has(phrase.phraseIndex));
    if (nextPhrases.length === 0) return;
    ttsTimelinePhrases = [...ttsTimelinePhrases, ...nextPhrases];
    bumpTtsTimeline();
  };

  const appendTtsTimelineChunk = (
    phraseIndex: number,
    sampleCount: number,
    startAt: number,
    duration: number,
  ) => {
    if (ttsTimelineBaseTime === null) {
      ttsTimelineBaseTime = startAt;
    }
    ttsTimelineChunks = [
      ...ttsTimelineChunks,
      {
        id: ttsTimelineChunkId++,
        phraseIndex,
        startOffset: Math.max(0, startAt - ttsTimelineBaseTime),
        duration,
        sampleCount,
      },
    ];
    bumpTtsTimeline();
  };

  const markTtsTimelineInterrupted = () => {
    if (ttsAudioContext && ttsTimelineBaseTime !== null) {
      ttsTimelineInterruptedAt = Math.max(0, ttsAudioContext.currentTime - ttsTimelineBaseTime);
    } else {
      ttsTimelineInterruptedAt = 0;
    }
    bumpTtsTimeline();
  };

  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  const fitCanvasText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ): string => {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(`${text.slice(0, mid)}...`).width <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return `${text.slice(0, lo)}...`;
  };

  const drawTtsTimeline = () => {
    const canvas = ttsTimelineCanvas;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(canvas);
    const chunkColor = styles.getPropertyValue('--voice-timeline-chunk').trim();
    const separatorColor = styles.getPropertyValue('--voice-timeline-separator').trim();
    const playheadColor = styles.getPropertyValue('--voice-timeline-playhead').trim();
    const phraseColor = styles.getPropertyValue('--voice-timeline-phrase').trim();
    const phraseTextColor = styles.getPropertyValue('--voice-timeline-phrase-text').trim();
    const mutedColor = styles.getPropertyValue('--voice-timeline-muted').trim();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const left = 14;
    const right = 14;
    const timelineWidth = Math.max(1, width - left - right);
    const labelY = 8;
    const chunkY = 62;
    const chunkHeight = 24;
    const minChunkWidth = 5;

    const phraseRanges = new Map<number, { start: number; end: number }>();
    let placeholderCursor = 0;
    for (const phrase of ttsTimelinePhrases) {
      const chunks = ttsTimelineChunks.filter(chunk => chunk.phraseIndex === phrase.phraseIndex);
      if (chunks.length > 0) {
        const start = Math.min(...chunks.map(chunk => chunk.startOffset));
        const end = Math.max(...chunks.map(chunk => chunk.startOffset + chunk.duration));
        phraseRanges.set(phrase.phraseIndex, { start, end });
        placeholderCursor = Math.max(placeholderCursor, end + 0.06);
      } else {
        const duration = Math.max(0.55, Math.min(2.2, phrase.text.length * 0.045));
        phraseRanges.set(phrase.phraseIndex, {
          start: placeholderCursor,
          end: placeholderCursor + duration,
        });
        placeholderCursor += duration + 0.12;
      }
    }

    const chunkEnd = ttsTimelineChunks.reduce(
      (max, chunk) => Math.max(max, chunk.startOffset + chunk.duration),
      0,
    );
    const phraseEnd = Array.from(phraseRanges.values()).reduce(
      (max, range) => Math.max(max, range.end),
      0,
    );
    const totalDuration = Math.max(1.4, chunkEnd, phraseEnd, ttsScheduledDuration) + 0.2;
    const xForTime = (seconds: number) => left + (seconds / totalDuration) * timelineWidth;

    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, chunkY + chunkHeight + 12);
    ctx.lineTo(width - right, chunkY + chunkHeight + 12);
    ctx.stroke();

    for (const phrase of ttsTimelinePhrases) {
      const range = phraseRanges.get(phrase.phraseIndex);
      if (!range) continue;
      const startX = xForTime(range.start);
      const endX = xForTime(range.end);
      const labelWidth = Math.max(44, endX - startX);
      const labelX = Math.max(left, Math.min(startX, width - right - labelWidth));

      ctx.strokeStyle = phraseColor;
      ctx.fillStyle = phraseColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, labelY + 28);
      ctx.lineTo(startX, labelY + 38);
      ctx.moveTo(startX, labelY + 38);
      ctx.lineTo(endX, labelY + 38);
      ctx.moveTo(endX, labelY + 28);
      ctx.lineTo(endX, labelY + 38);
      ctx.stroke();

      drawRoundedRect(ctx, labelX, labelY, labelWidth, 22, 4);
      ctx.fill();
      ctx.fillStyle = phraseTextColor;
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(fitCanvasText(ctx, phrase.text, labelWidth - 8), labelX + labelWidth / 2, labelY + 11);
    }

    for (const chunk of ttsTimelineChunks) {
      const x = xForTime(chunk.startOffset);
      const nextX = xForTime(chunk.startOffset + chunk.duration);
      const chunkWidth = Math.max(minChunkWidth, nextX - x);
      ctx.fillStyle = chunkColor;
      drawRoundedRect(ctx, x, chunkY, chunkWidth, chunkHeight, 3);
      ctx.fill();
      ctx.strokeStyle = separatorColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, chunkY - 5);
      ctx.lineTo(x, chunkY + chunkHeight + 5);
      ctx.moveTo(x + chunkWidth, chunkY - 5);
      ctx.lineTo(x + chunkWidth, chunkY + chunkHeight + 5);
      ctx.stroke();
    }

    const playheadSeconds = ttsTimelineInterruptedAt
      ?? (ttsAudioContext && ttsTimelineBaseTime !== null ? ttsAudioContext.currentTime - ttsTimelineBaseTime : 0);
    const playheadX = Math.max(left, Math.min(width - right, xForTime(Math.max(0, playheadSeconds))));
    ctx.strokeStyle = playheadColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 4);
    ctx.lineTo(playheadX, height - 8);
    ctx.stroke();
  };

  const drawTtsTimelineSoon = () => {
    if (ttsTimelineDrawFrameId !== null) return;
    ttsTimelineDrawFrameId = requestAnimationFrame(() => {
      ttsTimelineDrawFrameId = null;
      drawTtsTimeline();
    });
  };

  createEffect(() => {
    void ttsTimelineRevision();
    drawTtsTimelineSoon();
  });

  // ============================================================================
  // Check model status on mount and language change
  // ============================================================================

  const microphoneOptions = (): SelectOption[] => [
    { value: '', label: t('mlearn.ConversationAgent.Voice.DefaultMicrophone') },
    ...microphones().map((device, index) => ({
      value: device.deviceId,
      label: device.label || t('mlearn.ConversationAgent.Voice.MicrophoneNumber', { index: String(index + 1) }),
    })),
  ];

  const refreshMicrophones = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setMicrophones(audioInputs);
      if (selectedMicrophoneId() && !audioInputs.some(device => device.deviceId === selectedMicrophoneId())) {
        setSelectedMicrophoneId('');
      }
    } catch (error) {
      log.error('[VoiceTab] Failed to enumerate microphones:', error);
    }
  };

  const checkModels = async (language: string) => {
    setIsChecking(true);
    try {
      const status = await getBridge().voice.voiceCheckModels(language);
      if (status) {
        setModelStatus(status);
        applyVoiceDeviceStatus(status);
        setIsDownloading(status.downloading);
        if (status.downloading) {
          setDownloadProgress(Math.round(status.progress * 100));
        }
      }
    } catch (err) {
      log.error('[VoiceTab] Failed to check voice models:', err);
    } finally {
      setIsChecking(false);
    }
  };

  createEffect(() => {
    const lang = props.language;
    checkModels(lang);
  });

  // ============================================================================
  // IPC Listeners
  // ============================================================================

  onMount(() => {
    const bridge = getBridge();
    const cleanups: Array<() => void> = [];
    refreshMicrophones();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicrophones);

    // Model download progress
    cleanups.push(bridge.voice.onVoiceModelProgress((status) => {
      setModelStatus(status);
      applyVoiceDeviceStatus(status);
      setIsDownloading(status.downloading);
      setDownloadProgress(Math.round(status.progress * 100));
    }));

    // STT results
    cleanups.push(bridge.voice.onVoiceSttResult((result: VoiceSTTResult) => {
      if (!ownsMicrophoneRequest(result) || isInitializing()) return;
      clearNoTranscriptRecovery();
      clearIdleSilenceTimer();
      clearScheduledNudgeTimer();
      setPartialTranscript(result.text);
      if (!result.isFinal) props.onPartialTranscript?.(result.text);
      if (result.isFinal && result.text.trim()) {
        addDebugEvent('STT', `${result.text.trim().length} chars final`, 'active');
        setCallState('processing');
        props.onSendMessage(result.text.trim());
        setPartialTranscript('');
      }
    }));

    // VAD events — backend receives TTS state and can adapt thresholds;
    // barge-in is still detected locally via mic level as the fast path.
    cleanups.push(bridge.voice.onVoiceVadEvent((event) => {
      if (!ownsMicrophoneRequest(event) || isInitializing()) return;
      setVadDebug(event);
      if (event.type === 'speech-start') {
        clearNoTranscriptRecovery();
        clearIdleSilenceTimer();
        clearScheduledNudgeTimer();
        if (ttsPlaying) return; // safety guard — barge-in handled locally
        addDebugEvent('VAD start', `${formatVadDetail(event)} · UI -> Listening`, 'active');
        setCallState('listening');
      } else if (event.type === 'speech-end') {
        lastSpeechEndTs = Date.now();
        props.onSpeechEnd?.(lastSpeechEndTs);
        addDebugEvent('VAD end', `${formatVadDetail(event)} · UI ${callState()} -> Processing`, 'info');
        if (callState() === 'listening') {
          setCallState('processing');
          scheduleNoTranscriptRecovery();
        }
      }
    }));

    // TTS audio — schedule streamed chunks for gapless playback
    cleanups.push(bridge.voice.onVoiceTtsAudio((audio: VoiceTtsAudio) => {
      if (ttsAborted || !matchesVoiceTtsRequest(audio, activeTtsRequest)) return;
      log.info('[VoiceTab] TTS audio received', {
        samples: audio.samples.length,
        sampleRate: audio.sampleRate,
        sentenceIndex: audio.sentenceIndex,
      });
      addDebugEvent('TTS chunk', `${audio.samples.length} samples @ ${audio.sampleRate} Hz`, 'active');
      ttsQueue.push(audio);
      scheduleTtsAudio(audio);
    }));

    // TTS status
    cleanups.push(bridge.voice.onVoiceTtsStatus((status) => {
      if (!matchesVoiceTtsRequest(status, activeTtsRequest)) return;
      log.info('[VoiceTab] TTS status', status);
      applyVoiceDeviceStatus(status);
      if (status.error) {
        addDebugEvent('TTS error', status.error, 'error');
        stopTTSPlayback(true, 'failed');
        setTtsModelLoading(false);
        setTtsDownloadProgress(0);
        setCallState('listening');
        showToast({ message: status.error, variant: 'error' });
        props.onAbort();
        return;
      }
      setTtsModelLoading(status.modelLoading ?? false);
      if (status.downloadProgress !== undefined) {
        setTtsDownloadProgress(status.downloadProgress);
      }
      if (status.generating) {
        ttsGenerationActive = true;
        addDebugEvent('TTS', status.playing ? 'Playback started' : 'Generating audio', 'active');
        if (status.playing) {
          if (systemPhrase) { systemPlaybackStarted = true; setHasAudibleSpeech(true); }
          setTtsPlaybackActive(true);
          setCallState('speaking');
        } else {
          setCallState(hasAudibleSpeech() ? 'speaking' : 'processing');
        }
      } else if (status.generating === false) {
        playbackDelivery?.finishGeneration(voiceTtsTurn.activePhraseIndex, systemPhrase && systemPlaybackStarted);
        if (systemPhrase && ttsSources.length === 0) setHasAudibleSpeech(false);
        if (activeSpeech && playbackDelivery?.snapshot(ttsAudioContext?.currentTime ?? 0).confirmedText
          && voiceTtsTurn.pendingPhrases.length > 0) {
          try { void Promise.resolve(props.onDelivery?.(deliveryFor(activeSpeech, 'playing'))).catch(reportDeliveryFailure); }
          catch (error) { reportDeliveryFailure(error); }
        }
        activeTtsRequest = null;
        ttsGenerationActive = false;
        finishVoiceTtsPhraseRequest(voiceTtsTurn);
        setTtsModelLoading(false);
        setTtsDownloadProgress(0);
        addDebugEvent('TTS', 'Generation finished', 'info');
        requestNextVoiceTtsPhrase();
        finishTtsIfPlaybackDrained();
      }
    }));

    // Voice session ready
    cleanups.push(bridge.voice.onVoiceSessionReady((data) => {
      if (!ownsMicrophoneRequest(data) || !data.ready) return;
      setIsInitializing(false);
      setSessionStatus(null);
      setInitError('');
      if (microphoneRequest) getBridge().voice.voiceSendTtsState(ttsPlaying, microphoneRequest);
      addDebugEvent('Session', 'Voice backend ready', 'active');
      requestNextVoiceTtsPhrase();
      finishTtsIfPlaybackDrained();
    }));

    cleanups.push(bridge.voice.onVoiceSessionStatus((status) => {
      if (!ownsMicrophoneRequest(status)) return;
      log.info('[VoiceTab] Voice session status', status);
      setSessionStatus(status);
      addDebugEvent('Load', `${status.stage}: ${status.message}`, 'info');
    }));

    // Voice session error
    cleanups.push(bridge.voice.onVoiceSessionError((data) => {
      if (!ownsMicrophoneRequest(data)) return;
      const err = data.error.toLowerCase();
      const explanation = err.includes('403') || err.includes('4003') || err.includes('unauthorized')
        ? t('mlearn.ConversationAgent.Voice.BackendAuthError') : data.error;
      stopCall('failed', explanation);
      addDebugEvent('Error', data.error, 'error');
    }));

    onCleanup(() => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMicrophones);
      cleanups.forEach(fn => fn());
    });
  });

  // Clean up call on component unmount
  onCleanup(() => {
    if (ttsTimelineDrawFrameId !== null) {
      cancelAnimationFrame(ttsTimelineDrawFrameId);
      ttsTimelineDrawFrameId = null;
    }
    clearScheduledNudgeTimer();
    stopCall('cleanup');
  });

  // ============================================================================
  // Auto-scroll messages
  // ============================================================================

  createEffect(() => {
    void props.messages.length;
    if (messagesRef) {
      requestAnimationFrame(() => {
        messagesRef!.scrollTop = messagesRef!.scrollHeight;
      });
    }
  });

  createEffect(
    on(
      [() => props.isStreaming, () => props.messages.length, callState, partialTranscript],
      () => {
        if (canNotifyIdleSilence()) {
          scheduleIdleSilenceNudge('waiting');
        } else {
          clearIdleSilenceTimer();
        }
      },
    ),
  );

  createEffect(
    on(
      [
        () => props.scheduledNudge?.id,
        () => props.isStreaming,
        () => props.messages.length,
        callState,
        partialTranscript,
        isCallActive,
        isInitializing,
      ],
      () => {
        const nudge = props.scheduledNudge;
        if (!nudge) {
          clearScheduledNudgeTimer();
          return;
        }
        if (scheduledNudgeActiveId === nudge.id && scheduledNudgeTimer) return;
        if (!canNotifyIdleSilence()) {
          clearScheduledNudgeTimer();
          return;
        }
        scheduleToolNudge(nudge);
      },
    ),
  );

  // ============================================================================
  // Stream TTS for assistant phrases as the LLM response arrives
  // ============================================================================

  function resetVoiceTtsTurn(messageIndex: number): void {
    stopTTSPlayback(false);
    clearScheduledNudgeTimer();
    resetVoiceTtsTurnState(voiceTtsTurn, messageIndex);
    ttsAborted = false;
    ttsQueue = [];
    ttsQueueIndex = 0;
    bargeInFrames = 0;
    resetTtsTimeline();
  }

  function requestNextVoiceTtsPhrase(): void {
    if (ttsAborted || !isCallActive() || isInitializing() || !activeSpeech) return;
    const next = takeNextVoiceTtsPhrase(voiceTtsTurn);
    if (!next) return;

    const sampleId = ttsChoice() === 'voice-clone' ? activeSpeech.voiceSampleId : undefined;
    const provider = ttsChoice() === 'voice-clone' && !sampleId ? 'system' : activeTtsProvider();
    log.info('[VoiceTab] Requesting TTS phrase', {
      provider,
      language: props.language,
      chars: next.phrase.length,
      hasVoiceSample: Boolean(sampleId),
    });
    addDebugEvent('LLM -> TTS', `${next.phrase.length} chars queued for streamed TTS`, 'active');

    ttsGenerationActive = true;
    const message = activeSpeech;
    const request: VoiceTtsRequestIdentity = {
      variant: microphoneRequest ? microphoneRequest.variant : (settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants)[props.language] ?? null,
      sessionId: callSessionId,
      requestId: crypto.randomUUID(),
      utteranceId: message.eventId,
      actorId: message.actorId,
    };
    activeTtsRequest = request;
    systemPhrase = provider === 'system';
    systemPlaybackStarted = false;

    void (async () => {
      try {
        const allowed = await requestAccess('tts');
        if (activeTtsRequest !== request) return;
        if (!allowed || ttsAborted || !isCallActive()) {
          stopTTSPlayback(true, 'failed');
          setCallState('listening');
          if (!allowed) {
            showToast({ message: t('mlearn.ConversationAgent.Voice.SynthesisDeclined'), variant: 'info' });
            props.onAbort();
          }
          return;
        }
        getBridge().voice.voiceTtsGenerate(next.phrase, props.language, ttsSpeed(), sampleId, provider, undefined, request);
      } catch (error) {
        if (activeTtsRequest !== request) return;
        activeTtsRequest = null;
        log.error('[VoiceTab] Failed to request streamed TTS phrase:', error);
        finishVoiceTtsPhraseRequest(voiceTtsTurn);
        ttsGenerationActive = false;
        stopTTSPlayback(true, 'failed');
        setCallState('listening');
        props.onAbort();
        showToast({ message: error instanceof Error ? error.message : String(error), variant: 'error' });
      }
    })();
  }

  function startNextSpeech(): void {
    if (activeSpeech || !isCallActive() || isInitializing()) return;
    const next = pendingSpeech.shift();
    if (!next) return;
    resetVoiceTtsTurn(speechTurnIndex++);
    activeSpeech = next;
    setActiveSpeakerId(next.actorId);
    setCallState('processing');
    const phrases = enqueueVoiceTtsPhrasesForMessage(voiceTtsTurn, voiceTtsTurn.messageIndex, next.content, false);
    playbackDelivery = new VoicePlaybackDelivery(voiceTtsTurn.sentenceTexts);
    appendTtsTimelinePhrases(phrases, 0);
    requestNextVoiceTtsPhrase();
    if (phrases.length === 0) finishTtsIfPlaybackDrained();
  }

  createEffect(() => {
    if (!isCallActive() || isInitializing()) return;
    for (const message of props.speechMessages ?? []) {
      if (message.voiceSessionId !== callSessionId || seenSpeechEventIds.has(message.eventId)) continue;
      seenSpeechEventIds.add(message.eventId);
      if (message.content.trim()) pendingSpeech.push({ ...message });
    }
    startNextSpeech();
  });

  // ============================================================================
  // Audio Capture
  // ============================================================================

  const getMicrophoneAudioConstraints = (): MediaTrackConstraints => {
    const microphoneId = selectedMicrophoneId();
    return {
      ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    };
  };

  const releaseCapture = (capture: MicrophoneCapture) => {
    if (capture.worklet) {
      capture.worklet.port.onmessage = null;
      capture.worklet.port.close();
      capture.worklet.disconnect();
      capture.worklet = undefined;
    }
    capture.analyser?.disconnect();
    capture.analyser = undefined;
    if (capture.context) {
      void Promise.resolve(capture.context.close()).catch(error => log.error('Microphone context close failed:', error));
      capture.context = undefined;
    }
    capture.stream?.getTracks().forEach(track => track.stop());
    capture.stream = undefined;
  };

  const startAudioCapture = async () => {
    stopAudioCapture();
    if (!microphoneRequest || isInitializing()) return;
    const capture: MicrophoneCapture = { request: microphoneRequest };
    activeCapture = capture;
    const ownsCapture = () => activeCapture === capture && ownsMicrophoneRequest(capture.request) && !isInitializing();
    try {
      try {
        capture.stream = await navigator.mediaDevices.getUserMedia({ audio: getMicrophoneAudioConstraints() });
      } catch (error) {
        if (!ownsCapture()) return;
        if (!selectedMicrophoneId()) throw error;
        log.error('[VoiceTab] Selected microphone failed, falling back to default:', error);
        setSelectedMicrophoneId('');
        await refreshMicrophones();
        if (!ownsCapture()) return;
        capture.stream = await navigator.mediaDevices.getUserMedia({ audio: getMicrophoneAudioConstraints() });
      }
      if (!ownsCapture()) { releaseCapture(capture); return; }
      await refreshMicrophones();
      if (!ownsCapture()) { releaseCapture(capture); return; }
      const context = new AudioContext({ sampleRate: 16000 });
      capture.context = context;
      await loadAudioWorkletModule(context);
      if (!ownsCapture()) { releaseCapture(capture); return; }
      const source = context.createMediaStreamSource(capture.stream!);
      const analyser = context.createAnalyser();
      capture.analyser = analyser;
      analyser.fftSize = 256;
      const worklet = new AudioWorkletNode(context, 'audio-processor', {
        processorOptions: { bufferSize: 4096, outputSampleRate: 16000 },
      });
      capture.worklet = worklet;
      worklet.port.onmessage = (event) => {
        if (!ownsCapture() || event.data.type !== 'audio') return;
        if (currentVoiceMode === 'push-to-talk' && !pttActive()) return;
        getBridge().voice.voiceSendAudioChunk(new Float32Array(event.data.samples), capture.request);
      };
      source.connect(analyser);
      analyser.connect(worklet);
      analyserNode = analyser;
      updateVisualizer(capture);
      setMicError('');
      setCallState(ttsPlaying ? 'speaking' : ttsGenerationActive || activeSpeech || props.isStreaming ? 'processing' : 'listening');
      setCaptureReady(true);
    } catch (err) {
      if (!ownsCapture()) { releaseCapture(capture); return; }
      stopAudioCapture();
      log.error('Microphone access error:', err);
      const key = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        ? 'mlearn.ConversationAgent.Voice.MicPermission' : 'mlearn.ConversationAgent.Voice.CaptureFailed';
      stopCall('failed', t(key));
    }
  };

  const stopAudioCapture = () => {
    setCaptureReady(false);
    const capture = activeCapture;
    activeCapture = null;
    if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    if (capture) releaseCapture(capture);
    analyserNode = null;
    setAudioLevel(0);
  };

  const updateVisualizer = (capture: MicrophoneCapture) => {
    if (activeCapture !== capture || !ownsMicrophoneRequest(capture.request)) return;
    if (!analyserNode || !isCallActive()) {
      animFrameId = null;
      return;
    }
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(dataArray);

    // Calculate average level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length / 255;
    setAudioLevel(avg);
    // Increment tick on every frame so the visualizer wave animates continuously
    // regardless of whether the audio level actually changed.
    setTick(t => t + 1);

    // Barge-in detection: when TTS is playing, local mic level above threshold
    // for several consecutive frames indicates the user is actually speaking
    // (not just echo from TTS output).
    if (ttsPlaying && Date.now() - ttsTurnStartTime > BARGE_IN_GRACE_MS) {
      if (avg > BARGE_IN_THRESHOLD) {
        bargeInFrames++;
        if (bargeInFrames >= BARGE_IN_FRAMES_REQUIRED) {
          log.info('[VoiceTab] Barge-in detected', { avg, threshold: BARGE_IN_THRESHOLD, frames: bargeInFrames });
          addDebugEvent('Interrupt', `Mic level ${avg.toFixed(2)} during TTS`, 'warn');
          bargeInFrames = 0;
          handleTTSInterruption();
          props.onAbort();
        }
      } else {
        bargeInFrames = 0;
      }
    }

    drawTtsTimeline();
    animFrameId = requestAnimationFrame(() => updateVisualizer(capture));
  };

  // ============================================================================
  // TTS Playback — Gapless Stream Scheduler
  // ============================================================================

  const deliveryFor = (message: VoiceSpeechMessage, state: VoiceDeliveryPayload['state']): VoiceDeliveryPayload => {
    const observation = message === activeSpeech ? playbackDelivery?.snapshot(ttsAudioContext?.currentTime ?? 0) : null;
    return { messageEventId: message.eventId, actorId: message.actorId, voiceSessionId: message.voiceSessionId, state,
      spokenText: observation?.spokenText ?? '', confirmedText: observation?.confirmedText ?? '', basis: observation?.basis ?? 'unavailable' };
  };

  const reportDeliveryFailure = (error: unknown) => {
    log.error('[VoiceTab] Delivery journal write failed', error);
    showToast({ message: t('mlearn.ConversationAgent.Voice.DeliveryRecordFailed'), variant: 'error' });
  };

  const finishTtsIfPlaybackDrained = () => {
    if (ttsGenerationActive || voiceTtsTurn.requestActive || voiceTtsTurn.pendingPhrases.length > 0 || ttsSources.length > 0 || settlingSpeech) return;
    setTtsPlaybackActive(false);
    bargeInFrames = 0;
    ttsNextStartTime = null;
    if (ttsPlaybackTimer) { clearTimeout(ttsPlaybackTimer); ttsPlaybackTimer = null; }
    const message = activeSpeech;
    if (!message || !isCallActive()) return;
    const complete = playbackDelivery?.snapshot(ttsAudioContext?.currentTime ?? 0).complete ?? false;
    const delivery = deliveryFor(message, complete ? 'completed' : 'failed');
    settlingSpeech = message;
    void (async () => {
      try {
        await props.onDelivery?.(delivery);
        if (activeSpeech !== message || !isCallActive()) return;
        activeSpeech = null;
        setActiveSpeakerId(null);
        playbackDelivery = null;
        settlingSpeech = null;
        if (!complete) {
          stopTTSPlayback();
          showToast({ message: t('mlearn.ConversationAgent.Voice.NoAudio'), variant: 'error' });
          props.onAbort();
        } else {
          startNextSpeech();
          if (activeSpeech) return;
        }
        setCallState('listening');
        scheduleIdleSilenceNudge('waiting');
      } catch (error) {
        if (activeSpeech === message) {
          stopTTSPlayback(true, 'failed', false);
          setCallState('listening');
          props.onAbort();
        }
        reportDeliveryFailure(error);
      } finally { if (settlingSpeech === message) settlingSpeech = null; }
    })();
  };

  const scheduleTtsAudio = (audio: VoiceTtsAudio) => {
    clearIdleSilenceTimer();
    clearScheduledNudgeTimer();
    if (!ttsAudioContext) {
      ttsAudioContext = new AudioContext();
    }

    setCallState('speaking');
    setTtsPlaybackActive(true);

    const buffer = ttsAudioContext.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.samples);

    const scheduled = scheduleAudioChunk(
      ttsAudioContext.currentTime,
      ttsNextStartTime,
      buffer.duration,
    );
    ttsNextStartTime = scheduled.nextStartTime;
    ttsScheduledDuration += buffer.duration;
    if (ttsTurnStartTime === 0) {
      ttsTurnStartTime = Date.now() + Math.max(0, scheduled.startAt - ttsAudioContext.currentTime) * 1000;
    }

    const phraseIndex = voiceTtsTurn.activePhraseIndex >= 0
      ? voiceTtsTurn.activePhraseIndex : (audio.sentenceIndex ?? Math.max(0, voiceTtsTurn.nextPhraseIndex - 1));
    const markEnded = playbackDelivery?.schedule(phraseIndex, scheduled.startAt, buffer.duration);
    appendTtsTimelineChunk(
      phraseIndex,
      audio.sampleCount ?? audio.samples.length,
      scheduled.startAt,
      buffer.duration,
    );
    setTtsChunkCount(count => count + 1);

    const source = ttsAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(ttsAudioContext.destination);
    ttsSources.push(source);
    setHasAudibleSpeech(true);

    source.onended = () => {
      if (!ttsSources.includes(source)) return;
      source.onended = null;
      ttsSources = ttsSources.filter((s) => s !== source);
      if (ttsSources.length === 0 && !(systemPhrase && systemPlaybackStarted && ttsGenerationActive)) {
        setHasAudibleSpeech(false);
        if (activeSpeech) setCallState('processing');
      }
      markEnded?.();
      ttsQueueIndex++;
      if (activeSpeech && (ttsSources.length > 0 || ttsGenerationActive || voiceTtsTurn.requestActive || voiceTtsTurn.pendingPhrases.length > 0)) {
        try { void Promise.resolve(props.onDelivery?.(deliveryFor(activeSpeech, 'playing'))).catch(reportDeliveryFailure); }
        catch (error) { reportDeliveryFailure(error); }
      }
      finishTtsIfPlaybackDrained();
    };

    source.start(scheduled.startAt);

    if (ttsPlaybackTimer) {
      clearTimeout(ttsPlaybackTimer);
    }
    const msUntilEnd = Math.max(0, (ttsNextStartTime - ttsAudioContext.currentTime) * 1000) + 50;
    ttsPlaybackTimer = setTimeout(finishTtsIfPlaybackDrained, msUntilEnd);
  };

  /** Capture the current actor before retiring audio; queued actors have no playback. */
  const handleTTSInterruption = () => {
    const delivery = activeSpeech ? deliveryFor(activeSpeech, 'interrupted') : null;
    markTtsTimelineInterrupted();
    setLastInterruption(delivery?.spokenText ?? '');
    addDebugEvent('Interrupted', `${delivery?.confirmedText.length ?? 0} chars in completed phrases`, 'warn');
    stopTTSPlayback(true, 'interrupted');
  };

  const stopTTSPlayback = (clearSpeech = true, state: VoiceDeliveryPayload['state'] = 'stopped', report = true) => {
    const request = activeTtsRequest;
    activeTtsRequest = null;
    if (clearSpeech) {
      const observations = [
        ...(activeSpeech && settlingSpeech !== activeSpeech ? [deliveryFor(activeSpeech, state)] : []),
        ...pendingSpeech.map(message => deliveryFor(message, 'stopped')),
      ];
      activeSpeech = null;
      setActiveSpeakerId(null);
      pendingSpeech = [];
      playbackDelivery = null;
      settlingSpeech = null;
      if (report) for (const observation of observations) {
        try { void Promise.resolve(props.onDelivery?.(observation)).catch(reportDeliveryFailure); }
        catch (error) { reportDeliveryFailure(error); }
      }
    }
    for (const source of ttsSources) {
      source.onended = null;
      try { source.stop(); } catch (e) {
        log.error("error", e);
      }
    }
    ttsSources = [];
    setHasAudibleSpeech(false);
    setTtsPlaybackActive(false);
    ttsGenerationActive = false;
    abortVoiceTtsTurn(voiceTtsTurn);
    ttsAborted = true; // reject any in-flight audio from this generation
    ttsQueue = [];
    ttsQueueIndex = 0;
    ttsNextStartTime = null;
    ttsTurnStartTime = 0;
    ttsScheduledDuration = 0;
    bargeInFrames = 0;
    if (ttsPlaybackTimer) {
      clearTimeout(ttsPlaybackTimer);
      ttsPlaybackTimer = null;
    }
    if (ttsAudioContext) {
      ttsAudioContext.close();
      ttsAudioContext = null;
    }
    getBridge().voice.voiceTtsStop(request ?? { sessionId: callSessionId });
  };

  // ============================================================================
  // Call Lifecycle
  // ============================================================================

  const startCall = async () => {
    if (!supportsCalls) {
      const explanation = t('mlearn.ConversationAgent.Voice.CallsUnavailable');
      setInitError(explanation);
      props.onCallStateChange?.(false, 'failed', explanation);
      return;
    }
    callSessionId = crypto.randomUUID();
    microphoneRequest = { variant: (settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants)[props.language] ?? null, sessionId: callSessionId, requestId: crypto.randomUUID() };
    greetingRequested = false;
    seenSpeechEventIds = new Set((props.speechMessages ?? []).map(message => message.eventId));
    activeSpeech = null;
    setActiveSpeakerId(null);
    pendingSpeech = [];
    speechTurnIndex = 0;
    log.info('[VoiceTab] Starting voice call', {
      language: props.language,
      mode: voiceMode(),
      ttsProvider: activeTtsProvider(),
    });
    clearNoTranscriptRecovery();
    clearIdleSilenceTimer();
    clearScheduledNudgeTimer();
    lastIdleSilenceNudgeAt = 0;
    setIsInitializing(true);
    setInitError('');
    setIsCallActive(true);
    props.onCallStateChange?.(true, undefined, undefined, callSessionId);
    setCallState('idle');
    setPartialTranscript('');
    setTtsChunkCount(0);
    setLastInterruption('');
    setDebugEvents([]);
    setVadDebug(null);
    resetTtsTimeline();
    addDebugEvent('Session', `Starting ${activeTtsProvider()} voice backend`, 'info');
    setSessionStatus({
      stage: 'starting',
      message: t('mlearn.ConversationAgent.Voice.Initializing'),
      progress: 0,
    });

    // Start voice session — engines init in main process.
    // The VOICE_SESSION_READY event will confirm when engines are loaded,
    // and VOICE_SESSION_ERROR will fire if initialization fails.
    // Audio capture is deferred until session is ready (see createEffect below).
    getBridge().voice.voiceStartSession(
      props.language,
      voiceMode(),
      settings.voiceSilenceThreshold ?? DEFAULT_SETTINGS.voiceSilenceThreshold,
      activeTtsProvider(),
      microphoneRequest,
    );
  };

  onMount(() => {
    if (props.autoStartCall) void startCall();
  });

  // Start audio capture when the voice session becomes ready.
  // Uses on() to limit reactive tracking to only the session-readiness signals
  // and prevent re-running when messages or streaming state change.
  let audioCaptureStarted = false;
  createEffect(
    on(
      [isCallActive, isInitializing, initError],
      () => {
        if (isCallActive() && !isInitializing() && !initError()) {
          if (!audioCaptureStarted) {
            audioCaptureStarted = true;
            startAudioCapture();
          }
        } else {
          audioCaptureStarted = false;
        }
      },
    ),
  );

  // Request a greeting when the call starts and there are no messages yet.
  createEffect(() => {
    if (isCallActive() && !isInitializing() && !initError()) {
      if (captureReady() && !greetingRequested && props.messages.length === 0 && !props.isStreaming) {
        greetingRequested = true;
        props.onRequestGreeting();
      }
    }
  });

  const stopCall = (reason: 'completed' | 'cleanup' | 'failed' = 'completed', failure?: string) => {
    if (!isCallActive() && !isInitializing()) return;

    const request = microphoneRequest;
    microphoneRequest = null;
    keyboardPttHeld = false;
    setPttActive(false);
    setIsCallActive(false);
    if (reason === 'failed' || (reason === 'completed' && props.isStreaming)) props.onAbort();
    stopTTSPlayback(true, reason === 'failed' ? 'failed' : 'stopped');
    setIsInitializing(false);
    setSessionStatus(null);
    setCallState('idle');
    setPartialTranscript('');
    clearNoTranscriptRecovery();
    clearIdleSilenceTimer();
    clearScheduledNudgeTimer();

    stopAudioCapture();
    if (request) getBridge().voice.voiceStopSession(request);
    if (failure) setInitError(failure);
    if (failure) props.onCallStateChange?.(false, reason, failure);
    else props.onCallStateChange?.(false, reason);
  };

  // ============================================================================
  // Model Download
  // ============================================================================

  const handleDownloadModels = () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    getBridge().voice.voiceDownloadModels(props.language);
  };

  // ============================================================================
  // Settings Updates
  // ============================================================================

  const setVoiceMode = (mode: VoiceMode) => {
    updateSettings({ ...settings, voiceMode: mode });
  };

  createEffect(
    on(
      () => settings.voiceMode,
      (mode, prevMode) => {
        if (mode !== prevMode && isCallActive()) {
          const previous = microphoneRequest;
          microphoneRequest = { variant: (settings.languageVariants ?? DEFAULT_SETTINGS.languageVariants)[props.language] ?? null, sessionId: callSessionId, requestId: crypto.randomUUID() };
          setIsInitializing(true);
          keyboardPttHeld = false;
          setPttActive(false);
          setPartialTranscript('');
          clearNoTranscriptRecovery();
          clearIdleSilenceTimer();
          stopAudioCapture();
          if (previous) getBridge().voice.voiceStopSession(previous);
          getBridge().voice.voiceStartSession(
            props.language,
            mode ?? DEFAULT_SETTINGS.voiceMode,
            settings.voiceSilenceThreshold ?? DEFAULT_SETTINGS.voiceSilenceThreshold,
            activeTtsProvider(),
            microphoneRequest,
          );
        }
      },
      { defer: true },
    ),
  );

  const setSilenceThreshold = (threshold: number) => {
    updateSettings({ ...settings, voiceSilenceThreshold: threshold });
    // Update the server-side threshold in real-time
    if (microphoneRequest) getBridge().voice.voiceUpdateSilenceThreshold(threshold, microphoneRequest);
  };

  const ttsChoiceOptions = (): SelectOption[] => [
    { value: 'system', label: t('mlearn.ConversationAgent.Voice.SystemVoice') },
    { value: 'lightweight', label: t('mlearn.ConversationAgent.Voice.LightweightVoice') },
    { value: 'voice-clone', label: t('mlearn.ConversationAgent.Voice.VoiceSample') },
  ];

  const activeTtsProvider = (): LocalVoiceTtsProvider => providerFromVoiceTtsChoice(ttsChoice());
  const activeTtsLabel = () => (
    ttsChoiceOptions().find(option => option.value === ttsChoice())?.label ?? activeTtsProvider()
  );

  const agentVoiceSampleExists = async (): Promise<boolean> => {
    const ids = [...new Set([...(props.voiceSampleIds ?? []), ...(props.defaultVoiceSampleId ? [props.defaultVoiceSampleId] : [])])];
    try {
      for (const id of ids) {
        if (await getBridge().voice.voiceSampleGetPath(id)) return true;
      }
      return false;
    } catch (error) {
      log.error('[VoiceTab] Failed to validate agent voice sample:', error);
      return false;
    }
  };

  const handleTtsChoiceChange = async (event: Event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value as VoiceTtsChoice;
    if (next === 'voice-clone' && !(await agentVoiceSampleExists())) {
      showToast({
        message: t('mlearn.ConversationAgent.Voice.AddAgentVoice'),
        variant: 'warning',
        duration: 5000,
      });
      setTtsChoice('system');
      select.value = 'system';
      return;
    }

    setTtsChoice(next);
    updateSettings({ ...settings, ttsProvider: providerFromVoiceTtsChoice(next) });
  };

  const handleMicrophoneChange = async (event: Event) => {
    const select = event.currentTarget as HTMLSelectElement;
    setSelectedMicrophoneId(select.value);
    if (isCallActive() && !isInitializing()) {
      await startAudioCapture();
    }
  };

  createEffect(
    on(
      () => settings.ttsProvider,
      (savedProvider) => {
        const savedChoice = voiceTtsChoiceFromProvider(savedProvider ?? DEFAULT_SETTINGS.ttsProvider);
        if (ttsChoice() !== savedChoice) {
          setTtsChoice(savedChoice);
        }
      },
    ),
  );

  // ============================================================================
  // PTT Handlers
  // ============================================================================

  const isEditableKeyTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable
      || !!target.closest('input, textarea, select, button, a[href], summary, [role="button"], [role="menuitem"]');
  };
  let keyboardPttHeld = false;

  const canUseKeyboardPtt = () => (
    isCallActive()
    && !isInitializing()
    && voiceMode() === 'push-to-talk'
  );

  const handlePttDown = () => setPttActive(true);
  const handlePttUp = () => {
    if (pttActive()) {
      setPttActive(false);
      // Flush the server-side speech buffer so it immediately runs STT
      if (microphoneRequest) getBridge().voice.voiceFlush(microphoneRequest);
    }
  };

  const handlePttKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || event.repeat || event.isComposing || event.keyCode === 229
      || event.defaultPrevented || isEditableKeyTarget(event.target)) return;
    if (!canUseKeyboardPtt()) return;
    event.preventDefault();
    keyboardPttHeld = true;
    handlePttDown();
  };

  const handlePttKeyUp = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || !keyboardPttHeld) return;
    event.preventDefault();
    keyboardPttHeld = false;
    handlePttUp();
  };
  const releaseKeyboardPttOnBlur = () => {
    if (!keyboardPttHeld) return;
    keyboardPttHeld = false;
    handlePttUp();
  };

  onMount(() => {
    window.addEventListener('keydown', handlePttKeyDown);
    window.addEventListener('keyup', handlePttKeyUp);
    window.addEventListener('blur', releaseKeyboardPttOnBlur);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handlePttKeyDown);
    window.removeEventListener('keyup', handlePttKeyUp);
    window.removeEventListener('blur', releaseKeyboardPttOnBlur);
  });

  // ============================================================================
  // Derived State
  // ============================================================================

  const modelsReady = () => {
    const s = modelStatus();
    return s && s.sttDownloaded && (ttsChoice() === 'system' || s.ttsDownloaded) && s.vadDownloaded;
  };

  const statusText = () => {
    if (isCallActive() && !isInitializing() && !captureReady()) return t('mlearn.ConversationAgent.Voice.PreparingMicrophone');
    const state = callState();
    switch (state) {
      case 'listening': return t('mlearn.ConversationAgent.Voice.Listening');
      case 'processing': return t('mlearn.ConversationAgent.Voice.Processing');
      case 'speaking': return t('mlearn.ConversationAgent.Voice.Speaking');
      default: return '';
    }
  };

  createEffect(() => props.onStatusChange?.(
    isChecking() ? t('mlearn.ConversationAgent.Voice.CheckingModels')
      : isInitializing() ? sessionStatus()?.message || t('mlearn.ConversationAgent.Voice.CheckingModels')
      : statusText(),
  ));

  const agentName = () => props.agentName?.trim() ?? '';
  const hasProfilePhoto = () => Boolean(props.profilePhoto);
  const isAgentSpeaking = hasAudibleSpeech;
  const callViewState = () => {
    if (isInitializing() || (isCallActive() && !captureReady()) || ttsModelLoading()) return 'loading';
    if (!isCallActive()) return 'idle';
    return callState();
  };

  /** Map call state to the active pipeline stage label */
  const activeStage = (): 'stt' | 'llm' | 'tts' | null => {
    if (!isCallActive()) return null;
    const state = callState();
    switch (state) {
      case 'listening': return 'stt';
      case 'processing': return 'llm';
      case 'speaking': return 'tts';
      default: return null;
    }
  };

  // Generate bar heights for visualizer
  const barCount = 12;
  const callWaveBarCount = 16;
  const getBarHeight = (index: number) => {
    void tick();
    if (!isCallActive() || callState() !== 'listening') return 4;
    const envelope = 0.45 + 0.55 * Math.sin(Math.PI * (index + 1) / (barCount + 1));
    return 4 + audioLevel() * 42 * envelope;
  };
  const getCallBarHeight = (index: number) => {
    if (!isCallActive() || callState() !== 'listening') return 4;
    const envelope = 0.4 + 0.6 * Math.sin(Math.PI * (index + 1) / (callWaveBarCount + 1));
    return 4 + audioLevel() * 32 * envelope;
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div class="voice-tab">
      <div class="voice-call-context">
        <div>
          <strong>{t((props.participants?.length ?? 0) > 1
            ? 'mlearn.ConversationAgent.Voice.AiGroupCall' : 'mlearn.ConversationAgent.Voice.AiCall')}</strong>
          <Show when={props.contextLabel}><span>{props.contextLabel}</span></Show>
        </div>
        <Show when={props.onDismiss}><Button variant="ghost" onClick={() => {
          stopCall('cleanup'); props.onDismiss?.();
        }}>{t(isCallActive() ? 'mlearn.ConversationAgent.Voice.EndAndReturn' : 'mlearn.ConversationAgent.Voice.ReturnToChat')}</Button></Show>
      </div>
      {/* Mic error banner */}
      <Show when={micError()}>
        <AlertBanner
          variant="error"
          message={micError()}
          size="sm"
          closable
          onClose={() => setMicError('')}
        />
      </Show>

      {/* Init error banner */}
      <Show when={initError()}>
        <AlertBanner
          variant="error"
          message={initError()}
          size="sm"
          closable
          onClose={() => setInitError('')}
        />
      </Show>

      <Show when={!supportsCalls && !initError()}>
        <AlertBanner variant="info" message={t('mlearn.ConversationAgent.Voice.CallsUnavailable')} size="sm" />
      </Show>

      {/* Checking model status */}
      <Show when={isChecking()}>
        <div class="voice-download-section">
          <Spinner
            size={44}
            shape="square"
            strokeWidth={8}
            cornerRadius={0}
            text={t('mlearn.ConversationAgent.Voice.CheckingModels')}
          />
        </div>
      </Show>

      {/* Model download required */}
      <Show when={supportsCalls && !isChecking() && !modelsReady() && !isDownloading()}>
        <div class="voice-download-section">
          <Show when={modelStatus()?.error}>
            <AlertBanner
              variant="error"
              message={t('mlearn.ConversationAgent.Voice.DownloadFailed')}
              size="sm"
            />
          </Show>
          <EmptyState
            icon={<MicrophoneIcon size={24} />}
            title={t('mlearn.ConversationAgent.Voice.DownloadModels')}
            description={t('mlearn.ConversationAgent.Voice.ModelsRequired')}
          />
          <Button
            variant="primary"
            onClick={handleDownloadModels}
            disabled={!props.isConnected}
          >
            {t('mlearn.ConversationAgent.Voice.DownloadModels')}
          </Button>
        </div>
      </Show>

      {/* Download progress */}
      <Show when={isDownloading()}>
        <div class="voice-download-section">
          <p class="voice-download-hint">
            {modelStatus()?.statusMessage
              || (downloadProgress() < 50
                ? t('mlearn.ConversationAgent.Voice.InstallingDependencies')
                : t('mlearn.ConversationAgent.Voice.DownloadingModels'))}
          </p>
          <ProgressBar value={downloadProgress()} showPercent variant="primary" size="md" />
        </div>
      </Show>

      {/* Main voice UI (models ready) */}
      <Show when={supportsCalls && !isChecking() && modelsReady() && !isDownloading()}>
        <div class="voice-call-area">
          <Show when={ttsChoice() === 'voice-clone'}>
            <p class="voice-download-hint">{t('mlearn.ConversationAgent.Voice.ContactVoices')}</p>
          </Show>
          {/* CPU compute warning — status-driven, never blocks session controls */}
          <Show when={cpuVoiceWarning()}>
            <AlertBanner
              variant="warning"
              message={t('mlearn.ConversationAgent.Voice.CpuWarning')}
              size="sm"
              class="voice-cpu-warning"
            />
          </Show>
          <Show
            when={showAdvancedUi()}
            fallback={
              <div class={`voice-call-fullscreen voice-call-fullscreen--${callViewState()}`}>
                <button
                  type="button"
                  class="voice-call-advanced-button"
                  onClick={() => setShowAdvancedUi(true)}
                >
                  {t('mlearn.ConversationAgent.Voice.Advanced')}
                </button>

                <div class="voice-call-stage">
                  <Show when={props.participants?.length} fallback={<>
                  <div
                    class={`voice-call-avatar-shell ${hasProfilePhoto() ? 'has-photo' : 'no-photo'} ${isAgentSpeaking() ? 'speaking' : ''} ${isInitializing() || ttsModelLoading() ? 'loading' : ''}`}
                    aria-hidden={!agentName()}
                  >
                    <Show
                      when={props.profilePhoto}
                      fallback={<div class="voice-call-avatar-blob" />}
                    >
                      {(src) => (
                        <img
                          class="voice-call-avatar-image"
                          src={src()}
                          alt={agentName()}
                        />
                      )}
                    </Show>
                  </div>

                  <Show when={agentName()}>
                    <div class="voice-call-agent-name">{agentName()}</div>
                  </Show>
                  </>}>
                    <CallParticipants participants={props.participants!}
                      speakingActorId={isAgentSpeaking() ? activeSpeakerId() : null}
                      usingVoiceSamples={ttsChoice() === 'voice-clone'} voiceLabel={ttsChoice() === 'voice-clone' ? t('mlearn.ConversationAgent.Voice.SystemVoice') : activeTtsLabel()} />
                  </Show>

                  <Show when={!isInitializing() && !ttsModelLoading()}>
                    <div class={`voice-call-state ${isCallActive() ? 'active' : ''}`} role="status">
                      {isCallActive() ? statusText() : ''}
                    </div>
                  </Show>
                </div>

                <div class="voice-call-bottom">
                  <div class={`voice-call-waveform voice-call-waveform--${callViewState()}`} aria-hidden="true">
                    {Array.from({ length: callWaveBarCount }).map((_, i) => (
                      <span class="voice-call-waveform-bar" style={{ height: `${getCallBarHeight(i)}px` }} />
                    ))}
                  </div>

                  <div class="voice-call-control-strip">
                    <Show
                      when={isCallActive()}
                      fallback={
                        <div class="voice-start-panel voice-start-panel--call">
                          <Button
                            variant="primary"
                            icon={<PhoneIcon />}
                            onClick={startCall}
                            disabled={!props.isConnected}
                          >
                            {t('mlearn.ConversationAgent.Voice.StartCall')}
                          </Button>
                          <div class="voice-start-selectors">
                            <Select
                              options={ttsChoiceOptions()}
                              value={ttsChoice()}
                              onChange={handleTtsChoiceChange}
                              aria-label={t('mlearn.ConversationAgent.Voice.TtsProvider')}
                              size="sm"
                            />
                            <Select
                              options={microphoneOptions()}
                              value={selectedMicrophoneId()}
                              onChange={handleMicrophoneChange}
                              aria-label={t('mlearn.ConversationAgent.Voice.Microphone')}
                              size="sm"
                            />
                          </div>
                        </div>
                      }
                    >
                      <Show when={!isInitializing()}>
                        <div class="voice-mode-toggle voice-mode-toggle--call">
                          <Button
                            size="sm"
                            variant={voiceMode() === 'vad' ? 'primary' : 'ghost'}
                            onClick={() => setVoiceMode('vad')}
                            class="voice-mode-btn"
                          >
                            {t('mlearn.ConversationAgent.Voice.HandsFree')}
                          </Button>
                          <Button
                            size="sm"
                            variant={voiceMode() === 'push-to-talk' ? 'primary' : 'ghost'}
                            onClick={() => setVoiceMode('push-to-talk')}
                            class="voice-mode-btn"
                          >
                            {t('mlearn.ConversationAgent.Voice.PushToTalk')}
                          </Button>
                        </div>
                      </Show>

                      <Button buttonType="icon"
                        variant="danger"
                        size="lg"
                        icon={<PhoneOffIcon />}
                        onClick={() => stopCall()}
                        aria-label={t('mlearn.ConversationAgent.Voice.EndCall')}
                        class="voice-end-btn voice-end-btn--call"
                      />

                      <Show when={!isInitializing()}>
                        <Select
                          options={microphoneOptions()}
                          value={selectedMicrophoneId()}
                          onChange={handleMicrophoneChange}
                          aria-label={t('mlearn.ConversationAgent.Voice.Microphone')}
                          size="sm"
                        />
                      </Show>
                    </Show>
                  </div>

                  <Show when={isCallActive() && !isInitializing() && voiceMode() === 'push-to-talk'}>
                    <button
                      type="button"
                      class={`voice-call-ptt ${pttActive() ? 'active' : ''}`}
                      onMouseDown={handlePttDown}
                      onMouseUp={handlePttUp}
                      onMouseLeave={handlePttUp}
                      onTouchStart={handlePttDown}
                      onTouchEnd={handlePttUp}
                      aria-label={t('mlearn.ConversationAgent.Voice.PushToTalk')}
                      aria-keyshortcuts="Space"
                    >
                      {t('mlearn.ConversationAgent.Voice.PushToTalk')}
                    </button>
                  </Show>
                </div>
              </div>
            }
          >
          {/* Call UI */}
          <div class="voice-call-ui">
            <Show when={props.participants?.length}>
              <CallParticipants participants={props.participants!}
                speakingActorId={isAgentSpeaking() ? activeSpeakerId() : null}
                usingVoiceSamples={ttsChoice() === 'voice-clone'} voiceLabel={ttsChoice() === 'voice-clone' ? t('mlearn.ConversationAgent.Voice.SystemVoice') : activeTtsLabel()} />
            </Show>
            <button
              type="button"
              class="voice-call-view-button"
              onClick={() => setShowAdvancedUi(false)}
            >
              {t('mlearn.ConversationAgent.Voice.CallView')}
            </button>
            {/* Initializing engines indicator */}
            <Show when={isInitializing()}>
              <div class="voice-initializing">
                <div class="voice-initializing-row">
                  <Spinner size={32} shape="square" strokeWidth={6} cornerRadius={0} />
                  <span class="voice-initializing-text">
                    {sessionStatus()?.message || t('mlearn.ConversationAgent.Voice.Initializing')}
                  </span>
                </div>
                <div class="voice-initializing-row">
                  <ProgressBar
                    value={Math.round((sessionStatus()?.progress ?? 0) * 100)}
                    showPercent
                    variant="primary"
                    size="sm"
                    class="voice-initializing-progress"
                  />
                </div>
              </div>
            </Show>

            {/* TTS model loading indicator */}
            <Show when={!isInitializing() && ttsModelLoading()}>
              <div class="voice-initializing">
                <div class="voice-initializing-row">
                  <Spinner size={32} shape="square" strokeWidth={6} cornerRadius={0} />
                  <span class="voice-initializing-text">
                    {t('mlearn.ConversationAgent.Voice.LoadingTtsModel')}
                  </span>
                </div>
                <div class="voice-initializing-row">
                  <ProgressBar
                    value={Math.round(ttsDownloadProgress() * 100)}
                    showPercent
                    variant="primary"
                    size="sm"
                    animated={ttsDownloadProgress() < 0.05}
                    class="voice-initializing-progress"
                  />
                </div>
              </div>
            </Show>

            {/* Visualizer */}
            <Show when={!isInitializing()}>
              <div class="voice-visualizer">
                {Array.from({ length: barCount }).map((_, i) => (
                  <div
                    class={`voice-bar ${isCallActive() ? '' : 'idle'}`}
                    style={{ height: `${getBarHeight(i)}px` }}
                  />
                ))}
              </div>

              {/* Status */}
              <div class={`voice-status-text ${isCallActive() ? 'active' : ''}`}>
                {isCallActive() ? statusText() : ''}
              </div>
            </Show>

            {/* Controls */}
            <div class="voice-controls">
              <Show
                when={isCallActive()}
                fallback={
                  <div class="voice-start-panel">
                    <Button
                      variant="primary"
                      icon={<PhoneIcon />}
                      onClick={startCall}
                      disabled={!props.isConnected}
                    >
                      {t('mlearn.ConversationAgent.Voice.StartCall')}
                    </Button>
                    <div class="voice-start-selectors">
                      <Select
                        options={ttsChoiceOptions()}
                        value={ttsChoice()}
                        onChange={handleTtsChoiceChange}
                        aria-label={t('mlearn.ConversationAgent.Voice.TtsProvider')}
                        size="sm"
                      />
                      <Select
                        options={microphoneOptions()}
                        value={selectedMicrophoneId()}
                        onChange={handleMicrophoneChange}
                        aria-label={t('mlearn.ConversationAgent.Voice.Microphone')}
                        size="sm"
                      />
                    </div>
                  </div>
                }
              >
                {/* Mode toggle */}
                <Show when={!isInitializing()}>
                  <div class="voice-mode-toggle">
                    <Button
                      size="sm"
                      variant={voiceMode() === 'vad' ? 'primary' : 'ghost'}
                      onClick={() => setVoiceMode('vad')}
                      class="voice-mode-btn"
                    >
                      {t('mlearn.ConversationAgent.Voice.HandsFree')}
                    </Button>
                    <Button
                      size="sm"
                      variant={voiceMode() === 'push-to-talk' ? 'primary' : 'ghost'}
                      onClick={() => setVoiceMode('push-to-talk')}
                      class="voice-mode-btn"
                    >
                      {t('mlearn.ConversationAgent.Voice.PushToTalk')}
                    </Button>
                  </div>
                </Show>

                {/* End call */}
                <Button buttonType="icon"
                  variant="danger"
                  size="lg"
                  icon={<PhoneOffIcon />}
                  onClick={() => stopCall()}
                  aria-label={t('mlearn.ConversationAgent.Voice.EndCall')}
                  class="voice-end-btn"
                />
              </Show>
            </div>

            {/* PTT button (only in push-to-talk mode during active call) */}
            <Show when={isCallActive() && !isInitializing() && voiceMode() === 'push-to-talk'}>
              <Button buttonType="icon"
                icon={<MicIcon />}
                variant={pttActive() ? 'primary' : 'ghost'}
                class={`voice-ptt-btn ${pttActive() ? 'active' : ''}`}
                onMouseDown={handlePttDown}
                onMouseUp={handlePttUp}
                onMouseLeave={handlePttUp}
                onTouchStart={handlePttDown}
                onTouchEnd={handlePttUp}
                aria-label={t('mlearn.ConversationAgent.Voice.PushToTalk')}
                aria-keyshortcuts="Space"
              />
            </Show>

            <Show when={isCallActive() && !isInitializing()}>
              <div class="voice-start-selectors">
                <Select
                  options={microphoneOptions()}
                  value={selectedMicrophoneId()}
                  onChange={handleMicrophoneChange}
                  aria-label={t('mlearn.ConversationAgent.Voice.Microphone')}
                  size="sm"
                />
              </div>
            </Show>

            {/* Silence threshold control (VAD mode only) */}
            <Show when={isCallActive() && !isInitializing() && voiceMode() === 'vad'}>
              <div class="voice-speed-row">
                <label>{t('mlearn.ConversationAgent.Voice.SilenceThreshold')}</label>
                <RangeInput
                  min={0.3}
                  max={5.0}
                  step={0.1}
                  value={silenceThreshold()}
                  onChange={(v) => setSilenceThreshold(v)}
                />
                <span class="voice-speed-value">{silenceThreshold().toFixed(1)}s</span>
              </div>
            </Show>

            <Show when={settings.devMode && isCallActive() && !isInitializing()}>
              <details class="voice-advanced">
                <summary>{t('mlearn.ConversationAgent.Voice.Advanced')}</summary>
                <div class="voice-debug-panel">
                  <div class="voice-stage-indicator" aria-label={t('mlearn.ConversationAgent.Voice.Pipeline')}>
                    <span class={`voice-stage-pill ${activeStage() === 'stt' ? 'active' : ''}`}>
                      {t('mlearn.ConversationAgent.Voice.Stage.STT')}
                    </span>
                    <span class="voice-stage-arrow">›</span>
                    <span class={`voice-stage-pill ${activeStage() === 'llm' ? 'active' : ''}`}>
                      {t('mlearn.ConversationAgent.Voice.Stage.LLM')}
                    </span>
                    <span class="voice-stage-arrow">›</span>
                    <span class={`voice-stage-pill ${activeStage() === 'tts' ? 'active' : ''}`}>
                      {t('mlearn.ConversationAgent.Voice.Stage.TTS')}
                    </span>
                  </div>

                  <div class="voice-chunk-row">
                    <span>{t('mlearn.ConversationAgent.Voice.StreamedChunks')}</span>
                    <strong>{ttsChunkCount()}</strong>
                  </div>
                  <canvas
                    ref={ttsTimelineCanvas}
                    class="voice-chunk-canvas"
                    aria-label={t('mlearn.ConversationAgent.Voice.StreamedChunks')}
                  />

                  <div class="voice-debug-grid">
                    <span>{t('mlearn.ConversationAgent.Voice.Provider')}</span>
                    <strong>{activeTtsLabel()}</strong>
                    <span>{t('mlearn.ConversationAgent.Voice.Mode')}</span>
                    <strong>{voiceMode() === 'vad' ? t('mlearn.ConversationAgent.Voice.HandsFree') : t('mlearn.ConversationAgent.Voice.PushToTalk')}</strong>
                    <span>{t('mlearn.ConversationAgent.Voice.Interrupt')}</span>
                    <strong>{lastInterruption() || t('mlearn.ConversationAgent.Voice.None')}</strong>
                    <span>VAD</span>
                    <strong>{vadDebugSummary()}</strong>
                  </div>

                  <div class="voice-debug-events">
                    <Index each={debugEvents()}>
                      {(event) => (
                        <div class={`voice-debug-event ${event().tone}`}>
                          <time>{event().time}</time>
                          <strong>{event().label}</strong>
                          <span>{event().detail}</span>
                        </div>
                      )}
                    </Index>
                  </div>
                </div>
              </details>
            </Show>

          </div>

          {/* Messages (shared with chat tab) */}
          <div class="voice-messages" ref={messagesRef}>
            <Show
              when={props.messages.length > 0 || partialTranscript()}
              fallback={
                <EmptyState
                  icon={<MicrophoneIcon size={24} />}
                  title={t('mlearn.ConversationAgent.Voice.StartCall')}
                  description={t('mlearn.ConversationAgent.Voice.EmptyHint')}
                  class="ca-empty"
                />
              }
            >
              <Index each={props.messages}>
                {(msg, index) => (
                  <Show when={msg().role !== 'tool'}>
                    <ChatBubble
                      message={msg()}
                      isStreaming={props.isStreaming && index === props.messages.length - 1 && msg().role === 'assistant'}
                      isWaiting={false}
                      onTokenHover={props.onTokenHover}
                      onTokenLeave={props.onTokenLeave}
                      triggerMode={props.triggerMode}
                      triggerKey={props.triggerKey}
                    />
                  </Show>
                )}
              </Index>
              {/* Live STT user bubble — shows partial transcript as a real-time updating user message */}
              <Show when={partialTranscript()}>
                <ChatBubble
                  message={{
                    role: 'user',
                    content: partialTranscript(),
                    timestamp: Date.now(),
                  }}
                  isStreaming={true}
                  isWaiting={false}
                />
              </Show>
            </Show>
          </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
