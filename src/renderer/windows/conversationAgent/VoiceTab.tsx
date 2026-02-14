/**
 * VoiceTab — Real-time voice conversation UI for the Conversation Agent.
 * Captures audio via getUserMedia, streams PCM to main process for STT/VAD,
 * plays back TTS audio via Web Audio API.
 */

import { Component, Show, createSignal, createEffect, onCleanup, Index } from 'solid-js';
import { useSettings, useLocalization } from '../../context';
import {
  Btn,
  Progress,
  RangeInput,
  EmptyState,
  AlertBanner,
} from '../../components/common';
import { ChatBubble } from './ChatBubble';
import type { ConversationMessage, VoiceModelStatus, VoiceSTTResult, VoiceMode, Token } from '../../../shared/types';
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

// ============================================================================
// Props
// ============================================================================

export interface VoiceTabProps {
  messages: ConversationMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onAbort: () => void;
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
  const [callState, setCallState] = createSignal<'idle' | 'listening' | 'processing' | 'speaking'>('idle');
  const [partialTranscript, setPartialTranscript] = createSignal('');
  const [pttActive, setPttActive] = createSignal(false);
  const [audioLevel, setAudioLevel] = createSignal(0);
  const [micError, setMicError] = createSignal('');

  // Refs
  let messagesRef: HTMLDivElement | undefined;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let analyserNode: AnalyserNode | null = null;
  let animFrameId: number | null = null;

  // TTS playback state
  let ttsSource: AudioBufferSourceNode | null = null;
  let ttsPlaying = false;

  // Voice mode from settings
  const voiceMode = () => (settings.voiceMode || 'vad') as VoiceMode;
  const ttsSpeed = () => settings.voiceTtsSpeed ?? 1.0;

  // ============================================================================
  // Check model status on mount and language change
  // ============================================================================

  const checkModels = async () => {
    setIsChecking(true);
    try {
      const status = await window.mLearnIPC?.voiceCheckModels(props.language);
      if (status) {
        setModelStatus(status);
      } else {
        console.warn('[VoiceTab] voiceCheckModels returned:', status);
      }
    } catch (err) {
      console.error('[VoiceTab] Failed to check voice models:', err);
    } finally {
      setIsChecking(false);
    }
  };

  createEffect(() => {
    const lang = props.language;
    console.log('[VoiceTab] checking models for language:', lang);
    checkModels();
  });

  // ============================================================================
  // IPC Listeners
  // ============================================================================

  const cleanupFns: Array<() => void> = [];

  createEffect(() => {
    // Model download progress
    const unsub1 = window.mLearnIPC?.onVoiceModelProgress((status) => {
      setModelStatus(status);
      setIsDownloading(status.downloading);
      setDownloadProgress(Math.round(status.progress * 100));
      if (!status.downloading && status.sttDownloaded && status.ttsDownloaded && status.vadDownloaded) {
        setIsDownloading(false);
      }
    });
    if (unsub1) cleanupFns.push(unsub1);

    // STT results
    const unsub2 = window.mLearnIPC?.onVoiceSttResult((result: VoiceSTTResult) => {
      setPartialTranscript(result.text);
      if (result.isFinal && result.text.trim()) {
        setCallState('processing');
        props.onSendMessage(result.text.trim());
        setPartialTranscript('');
      }
    });
    if (unsub2) cleanupFns.push(unsub2);

    // VAD events
    const unsub3 = window.mLearnIPC?.onVoiceVadEvent((event) => {
      if (event.type === 'speech-start') {
        setCallState('listening');
        // Interrupt TTS if speaking
        if (ttsPlaying) {
          stopTTSPlayback();
          props.onAbort();
        }
      } else if (event.type === 'speech-end') {
        if (callState() === 'listening') {
          setCallState('processing');
        }
      }
    });
    if (unsub3) cleanupFns.push(unsub3);

    // TTS audio
    const unsub4 = window.mLearnIPC?.onVoiceTtsAudio((audio) => {
      playTTSAudio(audio.samples, audio.sampleRate);
    });
    if (unsub4) cleanupFns.push(unsub4);

    // TTS status
    const unsub5 = window.mLearnIPC?.onVoiceTtsStatus((status) => {
      if (status.generating) {
        setCallState('processing');
      }
    });
    if (unsub5) cleanupFns.push(unsub5);
  });

  onCleanup(() => {
    cleanupFns.forEach(fn => fn());
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
      // Generate TTS for the final assistant response
      window.mLearnIPC?.voiceTtsGenerate(last.content, props.language, ttsSpeed());
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
  // TTS Playback
  // ============================================================================

  const playTTSAudio = (samples: Float32Array, sampleRate: number) => {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    stopTTSPlayback();
    setCallState('speaking');
    ttsPlaying = true;

    const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);

    ttsSource = audioContext.createBufferSource();
    ttsSource.buffer = buffer;
    ttsSource.connect(audioContext.destination);

    ttsSource.onended = () => {
      ttsPlaying = false;
      if (isCallActive()) {
        setCallState('listening');
      }
    };

    ttsSource.start();
  };

  const stopTTSPlayback = () => {
    if (ttsSource) {
      try { ttsSource.stop(); } catch { /* not started */ }
      ttsSource = null;
    }
    ttsPlaying = false;
    window.mLearnIPC?.voiceTtsStop();
  };

  // ============================================================================
  // Call Lifecycle
  // ============================================================================

  const startCall = async () => {
    setIsCallActive(true);
    setCallState('listening');
    setPartialTranscript('');

    window.mLearnIPC?.voiceStartSession(props.language, voiceMode());
    await startAudioCapture();
  };

  const stopCall = () => {
    setIsCallActive(false);
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

      {/* Model download required */}
      <Show when={!isChecking() && !modelsReady() && !isDownloading()}>
        <div class="voice-download-section">
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
          <Progress progress={downloadProgress()} showPercent />
        </div>
      </Show>

      {/* Main voice UI (models ready) */}
      <Show when={modelsReady() && !isDownloading()}>
        <div class="voice-call-area">
          {/* Call UI */}
          <div class="voice-call-ui">
            {/* Visualizer */}
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

            {/* Controls */}
            <div class="voice-controls">
              <Show
                when={isCallActive()}
                fallback={
                  <button
                    class="voice-start-btn"
                    onClick={startCall}
                    disabled={!props.isConnected}
                  >
                    <PhoneIcon />
                    {t('mlearn.ConversationAgent.Voice.StartCall')}
                  </button>
                }
              >
                {/* Mode toggle */}
                <div class="voice-mode-toggle">
                  <button
                    class={`voice-mode-btn ${voiceMode() === 'vad' ? 'active' : ''}`}
                    onClick={() => setVoiceMode('vad')}
                  >
                    {t('mlearn.ConversationAgent.Voice.HandsFree')}
                  </button>
                  <button
                    class={`voice-mode-btn ${voiceMode() === 'push-to-talk' ? 'active' : ''}`}
                    onClick={() => setVoiceMode('push-to-talk')}
                  >
                    {t('mlearn.ConversationAgent.Voice.PushToTalk')}
                  </button>
                </div>

                {/* End call */}
                <button class="voice-end-btn" onClick={stopCall}>
                  <PhoneOffIcon />
                </button>
              </Show>
            </div>

            {/* PTT button (only in push-to-talk mode during active call) */}
            <Show when={isCallActive() && voiceMode() === 'push-to-talk'}>
              <button
                class={`voice-ptt-btn ${pttActive() ? 'active' : ''}`}
                onMouseDown={handlePttDown}
                onMouseUp={handlePttUp}
                onMouseLeave={handlePttUp}
                onTouchStart={handlePttDown}
                onTouchEnd={handlePttUp}
              >
                <MicIcon />
              </button>
            </Show>

            {/* TTS speed control */}
            <Show when={isCallActive()}>
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
                  description={t('mlearn.ConversationAgent.Voice.ModelsRequired')}
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
