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
import { ChatBubble } from './ChatBubble';
import type { ConversationMessage, VoiceModelStatus, VoiceSTTResult, VoiceTtsAudio, VoiceMode, VoiceSample, Token, TTSProvider } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import './VoiceTab.css';

// ============================================================================
// Icons
// ============================================================================

const PhoneIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
  </svg>
);

const PhoneOffIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
    <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67M1 1l22 22M4.22 4.22A19.13 19.13 0 002.12 4.18 2 2 0 004.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91" />
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

const UploadIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

// ============================================================================
// Props
// ============================================================================

export interface VoiceTabProps {
  messages: ConversationMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onRequestGreeting: () => void;
  onAbort: () => void;
  /** Called when user interrupts TTS — provides the text spoken so far and remaining text */
  onInterrupted?: (spokenText: string, interruptedAt: string) => void;
  /** Called when voice call starts or stops */
  onCallStateChange?: (active: boolean) => void;
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
  // Tick counter drives continuous visualizer animation independent of audio level
  const [tick, setTick] = createSignal(0);

  // Voice sample state
  const [voiceSamples, setVoiceSamples] = createSignal<VoiceSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = createSignal<string>(props.defaultVoiceSampleId || '');

  // Refs
  let messagesRef: HTMLDivElement | undefined;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let analyserNode: AnalyserNode | null = null;
  let animFrameId: number | null = null;

  // TTS sentence queue for interruption tracking
  let ttsQueue: VoiceTtsAudio[] = [];
  let ttsQueueIndex = 0;
  let ttsSource: AudioBufferSourceNode | null = null;
  let ttsPlaying = false;
  let ttsSentenceTexts: string[] = []; // full ordered list of sentence texts for this TTS turn
  let ttsCurrentSentenceIdx = 0;
  let ttsAudioContext: AudioContext | null = null; // separate context for TTS playback

  // TTS generation guard — prevents stale audio from playing after cancellation
  let ttsAborted = false;
  // Sentence timing for estimating interruption position within a sentence
  let ttsCurrentSentenceStartTime = 0;
  let ttsCurrentSentenceDuration = 0;
  // Barge-in detection: consecutive mic-loud frames during TTS playback
  let bargeInFrames = 0;
  const BARGE_IN_THRESHOLD = 0.15;
  const BARGE_IN_FRAMES_REQUIRED = 3;

  // Voice mode from settings
  const voiceMode = () => (settings.voiceMode || 'vad') as VoiceMode;
  const ttsSpeed = () => settings.voiceTtsSpeed ?? 1.0;
  const silenceThreshold = () => settings.voiceSilenceThreshold ?? 1.2;

  // ============================================================================
  // Check model status on mount and language change
  // ============================================================================

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
      console.error('[VoiceTab] Failed to check voice models:', err);
    } finally {
      setIsChecking(false);
    }
  };

  // Load voice samples
  const loadVoiceSamples = async () => {
    try {
      const samples = await getBridge().voice.voiceSampleList();
      if (samples) setVoiceSamples(samples);
    } catch (e) {
      console.error(e);
      // ignore
    }
  };

  createEffect(() => {
    const lang = props.language;
    checkModels(lang);
  });

  onMount(() => {
    loadVoiceSamples();
  });

  // ============================================================================
  // IPC Listeners
  // ============================================================================

  // Set up IPC listeners once on mount, clean up on unmount
  onMount(() => {
    const bridge = getBridge();
    const cleanups: Array<() => void> = [];

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
        setCallState('listening');
      } else if (event.type === 'speech-end') {
        if (callState() === 'listening') {
          setCallState('processing');
        }
      }
    }));

    // TTS audio — queue sentences for sequential playback
    cleanups.push(bridge.voice.onVoiceTtsAudio((audio: VoiceTtsAudio) => {
      if (ttsAborted) return; // ignore audio from a cancelled generation
      ttsQueue.push(audio);
      // Collect sentence texts for interruption tracking
      if (audio.sentenceText && audio.sentenceIndex !== undefined) {
        while (ttsSentenceTexts.length <= audio.sentenceIndex) {
          ttsSentenceTexts.push('');
        }
        ttsSentenceTexts[audio.sentenceIndex] = audio.sentenceText;
      }
      // Start playing if not already playing
      if (!ttsPlaying) {
        playNextSentence();
      }
    }));

    // TTS status
    cleanups.push(bridge.voice.onVoiceTtsStatus((status) => {
      setTtsModelLoading(status.modelLoading ?? false);
      if (status.generating) {
        setCallState('processing');
      } else {
        setTtsModelLoading(false);
      }
    }));

    // Voice session ready
    cleanups.push(bridge.voice.onVoiceSessionReady(() => {
      setIsInitializing(false);
      setInitError('');
    }));

    // Voice session error
    cleanups.push(bridge.voice.onVoiceSessionError((data) => {
      setIsInitializing(false);
      setInitError(data.error);
      setIsCallActive(false);
      props.onCallStateChange?.(false);
      setCallState('idle');
      stopAudioCapture();
    }));

    onCleanup(() => {
      cleanups.forEach(fn => fn());
    });
  });

  // Clean up call on component unmount
  onCleanup(() => {
    stopCall();
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
  // Auto-play TTS for new assistant messages during call
  // ============================================================================

  createEffect(() => {
    if (!isCallActive()) return;
    const msgs = props.messages;
    if (msgs.length === 0) return;
    const last = msgs[msgs.length - 1];
    // Skip TTS for interrupted messages to avoid re-reading already-spoken text
    if (last.role === 'assistant' && last.content && !props.isStreaming && !last.interrupted) {
      // Reset sentence queue for new TTS turn
      ttsAborted = false;
      ttsQueue = [];
      ttsQueueIndex = 0;
      ttsSentenceTexts = [];
      ttsCurrentSentenceIdx = 0;
      bargeInFrames = 0;
      // Generate TTS for the final assistant response with optional voice cloning
      const sampleId = selectedSampleId() || undefined;
      const provider = settings.ttsProvider || 'kokoro';
      if (provider !== 'cloud') {
        (async () => {
          const allowed = await requestAccess('tts');
          if (allowed) {
            getBridge().voice.voiceTtsGenerate(last.content, props.language, ttsSpeed(), sampleId, provider);
          }
        })();
      } else {
        getBridge().voice.voiceTtsGenerate(last.content, props.language, ttsSpeed(), sampleId, provider);
      }
    }
  });

  // ============================================================================
  // Audio Capture
  // ============================================================================

  const startAudioCapture = async () => {
    // Clean up any existing capture to prevent duplicate pipelines
    stopAudioCapture();

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

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
        if (voiceMode() === 'push-to-talk' && !pttActive()) return;
        // Don't stream mic audio to backend during TTS playback — prevents
        // TTS echo from triggering the server-side VAD. Barge-in is detected
        // locally via the analyser node instead.
        if (ttsPlaying) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const samples = new Float32Array(inputData);
        getBridge().voice.voiceSendAudioChunk(samples);
      };

      // Start visualizer loop
      updateVisualizer();
      setMicError('');
    } catch (err) {
      console.error('Microphone access error:', err);
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
    if (ttsPlaying) {
      if (avg > BARGE_IN_THRESHOLD) {
        bargeInFrames++;
        if (bargeInFrames >= BARGE_IN_FRAMES_REQUIRED) {
          bargeInFrames = 0;
          handleTTSInterruption();
          props.onAbort();
        }
      } else {
        bargeInFrames = 0;
      }
    }

    animFrameId = requestAnimationFrame(updateVisualizer);
  };

  // ============================================================================
  // TTS Playback — Sentence Queue
  // ============================================================================

  const playNextSentence = () => {
    if (ttsQueueIndex >= ttsQueue.length) {
      // All sentences played
      ttsPlaying = false;
      bargeInFrames = 0;
      if (isCallActive()) {
        setCallState('listening');
      }
      return;
    }

    const audio = ttsQueue[ttsQueueIndex];
    ttsCurrentSentenceIdx = audio.sentenceIndex ?? ttsQueueIndex;

    if (!ttsAudioContext) {
      ttsAudioContext = new AudioContext();
    }

    setCallState('speaking');
    ttsPlaying = true;

    const buffer = ttsAudioContext.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.samples);

    ttsSource = ttsAudioContext.createBufferSource();
    ttsSource.buffer = buffer;
    ttsSource.connect(ttsAudioContext.destination);

    ttsSource.onended = () => {
      ttsQueueIndex++;
      playNextSentence();
    };

    ttsSource.start();
    // Record timing for interruption position estimation
    ttsCurrentSentenceStartTime = Date.now();
    ttsCurrentSentenceDuration = buffer.duration;
  };

  /** Handle TTS interruption — compute spoken vs interrupted text */
  const handleTTSInterruption = () => {
    if (ttsSentenceTexts.length === 0) {
      stopTTSPlayback();
      return;
    }

    // Sentences fully played = indices 0..ttsCurrentSentenceIdx-1
    const spokenParts: string[] = [];
    for (let i = 0; i < ttsCurrentSentenceIdx; i++) {
      if (ttsSentenceTexts[i]) spokenParts.push(ttsSentenceTexts[i]);
    }

    // Estimate how much of the current sentence was actually played
    const currentText = ttsSentenceTexts[ttsCurrentSentenceIdx] || '';
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
    for (let i = ttsCurrentSentenceIdx + 1; i < ttsSentenceTexts.length; i++) {
      if (ttsSentenceTexts[i]) remainingParts.push(ttsSentenceTexts[i]);
    }
    const interruptedAt = remainingParts.join(' ');

    stopTTSPlayback();

    if (spokenText && props.onInterrupted) {
      props.onInterrupted(spokenText, interruptedAt);
    }
  };

  const stopTTSPlayback = () => {
    if (ttsSource) {
      try { ttsSource.stop(); } catch (e) {
        console.error(e);
      }
      ttsSource = null;
    }
    ttsPlaying = false;
    ttsAborted = true; // reject any in-flight audio from this generation
    ttsQueue = [];
    ttsQueueIndex = 0;
    ttsSentenceTexts = [];
    ttsCurrentSentenceIdx = 0;
    ttsCurrentSentenceStartTime = 0;
    ttsCurrentSentenceDuration = 0;
    bargeInFrames = 0;
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
    setIsInitializing(true);
    setInitError('');
    setIsCallActive(true);
    props.onCallStateChange?.(true);
    setCallState('idle');
    setPartialTranscript('');

    // Start voice session — engines init in main process.
    // The VOICE_SESSION_READY event will confirm when engines are loaded,
    // and VOICE_SESSION_ERROR will fire if initialization fails.
    // Audio capture is deferred until session is ready (see createEffect below).
    getBridge().voice.voiceStartSession(
      props.language,
      voiceMode(),
      settings.voiceSilenceThreshold ?? 1.2,
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

  const stopCall = () => {
    setIsCallActive(false);
    props.onCallStateChange?.(false);
    setIsInitializing(false);
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

  const setTtsProvider = (provider: TTSProvider) => {
    updateSettings({ ...settings, ttsProvider: provider });
  };

  const setTtsSpeed = (speed: number) => {
    updateSettings({ ...settings, voiceTtsSpeed: speed });
  };

  const setSilenceThreshold = (threshold: number) => {
    updateSettings({ ...settings, voiceSilenceThreshold: threshold });
    // Update the server-side threshold in real-time
    getBridge().voice.voiceUpdateSilenceThreshold(threshold);
  };

  // Voice sample upload
  const handleSampleUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const filePath = getBridge().files.getPathForFile(file);
      if (!filePath) return;
      const name = file.name.replace(/\.[^.]+$/, '');
      try {
        await getBridge().voice.voiceSampleUpload(filePath, name);
        await loadVoiceSamples();
      } catch (err) {
        console.error('[VoiceTab] Failed to upload voice sample:', err);
      }
    };
    input.click();
  };

  const voiceSampleOptions = (): SelectOption[] => {
    const opts: SelectOption[] = [{ value: '', label: t('mlearn.ConversationAgent.Voice.DefaultVoice') }];
    for (const s of voiceSamples()) {
      opts.push({ value: s.id, label: s.name });
    }
    return opts;
  };

  // ============================================================================
  // PTT Handlers
  // ============================================================================

  const handlePttDown = () => setPttActive(true);
  const handlePttUp = () => {
    if (pttActive()) {
      setPttActive(false);
      // Flush the server-side speech buffer so it immediately runs STT
      getBridge().voice.voiceFlush();
    }
  };

  // ============================================================================
  // Derived State
  // ============================================================================

  const modelsReady = () => {
    const s = modelStatus();
    return s && s.sttDownloaded && s.ttsDownloaded && s.vadDownloaded;
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
          <Spinner size={32} shape="square" cornerRadius={0} />
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
                <Spinner size={32} shape="square" cornerRadius={0} />
                <span class="voice-initializing-text">
                  {t('mlearn.ConversationAgent.Voice.Initializing')}
                </span>
              </div>
            </Show>

            {/* TTS model loading indicator */}
            <Show when={!isInitializing() && ttsModelLoading()}>
              <div class="voice-initializing">
                <Spinner size={32} shape="square" cornerRadius={0} />
                <span class="voice-initializing-text">
                  {t('mlearn.ConversationAgent.Voice.LoadingTtsModel')}
                </span>
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

              {/* Status + Stage indicator */}
              <div class={`voice-status-text ${isCallActive() ? 'active' : ''}`}>
                {isCallActive() ? statusText() : ''}
              </div>
              <Show when={isCallActive()}>
                <div class="voice-stage-indicator">
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
              </Show>
            </Show>

            {/* Controls */}
            <div class="voice-controls">
              <Show
                when={isCallActive()}
                fallback={
                  <Btn
                    variant="primary"
                    icon={<PhoneIcon />}
                    onClick={startCall}
                    disabled={!props.isConnected}
                  >
                    {t('mlearn.ConversationAgent.Voice.StartCall')}
                  </Btn>
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
                  onClick={stopCall}
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
              />
            </Show>

            {/* TTS provider selector */}
            <Show when={isCallActive() && !isInitializing()}>
              <div class="voice-speed-row">
                <label>{t('mlearn.ConversationAgent.Voice.TtsProvider')}</label>
                <div class="voice-mode-toggle">
                  <Btn
                    size="sm"
                    variant={(settings.ttsProvider || 'kokoro') === 'kokoro' ? 'primary' : 'ghost'}
                    onClick={() => setTtsProvider('kokoro')}
                    class="voice-mode-btn"
                  >
                    {t('mlearn.ConversationAgent.Voice.LocalTts')}
                  </Btn>
                  <Btn
                    size="sm"
                    variant={(settings.ttsProvider || 'kokoro') === 'qwen3' ? 'primary' : 'ghost'}
                    onClick={() => setTtsProvider('qwen3')}
                    class="voice-mode-btn"
                  >
                    {t('mlearn.ConversationAgent.Voice.Qwen3Tts')}
                  </Btn>
                  <Btn
                    size="sm"
                    variant={(settings.ttsProvider || 'kokoro') === 'cloud' ? 'primary' : 'ghost'}
                    onClick={() => setTtsProvider('cloud')}
                    class="voice-mode-btn"
                  >
                    {t('mlearn.ConversationAgent.Voice.CloudTts')}
                  </Btn>
                </div>
              </div>
            </Show>

            {/* TTS speed control */}
            <Show when={isCallActive() && !isInitializing()}>
              <div class="voice-speed-row">
                <label>{t('mlearn.ConversationAgent.Voice.TtsSpeed')}</label>
                <RangeInput
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={ttsSpeed()}
                  onChange={(v) => setTtsSpeed(v)}
                />
                <span class="voice-speed-value">{ttsSpeed().toFixed(1)}x</span>
              </div>
            </Show>

            {/* Silence threshold control (VAD mode only) */}
            <Show when={isCallActive() && !isInitializing() && voiceMode() === 'vad'}>
              <div class="voice-speed-row">
                <label>{t('mlearn.ConversationAgent.Voice.SilenceThreshold')}</label>
                <RangeInput
                  min={0.5}
                  max={5.0}
                  step={0.1}
                  value={silenceThreshold()}
                  onChange={(v) => setSilenceThreshold(v)}
                />
                <span class="voice-speed-value">{silenceThreshold().toFixed(1)}s</span>
              </div>
            </Show>

            {/* Voice sample selector */}
            <Show when={isCallActive() && !isInitializing()}>
              <div class={`voice-sample-row ${((settings.ttsProvider || 'kokoro') === 'kokoro' || (settings.ttsProvider || 'kokoro') === 'cloud') ? 'disabled' : ''}`}
                title={((settings.ttsProvider || 'kokoro') === 'kokoro' || (settings.ttsProvider || 'kokoro') === 'cloud') ? t('mlearn.ConversationAgent.Voice.VoiceSampleDisabledLocal') : undefined}
              >
                <label>{t('mlearn.ConversationAgent.Voice.VoiceSample')}</label>
                <Select
                  options={voiceSampleOptions()}
                  value={selectedSampleId()}
                  onChange={(e) => setSelectedSampleId(e.currentTarget.value)}
                  size="sm"
                  disabled={(settings.ttsProvider || 'kokoro') === 'kokoro' || (settings.ttsProvider || 'kokoro') === 'cloud'}
                />
                <IconBtn
                  icon={<UploadIcon />}
                  variant="ghost"
                  size="sm"
                  onClick={handleSampleUpload}
                  disabled={(settings.ttsProvider || 'kokoro') === 'kokoro' || (settings.ttsProvider || 'kokoro') === 'cloud'}
                  aria-label={t('mlearn.ConversationAgent.Voice.UploadSample')}
                />
              </div>
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
                      isProcessingToolCall={false}
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
                  isProcessingToolCall={false}
                />
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
