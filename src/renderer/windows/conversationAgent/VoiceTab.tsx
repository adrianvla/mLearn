/**
 * VoiceTab — Real-time voice conversation UI for the Conversation Agent.
 * Captures audio via getUserMedia, streams PCM to main process for STT/VAD,
 * plays back TTS audio via Web Audio API with sentence-level interruption tracking.
 */

import { Component, Show, createSignal, createEffect, onCleanup, Index, onMount } from 'solid-js';
import { useSettings, useLocalization } from '../../context';
import {
  Btn,
  IconBtn,
  ProgressBar,
  RangeInput,
  EmptyState,
  AlertBanner,
  Spinner,
  Select,
} from '../../components/common';
import type { SelectOption } from '../../components/common';
import { ChatBubble } from './ChatBubble';
import type { ConversationMessage, VoiceModelStatus, VoiceSTTResult, VoiceTtsAudio, VoiceMode, VoiceSample, Token } from '../../../shared/types';
import type { WordHoverTriggerMode } from '../../../shared/constants';
import './VoiceTab.css';

// ============================================================================
// Icons
// ============================================================================

const PhoneIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
  </svg>
);

const PhoneOffIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67M1 1l22 22M4.22 4.22A19.13 19.13 0 002.12 4.18 2 2 0 004.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91" />
  </svg>
);

const MicIcon: Component = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
}

// ============================================================================
// Component
// ============================================================================

export const VoiceTab: Component<VoiceTabProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();

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

  // Voice sample state
  const [voiceSamples, setVoiceSamples] = createSignal<VoiceSample[]>([]);
  const [selectedSampleId, setSelectedSampleId] = createSignal<string>('');

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
      const status = await window.mLearnIPC?.voiceCheckModels(language);
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
      const samples = await window.mLearnIPC?.voiceSampleList();
      if (samples) setVoiceSamples(samples);
    } catch {
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
    const ipc = window.mLearnIPC;
    if (!ipc) return;

    const cleanups: Array<() => void> = [];

    // Model download progress
    const unsub1 = ipc.onVoiceModelProgress((status) => {
      setModelStatus(status);
      setIsDownloading(status.downloading);
      setDownloadProgress(Math.round(status.progress * 100));
    });
    if (unsub1) cleanups.push(unsub1);

    // STT results
    const unsub2 = ipc.onVoiceSttResult((result: VoiceSTTResult) => {
      setPartialTranscript(result.text);
      if (result.isFinal && result.text.trim()) {
        setCallState('processing');
        props.onSendMessage(result.text.trim());
        setPartialTranscript('');
      }
    });
    if (unsub2) cleanups.push(unsub2);

    // VAD events
    const unsub3 = ipc.onVoiceVadEvent((event) => {
      if (event.type === 'speech-start') {
        setCallState('listening');
        // Interrupt TTS if speaking — track what was said vs interrupted
        if (ttsPlaying) {
          handleTTSInterruption();
          props.onAbort();
        }
      } else if (event.type === 'speech-end') {
        if (callState() === 'listening') {
          setCallState('processing');
        }
      }
    });
    if (unsub3) cleanups.push(unsub3);

    // TTS audio — queue sentences for sequential playback
    const unsub4 = ipc.onVoiceTtsAudio((audio: VoiceTtsAudio) => {
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
    });
    if (unsub4) cleanups.push(unsub4);

    // TTS status
    const unsub5 = ipc.onVoiceTtsStatus((status) => {
      if (status.generating) {
        setCallState('processing');
      }
    });
    if (unsub5) cleanups.push(unsub5);

    // Voice session ready
    const unsub6 = ipc.onVoiceSessionReady(() => {
      setIsInitializing(false);
      setInitError('');
    });
    if (unsub6) cleanups.push(unsub6);

    // Voice session error
    const unsub7 = ipc.onVoiceSessionError((data) => {
      setIsInitializing(false);
      setInitError(data.error);
      setIsCallActive(false);
      props.onCallStateChange?.(false);
      setCallState('idle');
      stopAudioCapture();
    });
    if (unsub7) cleanups.push(unsub7);

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
    if (last.role === 'assistant' && last.content && !props.isStreaming) {
      // Reset sentence queue for new TTS turn
      ttsQueue = [];
      ttsQueueIndex = 0;
      ttsSentenceTexts = [];
      ttsCurrentSentenceIdx = 0;
      // Generate TTS for the final assistant response with optional voice cloning
      const sampleId = selectedSampleId() || undefined;
      window.mLearnIPC?.voiceTtsGenerate(last.content, props.language, ttsSpeed(), sampleId);
    }
  });

  // ============================================================================
  // Audio Capture
  // ============================================================================

  const startAudioCapture = async () => {
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

        const inputData = e.inputBuffer.getChannelData(0);
        const samples = new Float32Array(inputData);
        window.mLearnIPC?.voiceSendAudioChunk(samples);
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
    if (!analyserNode) return;
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(dataArray);

    // Calculate average level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length / 255;
    setAudioLevel(avg);

    animFrameId = requestAnimationFrame(updateVisualizer);
  };

  // ============================================================================
  // TTS Playback — Sentence Queue
  // ============================================================================

  const playNextSentence = () => {
    if (ttsQueueIndex >= ttsQueue.length) {
      // All sentences played
      ttsPlaying = false;
      if (isCallActive()) {
        setCallState('listening');
      }
      return;
    }

    const audio = ttsQueue[ttsQueueIndex];
    ttsCurrentSentenceIdx = audio.sentenceIndex ?? ttsQueueIndex;

    if (!audioContext) {
      audioContext = new AudioContext();
    }

    setCallState('speaking');
    ttsPlaying = true;

    const buffer = audioContext.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.samples);

    ttsSource = audioContext.createBufferSource();
    ttsSource.buffer = buffer;
    ttsSource.connect(audioContext.destination);

    ttsSource.onended = () => {
      ttsQueueIndex++;
      playNextSentence();
    };

    ttsSource.start();
  };

  /** Handle TTS interruption — compute spoken vs interrupted text */
  const handleTTSInterruption = () => {
    if (ttsSentenceTexts.length === 0) {
      stopTTSPlayback();
      return;
    }

    // Sentences fully played = indices 0..ttsCurrentSentenceIdx-1
    // Current sentence was interrupted mid-playback
    const spokenParts: string[] = [];
    for (let i = 0; i < ttsCurrentSentenceIdx; i++) {
      if (ttsSentenceTexts[i]) spokenParts.push(ttsSentenceTexts[i]);
    }
    // Add current (partially played) sentence
    const currentText = ttsSentenceTexts[ttsCurrentSentenceIdx] || '';
    if (currentText) spokenParts.push(currentText);

    const spokenText = spokenParts.join(' ');

    // Remaining unspoken sentences
    const remainingParts: string[] = [];
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
      try { ttsSource.stop(); } catch { /* not started */ }
      ttsSource = null;
    }
    ttsPlaying = false;
    ttsQueue = [];
    ttsQueueIndex = 0;
    ttsSentenceTexts = [];
    ttsCurrentSentenceIdx = 0;
    window.mLearnIPC?.voiceTtsStop();
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
    window.mLearnIPC?.voiceStartSession(
      props.language,
      voiceMode(),
      settings.voiceSilenceThreshold ?? 1.2,
    );
    await startAudioCapture();
  };

  // Called when the session ready event arrives from main process
  createEffect(() => {
    if (isCallActive() && !isInitializing() && !initError()) {
      setCallState('listening');

      // Request the model to start the conversation with a greeting
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
    window.mLearnIPC?.voiceStopSession();
  };

  // ============================================================================
  // Model Download
  // ============================================================================

  const handleDownloadModels = () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    window.mLearnIPC?.voiceDownloadModels(props.language);
  };

  // ============================================================================
  // Settings Updates
  // ============================================================================

  const setVoiceMode = (mode: VoiceMode) => {
    updateSettings({ ...settings, voiceMode: mode });
  };

  const setTtsSpeed = (speed: number) => {
    updateSettings({ ...settings, voiceTtsSpeed: speed });
  };

  const setSilenceThreshold = (threshold: number) => {
    updateSettings({ ...settings, voiceSilenceThreshold: threshold });
  };

  // Voice sample upload
  const handleSampleUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const filePath = window.mLearnIPC?.getPathForFile(file);
      if (!filePath) return;
      const name = file.name.replace(/\.[^.]+$/, '');
      try {
        await window.mLearnIPC?.voiceSampleUpload(filePath, name);
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
  const handlePttUp = () => setPttActive(false);

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

  // Generate bar heights for visualizer
  const barCount = 12;
  const getBarHeight = (index: number) => {
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
          <Spinner size={32} />
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
            icon="🎙️"
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
            {t('mlearn.ConversationAgent.Voice.DownloadProgress', { progress: String(downloadProgress()) })}
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
                <Spinner size={20} />
                <span class="voice-initializing-text">
                  {t('mlearn.ConversationAgent.Voice.Initializing')}
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
              <div class="voice-sample-row">
                <label>{t('mlearn.ConversationAgent.Voice.VoiceSample')}</label>
                <Select
                  options={voiceSampleOptions()}
                  value={selectedSampleId()}
                  onChange={(e) => setSelectedSampleId(e.currentTarget.value)}
                  size="sm"
                />
                <IconBtn
                  icon={<UploadIcon />}
                  variant="ghost"
                  size="sm"
                  onClick={handleSampleUpload}
                  aria-label={t('mlearn.ConversationAgent.Voice.UploadSample')}
                />
              </div>
            </Show>
          </div>

          {/* Partial transcript preview */}
          <Show when={partialTranscript()}>
            <div class="voice-transcript-preview">
              {partialTranscript()}
            </div>
          </Show>

          {/* Messages (shared with chat tab) */}
          <div class="voice-messages" ref={messagesRef}>
            <Show
              when={props.messages.length > 0}
              fallback={
                <EmptyState
                  icon="🎙️"
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
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
