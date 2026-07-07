/**
 * VoiceTab — Real-time voice conversation UI for the Conversation Agent.
 * Captures audio via getUserMedia, streams PCM to main process for STT/VAD,
 * plays back TTS audio via Web Audio API with sentence-level interruption tracking.
 */

import { Component, Show, createSignal, createEffect, on, onCleanup, Index, onMount } from 'solid-js';
import { useSettings, useLocalization, useLowPowerGate } from '../../context';
import { getBridge } from '../../../shared/bridges';
import {
  Btn,
  IconBtn,
  ProgressBar,
  RangeInput,
  EmptyState,
  AlertBanner,
  Spinner,
  Select,
  MicrophoneIcon,
} from '../../components/common';
import type { SelectOption } from '../../components/common';
import { showToast } from '../../components/common/Feedback/Toast';
import { ChatBubble } from './ChatBubble';
import type { ConversationMessage, VoiceModelStatus, VoiceSTTResult, VoiceTtsAudio, VoiceMode, Token, VoiceSessionStatus, VoiceCallTTSProvider } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import './VoiceTab.css';
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
  messages: ConversationMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onRequestGreeting: () => void;
  onAbort: () => void;
  /** Called when user interrupts TTS — provides the text spoken so far and remaining text */
  onInterrupted?: (spokenText: string, interruptedAt: string) => void;
  /** Called when voice call starts or stops */
  onCallStateChange?: (active: boolean, reason?: 'completed' | 'failed' | 'cleanup') => void;
  onTokenHover?: (token: Token, rect: DOMRect, el: HTMLElement) => void;
  onTokenLeave?: () => void;
  triggerMode?: WordHoverTriggerMode;
  triggerKey?: string;
  isConnected: boolean;
  language: string;
  /** Default voice sample from the agent config */
  defaultVoiceSampleId?: string;
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
  const [modelStatus, setModelStatus] = createSignal<VoiceModelStatus | null>(null);
  const [isChecking, setIsChecking] = createSignal(true);
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [downloadProgress, setDownloadProgress] = createSignal(0);
  const [isInitializing, setIsInitializing] = createSignal(false);
  const [initError, setInitError] = createSignal('');
  const [callState, setCallState] = createSignal<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const [partialTranscript, setPartialTranscript] = createSignal('');
  const [pttActive, setPttActive] = createSignal(false);
  const [audioLevel, setAudioLevel] = createSignal(0);
  const [micError, setMicError] = createSignal('');
  const [ttsModelLoading, setTtsModelLoading] = createSignal(false);
  const [ttsDownloadProgress, setTtsDownloadProgress] = createSignal(0);
  const [sessionStatus, setSessionStatus] = createSignal<VoiceSessionStatus | null>(null);
  const [ttsChunkCount, setTtsChunkCount] = createSignal(0);
  const [lastInterruption, setLastInterruption] = createSignal('');
  const [debugEvents, setDebugEvents] = createSignal<VoiceDebugEvent[]>([]);
  const [microphones, setMicrophones] = createSignal<MediaDeviceInfo[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = createSignal('');
  // Tick counter drives continuous visualizer animation independent of audio level
  const [tick, setTick] = createSignal(0);

  const [ttsChoice, setTtsChoice] = createSignal<VoiceTtsChoice>(
    voiceTtsChoiceFromProvider(settings.ttsProvider ?? DEFAULT_SETTINGS.ttsProvider),
  );

  // Refs
  let messagesRef: HTMLDivElement | undefined;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
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
  let ttsCurrentSentenceIdx = 0;
  let ttsAudioContext: AudioContext | null = null; // separate context for TTS playback
  let ttsNextStartTime: number | null = null;
  let ttsPlaybackTimer: ReturnType<typeof setTimeout> | null = null;

  // TTS generation guard — prevents stale audio from playing after cancellation
  let ttsAborted = false;
  // Sentence timing for estimating interruption position within a sentence
  let ttsCurrentSentenceStartTime = 0;
  let ttsCurrentSentenceDuration = 0;
  let ttsTimingPhraseIndex = -1;
  let ttsTurnStartTime = 0;
  let ttsScheduledDuration = 0;
  let currentTtsText = '';
  let ttsHadError = false;
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
    const time = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const event = { id: debugEventId++, time, label, detail, tone };
    setDebugEvents(events => [event, ...events].slice(0, 10));
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

  // Set up IPC listeners once on mount, clean up on unmount
  onMount(() => {
    const bridge = getBridge();
    const cleanups: Array<() => void> = [];
    refreshMicrophones();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMicrophones);

    // Model download progress
    cleanups.push(bridge.voice.onVoiceModelProgress((status) => {
      setModelStatus(status);
      setIsDownloading(status.downloading);
      setDownloadProgress(Math.round(status.progress * 100));
    }));

    // STT results
    cleanups.push(bridge.voice.onVoiceSttResult((result: VoiceSTTResult) => {
      setPartialTranscript(result.text);
      if (result.isFinal && result.text.trim()) {
        addDebugEvent('STT', `${result.text.trim().length} chars final`, 'active');
        setCallState('processing');
        props.onSendMessage(result.text.trim());
        setPartialTranscript('');
      }
    }));

    // VAD events — during TTS playback, audio is not streamed to backend,
    // so no VAD events arrive; barge-in is detected locally via mic level.
    cleanups.push(bridge.voice.onVoiceVadEvent((event) => {
      if (event.type === 'speech-start') {
        if (ttsPlaying) return; // safety guard — barge-in handled locally
        addDebugEvent('VAD', 'Speech started', 'active');
        setCallState('listening');
      } else if (event.type === 'speech-end') {
        addDebugEvent('VAD', 'Speech ended', 'info');
        if (callState() === 'listening') {
          setCallState('processing');
        }
      }
    }));

    // TTS audio — schedule streamed chunks for gapless playback
    cleanups.push(bridge.voice.onVoiceTtsAudio((audio: VoiceTtsAudio) => {
      if (ttsAborted) return; // ignore audio from a cancelled generation
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
      log.info('[VoiceTab] TTS status', status);
      if (status.error) {
        ttsHadError = true;
        addDebugEvent('TTS error', status.error, 'error');
      }
      setTtsModelLoading(status.modelLoading ?? false);
      if (status.downloadProgress !== undefined) {
        setTtsDownloadProgress(status.downloadProgress);
      }
      if (status.generating) {
        ttsHadError = false;
        ttsGenerationActive = true;
        addDebugEvent('TTS', status.playing ? 'Playback started' : 'Generating audio', 'active');
        if (status.playing) {
          ttsPlaying = true;
          setCallState('speaking');
        } else {
          setCallState('processing');
        }
      } else {
        ttsGenerationActive = false;
        finishVoiceTtsPhraseRequest(voiceTtsTurn);
        setTtsModelLoading(false);
        setTtsDownloadProgress(0);
        if (ttsHadError) {
          ttsHadError = false;
        } else {
          addDebugEvent('TTS', 'Generation finished', 'info');
        }
        requestNextVoiceTtsPhrase();
        finishTtsIfPlaybackDrained();
      }
    }));

    // Voice session ready
    cleanups.push(bridge.voice.onVoiceSessionReady(() => {
      setIsInitializing(false);
      setSessionStatus(null);
      setInitError('');
      addDebugEvent('Session', 'Voice backend ready', 'active');
    }));

    cleanups.push(bridge.voice.onVoiceSessionStatus((status) => {
      log.info('[VoiceTab] Voice session status', status);
      setSessionStatus(status);
      addDebugEvent('Load', `${status.stage}: ${status.message}`, 'info');
    }));

    // Voice session error
    cleanups.push(bridge.voice.onVoiceSessionError((data) => {
      setIsInitializing(false);
      setIsCallActive(false);
      props.onCallStateChange?.(false, 'failed');
      setCallState('idle');
      setSessionStatus(null);
      stopAudioCapture();

      const err = data.error.toLowerCase();
      if (err.includes('403') || err.includes('4003') || err.includes('unauthorized')) {
        setInitError(t('mlearn.ConversationAgent.Voice.BackendAuthError'));
      } else {
        setInitError(data.error);
      }
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

  // ============================================================================
  // Stream TTS for assistant phrases as the LLM response arrives
  // ============================================================================

  function resetVoiceTtsTurn(initialText: string, messageIndex: number): void {
    stopTTSPlayback();
    resetVoiceTtsTurnState(voiceTtsTurn, messageIndex);
    currentTtsText = initialText;
    ttsAborted = false;
    ttsQueue = [];
    ttsQueueIndex = 0;
    ttsCurrentSentenceIdx = 0;
    bargeInFrames = 0;
    resetTtsTimeline();
  }

  function requestNextVoiceTtsPhrase(): void {
    if (ttsAborted || !isCallActive()) return;
    const next = takeNextVoiceTtsPhrase(voiceTtsTurn);
    if (!next) return;

    const provider = activeTtsProvider();
    const sampleId = activeVoiceSampleId();
    log.info('[VoiceTab] Requesting TTS phrase', {
      provider,
      language: props.language,
      chars: next.phrase.length,
      hasVoiceSample: Boolean(sampleId),
    });
    addDebugEvent('LLM -> TTS', `${next.phrase.length} chars queued for streamed TTS`, 'active');

    ttsGenerationActive = true;

    void (async () => {
      try {
        const allowed = await requestAccess('tts');
        if (!allowed || ttsAborted || !isCallActive()) {
          finishVoiceTtsPhraseRequest(voiceTtsTurn);
          ttsGenerationActive = false;
          return;
        }
        getBridge().voice.voiceTtsGenerate(next.phrase, props.language, ttsSpeed(), sampleId, provider);
      } catch (error) {
        log.error('[VoiceTab] Failed to request streamed TTS phrase:', error);
        finishVoiceTtsPhraseRequest(voiceTtsTurn);
        ttsGenerationActive = false;
      }
    })();
  }

  createEffect(() => {
    if (!isCallActive()) return;
    const msgs = props.messages;
    if (msgs.length === 0) return;
    const lastIndex = msgs.length - 1;
    const last = msgs[msgs.length - 1];
    if (last.role !== 'assistant' || !last.content || last.interrupted) return;

    if (voiceTtsTurn.messageIndex !== lastIndex) {
      resetVoiceTtsTurn(last.content, lastIndex);
    }

    currentTtsText = last.content;
    const queued = enqueueVoiceTtsPhrasesForMessage(voiceTtsTurn, lastIndex, last.content, props.isStreaming);
    if (queued.length > 0) {
      appendTtsTimelinePhrases(queued, voiceTtsTurn.sentenceTexts.length - queued.length);
      requestNextVoiceTtsPhrase();
    }
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
      autoGainControl: true,
    };
  };

  const startAudioCapture = async () => {
    // Clean up any existing capture to prevent duplicate pipelines
    stopAudioCapture();

    try {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: getMicrophoneAudioConstraints(),
        });
      } catch (error) {
        if (!selectedMicrophoneId()) throw error;
        log.error('[VoiceTab] Selected microphone failed, falling back to default:', error);
        setSelectedMicrophoneId('');
        await refreshMicrophones();
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: getMicrophoneAudioConstraints(),
        });
      }

      if (!isCallActive()) {
        stopAudioCapture();
        return;
      }

      await refreshMicrophones();

      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(mediaStream);

      // Analyser for visualizer
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      source.connect(analyserNode);

      // ScriptProcessor to capture raw PCM
      scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
      source.connect(scriptNode);
      scriptNode.connect(audioContext.destination);

      scriptNode.onaudioprocess = (e) => {
        if (!isCallActive()) return;
        if (currentVoiceMode === 'push-to-talk' && !pttActive()) return;
        if (ttsPlaying) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const samples = new Float32Array(inputData);
        getBridge().voice.voiceSendAudioChunk(samples);
      };

      // Start visualizer loop
      updateVisualizer();
      setMicError('');
    } catch (err) {
      log.error('Microphone access error:', err);
      setMicError(t('mlearn.ConversationAgent.Voice.MicPermission'));
    }
  };

  const stopAudioCapture = () => {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode = null;
    }
    if (analyserNode) {
      analyserNode.disconnect();
      analyserNode = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    setAudioLevel(0);
  };

  const updateVisualizer = () => {
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
    animFrameId = requestAnimationFrame(updateVisualizer);
  };

  // ============================================================================
  // TTS Playback — Gapless Stream Scheduler
  // ============================================================================

  const finishTtsIfPlaybackDrained = () => {
    if (ttsGenerationActive || voiceTtsTurn.requestActive || voiceTtsTurn.pendingPhrases.length > 0 || ttsSources.length > 0) return;
    ttsPlaying = false;
    bargeInFrames = 0;
    ttsNextStartTime = null;
    if (ttsPlaybackTimer) {
      clearTimeout(ttsPlaybackTimer);
      ttsPlaybackTimer = null;
    }
    if (isCallActive()) {
      setCallState('listening');
    }
  };

  const scheduleTtsAudio = (audio: VoiceTtsAudio) => {
    if (!ttsAudioContext) {
      ttsAudioContext = new AudioContext();
    }

    setCallState('speaking');
    ttsPlaying = true;

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
      ? voiceTtsTurn.activePhraseIndex
      : (audio.sentenceIndex ?? Math.max(0, ttsTimelinePhrases.length - 1, ttsCurrentSentenceIdx));
    if (phraseIndex !== ttsTimingPhraseIndex) {
      ttsTimingPhraseIndex = phraseIndex;
      ttsCurrentSentenceIdx = phraseIndex;
      ttsCurrentSentenceStartTime = Date.now() + Math.max(0, scheduled.startAt - ttsAudioContext.currentTime) * 1000;
      ttsCurrentSentenceDuration = 0;
    }
    ttsCurrentSentenceDuration += buffer.duration;
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

    source.onended = () => {
      ttsSources = ttsSources.filter((s) => s !== source);
      ttsQueueIndex++;
      finishTtsIfPlaybackDrained();
    };

    source.start(scheduled.startAt);

    if (ttsPlaybackTimer) {
      clearTimeout(ttsPlaybackTimer);
    }
    const msUntilEnd = Math.max(0, (ttsNextStartTime - ttsAudioContext.currentTime) * 1000) + 50;
    ttsPlaybackTimer = setTimeout(finishTtsIfPlaybackDrained, msUntilEnd);
  };

  /** Handle TTS interruption — compute spoken vs interrupted text */
  const handleTTSInterruption = () => {
    if (voiceTtsTurn.sentenceTexts.length === 0) {
      stopTTSPlayback();
      return;
    }

    // Sentences fully played = indices 0..ttsCurrentSentenceIdx-1
    const spokenParts: string[] = [];
    for (let i = 0; i < ttsCurrentSentenceIdx; i++) {
      if (voiceTtsTurn.sentenceTexts[i]) spokenParts.push(voiceTtsTurn.sentenceTexts[i]);
    }

    // Estimate how much of the current sentence was actually played
    const currentText = voiceTtsTurn.sentenceTexts[ttsCurrentSentenceIdx] || '';
    if (currentText) {
      if (ttsCurrentSentenceDuration > 0 && ttsCurrentSentenceStartTime > 0) {
        const elapsedMs = Date.now() - ttsCurrentSentenceStartTime;
        const ratio = Math.min(1, Math.max(0, (elapsedMs / 1000) / ttsCurrentSentenceDuration));
        const charIdx = Math.max(1, Math.ceil(currentText.length * ratio));
        spokenParts.push(currentText.substring(0, charIdx));
      } else {
        spokenParts.push(currentText);
      }
    }

    const spokenText = spokenParts.join(' ');

    // Remaining unspoken text: rest of current sentence + all subsequent sentences
    const remainingParts: string[] = [];
    if (currentText && ttsCurrentSentenceDuration > 0 && ttsCurrentSentenceStartTime > 0) {
      const elapsedMs = Date.now() - ttsCurrentSentenceStartTime;
      const ratio = Math.min(1, Math.max(0, (elapsedMs / 1000) / ttsCurrentSentenceDuration));
      const charIdx = Math.max(1, Math.ceil(currentText.length * ratio));
      const rest = currentText.substring(charIdx).trim();
      if (rest) remainingParts.push(rest);
    }
    for (let i = ttsCurrentSentenceIdx + 1; i < voiceTtsTurn.sentenceTexts.length; i++) {
      if (voiceTtsTurn.sentenceTexts[i]) remainingParts.push(voiceTtsTurn.sentenceTexts[i]);
    }
    const interruptedAt = remainingParts.join(' ');

    markTtsTimelineInterrupted();
    stopTTSPlayback();

    if (props.onInterrupted) {
      log.info('[VoiceTab] TTS interrupted', { spokenText, interruptedAt });
      setLastInterruption(spokenText || currentTtsText);
      addDebugEvent('Interrupted', `${spokenText.length} chars spoken before abort`, 'warn');
      props.onInterrupted(spokenText || '', interruptedAt || currentTtsText);
    }
  };

  const stopTTSPlayback = () => {
    for (const source of ttsSources) {
      try { source.stop(); } catch (e) {
        log.error("error", e);
      }
    }
    ttsSources = [];
    ttsPlaying = false;
    ttsGenerationActive = false;
    abortVoiceTtsTurn(voiceTtsTurn);
    ttsAborted = true; // reject any in-flight audio from this generation
    ttsQueue = [];
    ttsQueueIndex = 0;
    ttsCurrentSentenceIdx = 0;
    ttsTimingPhraseIndex = -1;
    ttsNextStartTime = null;
    ttsCurrentSentenceStartTime = 0;
    ttsCurrentSentenceDuration = 0;
    ttsTurnStartTime = 0;
    ttsScheduledDuration = 0;
    currentTtsText = '';
    bargeInFrames = 0;
    ttsHadError = false;
    if (ttsPlaybackTimer) {
      clearTimeout(ttsPlaybackTimer);
      ttsPlaybackTimer = null;
    }
    if (ttsAudioContext) {
      ttsAudioContext.close();
      ttsAudioContext = null;
    }
    getBridge().voice.voiceTtsStop();
  };

  // ============================================================================
  // Call Lifecycle
  // ============================================================================

  const startCall = async () => {
    log.info('[VoiceTab] Starting voice call', {
      language: props.language,
      mode: voiceMode(),
      ttsProvider: activeTtsProvider(),
    });
    setIsInitializing(true);
    setInitError('');
    setIsCallActive(true);
    props.onCallStateChange?.(true);
    setCallState('idle');
    setPartialTranscript('');
    setTtsChunkCount(0);
    setLastInterruption('');
    setDebugEvents([]);
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
    );
  };

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
            setCallState('listening');
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
      if (props.messages.length === 0 && !props.isStreaming) {
        props.onRequestGreeting();
      }
    }
  });

  const stopCall = (reason: 'completed' | 'cleanup' = 'completed') => {
    if (!isCallActive() && !isInitializing()) return;

    setIsCallActive(false);
    props.onCallStateChange?.(false, reason);
    setIsInitializing(false);
    setSessionStatus(null);
    setCallState('idle');
    setPartialTranscript('');

    stopTTSPlayback();
    stopAudioCapture();
    getBridge().voice.voiceStopSession();
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
      async (mode, prevMode) => {
        if (mode !== prevMode && isCallActive() && !isInitializing()) {
          stopAudioCapture();
          getBridge().voice.voiceStopSession();
          getBridge().voice.voiceStartSession(
            props.language,
            mode as VoiceMode,
            settings.voiceSilenceThreshold ?? DEFAULT_SETTINGS.voiceSilenceThreshold,
            activeTtsProvider(),
          );
          await startAudioCapture();
        }
      },
    ),
  );

  const setSilenceThreshold = (threshold: number) => {
    updateSettings({ ...settings, voiceSilenceThreshold: threshold });
    // Update the server-side threshold in real-time
    getBridge().voice.voiceUpdateSilenceThreshold(threshold);
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
  const activeVoiceSampleId = (): string | undefined => (
    ttsChoice() === 'voice-clone' ? props.defaultVoiceSampleId || undefined : undefined
  );

  const agentVoiceSampleExists = async (): Promise<boolean> => {
    const voiceSampleId = props.defaultVoiceSampleId;
    if (!voiceSampleId) return false;
    try {
      return Boolean(await getBridge().voice.voiceSampleGetPath(voiceSampleId));
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
      () => [props.defaultVoiceSampleId, settings.ttsProvider] as const,
      ([voiceSampleId, savedProvider]) => {
        const savedChoice = voiceTtsChoiceFromProvider(savedProvider ?? DEFAULT_SETTINGS.ttsProvider);
        if (!voiceSampleId && savedChoice === 'voice-clone') {
          setTtsChoice('system');
        } else if (ttsChoice() !== savedChoice) {
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
    if (target.isContentEditable) return true;
    return target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement;
  };

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
      getBridge().voice.voiceFlush();
    }
  };

  const handlePttKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || event.repeat || isEditableKeyTarget(event.target)) return;
    if (!canUseKeyboardPtt()) return;
    event.preventDefault();
    handlePttDown();
  };

  const handlePttKeyUp = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || isEditableKeyTarget(event.target)) return;
    if (!canUseKeyboardPtt() && !pttActive()) return;
    event.preventDefault();
    handlePttUp();
  };

  onMount(() => {
    window.addEventListener('keydown', handlePttKeyDown);
    window.addEventListener('keyup', handlePttKeyUp);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handlePttKeyDown);
    window.removeEventListener('keyup', handlePttKeyUp);
  });

  // ============================================================================
  // Derived State
  // ============================================================================

  const modelsReady = () => {
    const s = modelStatus();
    return s && s.sttDownloaded && (ttsChoice() === 'system' || s.ttsDownloaded) && s.vadDownloaded;
  };

  const statusText = () => {
    const state = callState();
    switch (state) {
      case 'listening': return t('mlearn.ConversationAgent.Voice.Listening');
      case 'processing': return t('mlearn.ConversationAgent.Voice.Processing');
      case 'speaking': return t('mlearn.ConversationAgent.Voice.Speaking');
      default: return '';
    }
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
  const getBarHeight = (index: number) => {
    // Reading tick() ensures this re-evaluates on every animation frame,
    // even when audioLevel stays constant (e.g. during TTS speaking state).
    void tick();
    if (!isCallActive() || callState() === 'idle') return 4;
    const level = audioLevel();
    // Create wave-like pattern using index offset
    const phase = (index / barCount) * Math.PI * 2 + Date.now() / 300;
    const wave = (Math.sin(phase) + 1) / 2;
    return Math.max(4, (level * 40 + wave * 12) * (callState() === 'speaking' ? 1.5 : 1));
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div class="voice-tab">
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
      <Show when={!isChecking() && !modelsReady() && !isDownloading()}>
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
          <Btn
            variant="primary"
            onClick={handleDownloadModels}
            disabled={!props.isConnected}
          >
            {t('mlearn.ConversationAgent.Voice.DownloadModels')}
          </Btn>
        </div>
      </Show>

      {/* Download progress */}
      <Show when={isDownloading()}>
        <div class="voice-download-section">
          <p class="voice-download-hint">
            <Show
              when={downloadProgress() < 50}
              fallback={t('mlearn.ConversationAgent.Voice.DownloadingModels')}
            >
              {t('mlearn.ConversationAgent.Voice.InstallingDependencies')}
            </Show>
          </p>
          <ProgressBar value={downloadProgress()} showPercent variant="primary" size="md" />
        </div>
      </Show>

      {/* Main voice UI (models ready) */}
      <Show when={!isChecking() && modelsReady() && !isDownloading()}>
        <div class="voice-call-area">
          {/* Call UI */}
          <div class="voice-call-ui">
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
                    <Btn
                      variant="primary"
                      icon={<PhoneIcon />}
                      onClick={startCall}
                      disabled={!props.isConnected}
                    >
                      {t('mlearn.ConversationAgent.Voice.StartCall')}
                    </Btn>
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
                    <Btn
                      size="sm"
                      variant={voiceMode() === 'vad' ? 'primary' : 'ghost'}
                      onClick={() => setVoiceMode('vad')}
                      class="voice-mode-btn"
                    >
                      {t('mlearn.ConversationAgent.Voice.HandsFree')}
                    </Btn>
                    <Btn
                      size="sm"
                      variant={voiceMode() === 'push-to-talk' ? 'primary' : 'ghost'}
                      onClick={() => setVoiceMode('push-to-talk')}
                      class="voice-mode-btn"
                    >
                      {t('mlearn.ConversationAgent.Voice.PushToTalk')}
                    </Btn>
                  </div>
                </Show>

                {/* End call */}
                <IconBtn
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
              <IconBtn
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

            <Show when={isCallActive() && !isInitializing()}>
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
        </div>
      </Show>
    </div>
  );
};
